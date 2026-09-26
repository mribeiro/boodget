const { db } = require('../db');
// Called as push.sendPush (not destructured) so tests can stub it.
const push = require('./push');
const { computeCycleStartDate, computeTheoreticalCycleEndDate, fromIsoDate } = require('../utils/cycleDates');

function getCurrentCycleStartYearMonth(cycleStartDay, weekendAdjustment) {
  const now = new Date();
  const todayDay = now.getUTCDate();
  const todayMonth = now.getUTCMonth() + 1;
  const todayYear = now.getUTCFullYear();
  const today = new Date(todayYear, todayMonth - 1, todayDay);
  const thisMonthStart = computeCycleStartDate(todayYear, todayMonth, cycleStartDay, weekendAdjustment);
  if (today >= thisMonthStart) {
    return { year: todayYear, month: todayMonth };
  }
  let month = todayMonth - 1;
  let year = todayYear;
  if (month === 0) { month = 12; year--; }
  return { year, month };
}

function checkShouldSend(user, dossierId, eventType, eventKey) {
  const existing = db
    .prepare(
      'SELECT sent_at FROM notification_log WHERE user_id = ? AND dossier_id = ? AND event_type = ? AND event_key = ? ORDER BY sent_at DESC LIMIT 1'
    )
    .get(user.id, dossierId, eventType, eventKey);
  if (!existing) return true;
  if (!user.repeat_enabled) return false;
  return isRepeatDue(existing.sent_at, new Date(), user.repeat_interval_days);
}

// Whether a repeat is due, counted in whole UTC calendar days. The scheduler evaluates each
// user once a day at the same minute, and the log row is stamped a moment *after* that day's
// check (once the pushes went out), so comparing elapsed milliseconds lands just short of
// N days at the next check and slips every repeat by a day (#323).
function isRepeatDue(sentAtSqlite, now, intervalDays) {
  const sentAt = new Date(sentAtSqlite.replace(' ', 'T') + 'Z');
  const DAY_MS = 1000 * 60 * 60 * 24;
  const sentDay = Math.floor(sentAt.getTime() / DAY_MS);
  const today = Math.floor(now.getTime() / DAY_MS);
  return today - sentDay >= intervalDays;
}

// The wall-clock date and time `now` reads as in `timeZone` (an IANA name). A null zone means
// UTC — the meaning send_hour/send_minute had before time zones were stored.
function localClock(now, timeZone) {
  if (!timeZone) {
    return { date: now.toISOString().slice(0, 10), hour: now.getUTCHours(), minute: now.getUTCMinutes() };
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

// Whether a user is due for today's evaluation: their local send time has passed today and they
// haven't been evaluated yet on their local today. "Has passed" rather than "is exactly now", so
// a minute the scheduler missed (restart, deploy, a slow previous run) is caught up later that
// day, and a send time skipped by a spring-forward DST change still fires.
function isDueToday(settings, now) {
  let clock;
  try {
    clock = localClock(now, settings.timezone);
  } catch (e) {
    clock = localClock(now, null); // an unknown zone name: fall back to UTC rather than never sending
  }
  const nowMinutes = clock.hour * 60 + clock.minute;
  const sendMinutes = settings.send_hour * 60 + settings.send_minute;
  return { due: nowMinutes >= sendMinutes && settings.last_evaluated_date !== clock.date, localDate: clock.date };
}

// Marks the user evaluated for `localDate`; false if another run already did. This is the claim
// that keeps two overlapping runs from both processing (and notifying) the same user.
function claimEvaluation(userId, localDate) {
  return (
    db
      .prepare(
        `UPDATE user_notification_settings SET last_evaluated_date = ?
          WHERE user_id = ? AND (last_evaluated_date IS NULL OR last_evaluated_date <> ?)`
      )
      .run(localDate, userId, localDate).changes === 1
  );
}

let running = false;

// Runs every minute (node-cron). Runs don't overlap within this process: a run still busy
// sending when the next minute ticks makes that tick a no-op.
async function runNotificationScheduler(now = new Date()) {
  if (running) return;
  running = true;
  try {
    await evaluateDueUsers(now);
  } finally {
    running = false;
  }
}

async function evaluateDueUsers(now) {
  const todayDay = now.getUTCDate();

  // Clean up log entries older than 90 days
  db.prepare("DELETE FROM notification_log WHERE sent_at < datetime('now', '-90 days')").run();

  const users = db
    .prepare(
      `SELECT u.id, u.username,
         uns.enabled, uns.send_hour, uns.send_minute, uns.timezone, uns.last_evaluated_date,
         uns.repeat_enabled, uns.repeat_interval_days
       FROM users u
       JOIN user_notification_settings uns ON uns.user_id = u.id
       WHERE uns.enabled = 1`
    )
    .all()
    .filter((user) => {
      const { due, localDate } = isDueToday(user, now);
      return due && claimEvaluation(user.id, localDate);
    });

  for (const user of users) {
    const subscriptions = db
      .prepare('SELECT * FROM push_subscriptions WHERE user_id = ?')
      .all(user.id);
    if (subscriptions.length === 0) continue;

    const dossierRows = db
      .prepare('SELECT dossier_id FROM dossier_notification_subscriptions WHERE user_id = ?')
      .all(user.id);

    for (const { dossier_id: dossierId } of dossierRows) {
      const dossier = db.prepare('SELECT * FROM dossiers WHERE id = ?').get(dossierId);
      if (!dossier) continue;

      // Verify user still has access
      const isOwner = dossier.creator_id === user.id;
      const hasAccess = isOwner || !!db
        .prepare('SELECT 1 FROM dossier_access WHERE dossier_id = ? AND user_id = ?')
        .get(dossierId, user.id);
      if (!hasAccess) continue;

      const cycleStartDay = dossier.cycle_start_day || 25;
      const weekendAdjustment = dossier.cycle_start_weekend_adjustment || 'none';
      const expenseNotifyDaysBefore = dossier.expense_notification_days_before ?? 1;

      const { year: curYear, month: curMonth } = getCurrentCycleStartYearMonth(cycleStartDay, weekendAdjustment);
      const currentCycle = db
        .prepare('SELECT * FROM expense_cycles WHERE dossier_id = ? AND year = ? AND month = ?')
        .get(dossierId, curYear, curMonth);

      const notifications = [];

      // --- snapshot_missing ---
      const snapshotWarnDay = dossier.capital_snapshot_warning_day || 7;
      if (todayDay >= snapshotWarnDay) {
        const calYear = now.getUTCFullYear();
        const calMonth = now.getUTCMonth() + 1;
        const filled = db
          .prepare('SELECT id FROM months WHERE dossier_id = ? AND year = ? AND month = ? AND filled = 1')
          .get(dossierId, calYear, calMonth);
        if (!filled) {
          const monthName = new Date(calYear, calMonth - 1, 1).toLocaleString('en', { month: 'long' });
          notifications.push({
            type: 'snapshot_missing',
            key: `snapshot:${calYear}-${String(calMonth).padStart(2, '0')}`,
            title: 'Snapshot missing',
            body: `${dossier.name} — ${monthName} capital snapshot not yet recorded`,
            url: `/dossiers/${dossierId}`,
          });
        }
      }

      // --- cycle_not_closed ---
      const prevCloseWarnDay = dossier.previous_cycle_close_warning_day || 25;
      if (todayDay >= prevCloseWarnDay) {
        let prevYear = curYear;
        let prevMonth = curMonth - 1;
        if (prevMonth === 0) { prevMonth = 12; prevYear--; }
        const prevCycle = db
          .prepare('SELECT * FROM expense_cycles WHERE dossier_id = ? AND year = ? AND month = ?')
          .get(dossierId, prevYear, prevMonth);
        if (prevCycle && !prevCycle.is_closed) {
          // Named using the cycle's own stored actual_end_date, not the dossier's current
          // setting, so a later change to it doesn't relabel this already-created cycle.
          const endDate = prevCycle.actual_end_date
            ? fromIsoDate(prevCycle.actual_end_date)
            : new Date(prevYear, prevMonth, (prevCycle.cycle_start_day ?? cycleStartDay) - 1);
          const cycleName = endDate.toLocaleString('en', { month: 'long', year: 'numeric' });
          notifications.push({
            type: 'cycle_not_closed',
            key: `cycle:${prevYear}-${String(prevMonth).padStart(2, '0')}:close`,
            title: 'Cycle not closed',
            body: `${dossier.name} — The ${cycleName} cycle has not been closed yet`,
            url: `/dossiers/${dossierId}`,
          });
        }
      }

      // --- cycle_not_opened ---
      const nextCycleWarnDay = dossier.next_cycle_warning_day || 22;
      if (todayDay >= nextCycleWarnDay && todayDay < cycleStartDay) {
        let nextYear = curYear;
        let nextMonth = curMonth + 1;
        if (nextMonth === 13) { nextMonth = 1; nextYear++; }
        const nextCycle = db
          .prepare('SELECT id FROM expense_cycles WHERE dossier_id = ? AND year = ? AND month = ?')
          .get(dossierId, nextYear, nextMonth);
        if (!nextCycle) {
          const endDate = computeTheoreticalCycleEndDate(nextYear, nextMonth, cycleStartDay, weekendAdjustment);
          const cycleName = endDate.toLocaleString('en', { month: 'long', year: 'numeric' });
          notifications.push({
            type: 'cycle_not_opened',
            key: `cycle:${nextYear}-${String(nextMonth).padStart(2, '0')}:open`,
            title: 'Cycle not opened',
            body: `${dossier.name} — The ${cycleName} cycle has not been opened yet`,
            url: `/dossiers/${dossierId}`,
          });
        }
      }

      // --- expense_upcoming / expense_overdue ---
      if (currentCycle) {
        const symbol = (dossier.currency || 'EUR') === 'EUR' ? '€' : (dossier.currency || 'EUR');
        const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

        // Monthly fixed expenses
        const unpaidItems = db
          .prepare(
            "SELECT * FROM cycle_items WHERE cycle_id = ? AND section = 'expense' AND type = 'Fixed' AND paid = 0"
          )
          .all(currentCycle.id);

        // The current cycle's own stored dates drive its payment-day math, not the
        // dossier's current setting, so it isn't reshaped by a later change to it.
        const activeCycleStartDay = currentCycle.cycle_start_day ?? cycleStartDay;
        const cycleWindowStart = currentCycle.actual_start_date
          ? fromIsoDate(currentCycle.actual_start_date)
          : new Date(curYear, curMonth - 1, activeCycleStartDay);
        const cycleWindowEnd = currentCycle.actual_end_date
          ? fromIsoDate(currentCycle.actual_end_date)
          : new Date(curYear, curMonth, activeCycleStartDay - 1);

        for (const item of unpaidItems) {
          const payDay = item.day_of_payment;
          if (payDay == null) continue;
          // A payment day-of-month can fall in the cycle's start month or the
          // following month — pick whichever calendar date actually lands inside
          // the cycle's (possibly weekend-shifted) real window.
          const candidateThisMonth = new Date(curYear, curMonth - 1, payDay);
          let nextM = curMonth + 1; let nextY = curYear;
          if (nextM === 13) { nextM = 1; nextY++; }
          const candidateNextMonth = new Date(nextY, nextM - 1, payDay);
          let payDate;
          if (candidateThisMonth >= cycleWindowStart && candidateThisMonth <= cycleWindowEnd) {
            payDate = candidateThisMonth;
          } else if (candidateNextMonth >= cycleWindowStart && candidateNextMonth <= cycleWindowEnd) {
            payDate = candidateNextMonth;
          } else {
            payDate = payDay >= activeCycleStartDay ? candidateThisMonth : candidateNextMonth;
          }
          const diffDays = Math.floor((payDate - today) / (1000 * 60 * 60 * 24));

          if (diffDays < 0) {
            const payStr = payDate.toLocaleString('en', { month: 'short', day: 'numeric' });
            notifications.push({
              type: 'expense_overdue',
              key: `cycle:${currentCycle.id}:item:${item.id}`,
              title: 'Overdue expense',
              body: `${dossier.name} — ${item.name}: ${symbol}${(item.value || 0).toFixed(2)} was due on ${payStr}`,
              url: `/dossiers/${dossierId}/cycles/${currentCycle.id}`,
            });
          } else if (diffDays <= expenseNotifyDaysBefore) {
            const daysText = diffDays === 0 ? 'today' : `in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
            notifications.push({
              type: 'expense_upcoming',
              key: `cycle:${currentCycle.id}:item:${item.id}`,
              title: 'Upcoming expense',
              body: `${dossier.name} — ${item.name}: ${symbol}${(item.value || 0).toFixed(2)} due ${daysText}`,
              url: `/dossiers/${dossierId}/cycles/${currentCycle.id}`,
            });
          }
        }

        // Annual expense installment payments
        const unpaidPayments = db
          .prepare(
            `SELECT ap.id, ap.real_value,
               yi.name, yi.num_installments,
               yinst.month AS inst_month, yinst.day AS inst_day, yinst.installment_number,
               ay.year AS annual_year
             FROM annual_expense_payments ap
             JOIN annual_expense_year_installments yinst ON yinst.id = ap.installment_id
             JOIN annual_expense_year_items yi ON yi.id = yinst.year_item_id
             JOIN annual_expense_years ay ON ay.id = yi.year_id
             WHERE ap.cycle_id = ? AND ap.paid = 0`
          )
          .all(currentCycle.id);

        for (const payment of unpaidPayments) {
          const payDate = new Date(payment.annual_year, payment.inst_month - 1, payment.inst_day);
          const diffDays = Math.floor((payDate - today) / (1000 * 60 * 60 * 24));
          const installLabel = `(${payment.installment_number}/${payment.num_installments})`;

          if (diffDays < 0) {
            const payStr = payDate.toLocaleString('en', { month: 'short', day: 'numeric' });
            notifications.push({
              type: 'expense_overdue',
              key: `cycle:${currentCycle.id}:payment:${payment.id}`,
              title: 'Overdue expense',
              body: `${dossier.name} — ${payment.name} ${installLabel}: ${symbol}${(payment.real_value || 0).toFixed(2)} was due on ${payStr}`,
              url: `/dossiers/${dossierId}/cycles/${currentCycle.id}`,
            });
          } else if (diffDays <= expenseNotifyDaysBefore) {
            const daysText = diffDays === 0 ? 'today' : `in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
            notifications.push({
              type: 'expense_upcoming',
              key: `cycle:${currentCycle.id}:payment:${payment.id}`,
              title: 'Upcoming expense',
              body: `${dossier.name} — ${payment.name} ${installLabel}: ${symbol}${(payment.real_value || 0).toFixed(2)} due ${daysText}`,
              url: `/dossiers/${dossierId}/cycles/${currentCycle.id}`,
            });
          }
        }
      }

      // Send deduplicated notifications
      for (const notif of notifications) {
        if (!checkShouldSend(user, dossierId, notif.type, notif.key)) continue;

        const failedEndpoints = [];
        for (const sub of subscriptions) {
          const result = await push.sendPush(sub, {
            type: notif.type,
            title: notif.title,
            body: notif.body,
            dossierId,
            url: notif.url,
          });
          if (!result.success && (result.statusCode === 410 || result.statusCode === 404)) {
            failedEndpoints.push(sub.endpoint);
          }
        }

        db.prepare(
          'INSERT INTO notification_log (user_id, dossier_id, event_type, event_key) VALUES (?, ?, ?, ?)'
        ).run(user.id, dossierId, notif.type, notif.key);

        for (const endpoint of failedEndpoints) {
          db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
          console.log(`[push] Removed expired subscription for user ${user.username}`);
        }
      }
    }
  }
}

module.exports = { runNotificationScheduler, isRepeatDue, isDueToday, localClock };
