const { db } = require('../db');
const { sendPush } = require('./push');

function getCurrentCycleStartYearMonth(cycleStartDay) {
  const now = new Date();
  const todayDay = now.getUTCDate();
  const todayMonth = now.getUTCMonth() + 1;
  const todayYear = now.getUTCFullYear();
  if (todayDay >= cycleStartDay) {
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
  const sentAt = new Date(existing.sent_at + 'Z');
  const daysSince = (Date.now() - sentAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= user.repeat_interval_days;
}

async function runNotificationScheduler() {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentMinute = now.getUTCMinutes();
  const todayDay = now.getUTCDate();

  // Clean up log entries older than 90 days
  db.prepare("DELETE FROM notification_log WHERE sent_at < datetime('now', '-90 days')").run();

  // Users with notifications enabled at the current UTC time
  const users = db
    .prepare(
      `SELECT u.id, u.username,
         uns.enabled, uns.send_hour, uns.send_minute,
         uns.repeat_enabled, uns.repeat_interval_days
       FROM users u
       JOIN user_notification_settings uns ON uns.user_id = u.id
       WHERE uns.enabled = 1 AND uns.send_hour = ? AND uns.send_minute = ?`
    )
    .all(currentHour, currentMinute);

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
      const expenseNotifyDaysBefore = dossier.expense_notification_days_before ?? 1;

      const { year: curYear, month: curMonth } = getCurrentCycleStartYearMonth(cycleStartDay);
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
          const endDate = new Date(prevYear, prevMonth, cycleStartDay - 1);
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
      if (todayDay >= nextCycleWarnDay) {
        let nextYear = curYear;
        let nextMonth = curMonth + 1;
        if (nextMonth === 13) { nextMonth = 1; nextYear++; }
        const nextCycle = db
          .prepare('SELECT id FROM expense_cycles WHERE dossier_id = ? AND year = ? AND month = ?')
          .get(dossierId, nextYear, nextMonth);
        if (!nextCycle) {
          const endDate = new Date(nextYear, nextMonth, cycleStartDay - 1);
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

        for (const item of unpaidItems) {
          const payDay = item.day_of_payment;
          if (payDay == null) continue;
          let payDate;
          if (payDay >= cycleStartDay) {
            payDate = new Date(curYear, curMonth - 1, payDay);
          } else {
            let nextM = curMonth + 1; let nextY = curYear;
            if (nextM === 13) { nextM = 1; nextY++; }
            payDate = new Date(nextY, nextM - 1, payDay);
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
          const result = await sendPush(sub, {
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

module.exports = { runNotificationScheduler };
