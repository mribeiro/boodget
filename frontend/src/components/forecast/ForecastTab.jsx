import { useState, useEffect, useCallback } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChevronDown, faChevronRight, faTriangleExclamation, faCircleInfo, faFlagCheckered, faCalendarDay,
} from '@fortawesome/free-solid-svg-icons';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts';
import { api } from '../../services/api';
import { formatNumber, parseRateInput } from '../../utils/numbers';
import { publishPageContext, clearPageContext } from '../../utils/pageContext';
import KpiStrip from '../ui/KpiStrip';
import Checkbox from '../ui/Checkbox';
import Badge from '../ui/Badge';

function fmt(v) {
  if (v == null) return '—';
  return formatNumber(v, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// "2026-10" → "October 2026"
function fmtYearMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function fmtSigned(v) {
  return (v < 0 ? '− ' : '+ ') + fmt(Math.abs(v));
}

function fmtShortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// "February 2026" → "Feb 26", for the chart's x-axis.
function shortCycle(name) {
  const [month, year] = name.split(' ');
  return `${month.slice(0, 3)} ${year.slice(2)}`;
}

function flagText(f) {
  if (f.type === 'negative_cycle') return `${f.cycle} is projected to end at ${fmt(f.closing)}.`;
  if (f.type === 'fund_shortfall') return `${f.name}, ${fmt(f.amount)} due ${fmtShortDate(f.date)} (${f.cycle}): the annual fund is short by ${fmt(f.short_by)}.`;
  if (f.type === 'untracked_loan') return `${f.name} (${fmt(f.amount)}/cycle) has no expense assigned, so it's added here as its own outflow.`;
  return '';
}

function eventText(e) {
  if (e.type === 'loan_ends') return `${e.name} — last payment ${fmtShortDate(e.date)}; frees ${fmt(e.amount)}/cycle from the next cycle`;
  if (e.type === 'installment_due') return `${e.name} — ${fmt(e.amount)} due ${fmtShortDate(e.date)} (annual fund)`;
  if (e.type === 'untracked_loan_payment') return `${e.name} — ${fmt(e.amount)} (loan not tracked as an expense)`;
  if (e.type === 'draft_loan_payment') return `${e.name} — ${fmt(e.amount)} (draft loan, what-if)`;
  return '';
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
      padding: '8px 12px', fontSize: 12, boxShadow: 'var(--shadow-lg)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>{label}</div>
      {payload.map((entry) => (
        <div key={entry.dataKey} style={{ color: entry.stroke }}>
          {entry.name}: {fmt(entry.value)}
        </div>
      ))}
    </div>
  );
}

export default function ForecastTab({ dossierId }) {
  const [horizon, setHorizon] = useState(12);
  const [budgetMode, setBudgetMode] = useState('planned');
  const [includeDrafts, setIncludeDrafts] = useState([]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(new Set());
  const [returnInput, setReturnInput] = useState('');
  const [returnError, setReturnError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const f = await api.getForecast(dossierId, { horizon, budget: budgetMode, includeDraft: includeDrafts });
      setData(f);
      setReturnInput(f.capital?.return_pct != null ? String(f.capital.return_pct).replace('.', ',') : '');
      publishPageContext({ label: `Forecast (${horizon} cycles, ${budgetMode} budgets)`, data: f });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [dossierId, horizon, budgetMode, includeDrafts]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => clearPageContext(), []);

  function toggleRow(i) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  // The expected return is a dossier setting, saved as soon as the field is left.
  async function saveReturn() {
    const trimmed = returnInput.trim();
    const value = trimmed === '' ? null : parseRateInput(trimmed);
    if (value !== null && (!Number.isFinite(value) || value < 0 || value > 30)) {
      setReturnError('Enter a percentage between 0 and 30, or leave it empty.');
      return;
    }
    setReturnError('');
    const current = data?.capital?.return_pct ?? null;
    if ((value || null) === current) return;
    try {
      await api.updateDossierSettings(dossierId, { forecast_expected_return_pct: value || null });
      await load();
    } catch (err) {
      setReturnError(err.message);
    }
  }

  function toggleDraft(id) {
    setIncludeDrafts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  if (loading) return <div className="loading">Loading…</div>;
  if (!data) return error ? <div className="alert alert-error">{error}</div> : null;

  const last = data.cycles[data.cycles.length - 1];
  const shortfall = data.flags.find((f) => f.type === 'fund_shortfall');
  const chartData = data.cycles.map((c) => ({
    label: shortCycle(c.name),
    closing: c.closing,
    fund: c.annual_fund ? c.annual_fund.closing : null,
  }));
  const capitalData = data.capital
    ? [{ label: 'Today', capital: data.capital.start }, ...data.cycles.map((c) => ({ label: shortCycle(c.name), capital: c.capital.closing }))]
    : [];
  const warnings = data.flags.filter((f) => f.type !== 'untracked_loan');
  const notes = data.flags.filter((f) => f.type === 'untracked_loan');

  return (
    <div>
      {error && <div className="alert alert-error" style={{ marginBottom: 'var(--space-4)' }}>{error}</div>}

      <div className="section-header" style={{ marginBottom: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
        <h2 style={{ margin: 0 }}>Forecast</h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} aria-label="Horizon" style={{ width: 'auto' }}>
            <option value={6}>Next 6 cycles</option>
            <option value={12}>Next 12 cycles</option>
            <option value={24}>Next 24 cycles</option>
          </select>
          <select value={budgetMode} onChange={(e) => setBudgetMode(e.target.value)} aria-label="Budgets" style={{ width: 'auto' }}>
            <option value="planned">Budgets at their max</option>
            <option value="usual">Budgets at usual spending</option>
          </select>
        </div>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 'var(--space-4)' }}>
        The current cycle from its real items, then every later cycle from your expense and income templates.
        Each cycle opens with the previous one's projected closing. Below it, your Capital carried forward with
        what you save. A projection, not a promise.
      </p>

      {data.template_fallbacks.length > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: 'var(--space-3)' }}>
          <FontAwesomeIcon icon={faCircleInfo} style={{ marginRight: 8 }} />
          Your {data.template_fallbacks.map((f) => (f.part === 'income' ? 'income template' : 'expense template')).join(' and ')}{' '}
          {data.template_fallbacks.length > 1 ? 'are' : 'is'} empty, so later cycles repeat {data.template_fallbacks[0].cycle}'s figures.
          Set {data.template_fallbacks.length > 1 ? 'them' : 'it'} up in Settings (Income Settings / Monthly Expense template) for a forecast that follows your plan.
        </div>
      )}
      {warnings.map((f, i) => (
        <div key={`w${i}`} className="alert alert-warning" style={{ marginBottom: 'var(--space-3)' }}>
          <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: 8 }} />{flagText(f)}
        </div>
      ))}
      {notes.map((f, i) => (
        <div key={`n${i}`} className="alert alert-warning" style={{ marginBottom: 'var(--space-3)' }}>
          <FontAwesomeIcon icon={faCircleInfo} style={{ marginRight: 8 }} />{flagText(f)}
        </div>
      ))}

      <KpiStrip defaultOpen style={{ marginBottom: 'var(--space-5)' }} items={[
        { label: `End of ${last.name}`, value: fmt(last.closing), large: true, highlight: last.closing < 0 ? 'danger' : 'neutral' },
        data.lowest && { label: 'Lowest closing', value: fmt(data.lowest.closing), note: data.lowest.cycle, highlight: data.lowest.closing < 0 ? 'danger' : 'neutral' },
        data.fund_configured && {
          label: 'Annual fund',
          value: shortfall ? `Short ${fmt(shortfall.short_by)}` : fmt(last.annual_fund?.closing),
          note: shortfall ? `${shortfall.name}, ${shortfall.cycle}` : `at the end of ${last.name}`,
          highlight: shortfall ? 'danger' : 'success',
        },
        data.capital && {
          label: `Capital, end of ${last.name}`,
          value: fmt(data.capital.end),
          note: `${fmtSigned(data.capital.end - data.capital.start)} from today`,
          highlight: data.capital.end >= data.capital.start ? 'success' : 'danger',
        },
      ]} />

      <div className="chart-container" style={{ marginBottom: 'var(--space-5)' }}>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border-default)' }} tickLine={false} />
            <YAxis
              tickFormatter={(v) => formatNumber(v, { notation: 'compact' }) + ' €'}
              tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
              axisLine={false}
              tickLine={false}
              width={70}
            />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine y={0} stroke="var(--color-danger)" strokeDasharray="4 4" />
            <Line isAnimationActive={false} type="monotone" dataKey="closing" name="Cycle closing" stroke="var(--color-brand)" strokeWidth={2.5}
              dot={{ fill: 'var(--color-brand)', stroke: 'var(--bg-card)', strokeWidth: 2, r: 3 }} activeDot={{ r: 5 }} />
            {data.fund_configured && (
              <Line isAnimationActive={false} type="monotone" dataKey="fund" name="Annual fund" stroke="var(--color-success)" strokeWidth={2}
                dot={{ fill: 'var(--color-success)', stroke: 'var(--bg-card)', strokeWidth: 2, r: 3 }} activeDot={{ r: 5 }} />
            )}
          </LineChart>
        </ResponsiveContainer>
        <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: 12, color: 'var(--text-secondary)', marginTop: 'var(--space-2)', flexWrap: 'wrap' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 3, background: 'var(--color-brand)', marginRight: 6, verticalAlign: 'middle' }} />Cycle closing</span>
          {data.fund_configured && (
            <span><span style={{ display: 'inline-block', width: 10, height: 3, background: 'var(--color-success)', marginRight: 6, verticalAlign: 'middle' }} />Annual fund</span>
          )}
          <span><span style={{ display: 'inline-block', width: 18, height: 0, borderTop: '2px dashed var(--color-danger)', marginRight: 6, verticalAlign: 'middle' }} />0 € (below = in the red)</span>
          {!data.fund_configured && (
            <span style={{ color: 'var(--text-muted)' }}>Annual fund not set up (Annual Expenses → contributing accounts/distributions)</span>
          )}
        </div>
      </div>

      <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Capital</div>
          {data.capital && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
              Expected return
              <input
                type="text"
                inputMode="decimal"
                value={returnInput}
                placeholder="0"
                onChange={(e) => setReturnInput(e.target.value)}
                onBlur={saveReturn}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                aria-label="Expected annual return (%)"
                style={{ width: 64, textAlign: 'right' }}
              />
              % / year
            </label>
          )}
        </div>
        {returnError && <div className="alert alert-error" style={{ marginBottom: 'var(--space-3)' }}>{returnError}</div>}
        {!data.capital ? (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
            No Capital snapshot yet. Fill one in on the Capital tab to see your Capital projected forward.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 'var(--space-3)' }}>
              Your {fmtYearMonth(data.capital.as_of)} snapshot (idle + active) carried forward: each cycle's leftover, plus the Save
              part of your distributions, minus annual bills{data.capital.return_pct ? `, plus ${String(data.capital.return_pct).replace('.', ',')}% a year on invested money` : ''}.
              The current cycle only counts what isn't paid, spent or done yet.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 'var(--space-5)', rowGap: 4, fontSize: 13, marginBottom: 'var(--space-3)' }}>
              <span><span style={{ color: 'var(--text-muted)' }}>Today </span><strong>{fmt(data.capital.start)}</strong></span>
              <span><span style={{ color: 'var(--text-muted)' }}>Saved over {data.cycles.length} cycles </span><strong>{fmt(data.capital.saved_total)}</strong></span>
              {data.capital.return_pct != null && (
                <span><span style={{ color: 'var(--text-muted)' }}>Growth </span><strong>{fmt(data.capital.growth_total)}</strong></span>
              )}
              <span><span style={{ color: 'var(--text-muted)' }}>End of {last.name} </span><strong>{fmt(data.capital.end)}</strong></span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={capitalData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border-default)' }} tickLine={false} />
                <YAxis
                  domain={['auto', 'auto']}
                  tickFormatter={(v) => formatNumber(v, { notation: 'compact' }) + ' €'}
                  tick={{ fontSize: 11, fill: 'var(--text-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={70}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line isAnimationActive={false} type="monotone" dataKey="capital" name="Capital" stroke="var(--color-brand)" strokeWidth={2.5}
                  dot={{ fill: 'var(--color-brand)', stroke: 'var(--bg-card)', strokeWidth: 2, r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </>
        )}
      </div>

      {data.draft_loans.length > 0 && (
        <div className="card" style={{ padding: 'var(--space-4)', marginBottom: 'var(--space-5)' }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 'var(--space-2)' }}>What if I take…</div>
          {data.draft_loans.map((l) => (
            <Checkbox
              key={l.id}
              checked={l.included}
              onChange={() => toggleDraft(l.id)}
              label={`${l.name} (${fmt(l.monthly_payment)}/cycle)`}
            />
          ))}
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: data.capital ? 660 : 560 }}>
            <div style={{ display: 'flex', gap: 8, padding: '0.6rem 1rem', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.03em', borderBottom: '1px solid var(--border-default)' }}>
              <span style={{ width: 14 }} />
              <span style={{ flex: 1.4 }}>Cycle</span>
              <span style={{ flex: 1, textAlign: 'right' }}>Income</span>
              <span style={{ flex: 1, textAlign: 'right' }}>Out</span>
              <span style={{ flex: 1, textAlign: 'right' }}>Closing</span>
              {data.fund_configured && <span style={{ flex: 1, textAlign: 'right' }}>Annual fund</span>}
              {data.capital && <span style={{ flex: 1.1, textAlign: 'right' }}>Capital</span>}
            </div>
            {data.cycles.map((c, i) => {
              const open = expanded.has(i);
              const fundShort = c.annual_fund && c.annual_fund.closing < -0.005;
              return (
                <div key={c.start} style={{ borderBottom: '1px solid var(--border-default)' }}>
                  <div
                    onClick={() => toggleRow(i)}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.55rem 1rem', fontSize: 13.5, cursor: 'pointer' }}
                  >
                    <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} style={{ fontSize: 11, color: 'var(--text-muted)', width: 14 }} />
                    <span style={{ flex: 1.4, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      {c.name}
                      {c.source === 'cycle' && <Badge variant="brand">{i === 0 ? 'Current' : 'Opened'}</Badge>}
                      {c.events.some((e) => e.type === 'loan_ends') && <FontAwesomeIcon icon={faFlagCheckered} title="A loan ends" style={{ fontSize: 11, color: 'var(--color-success)' }} />}
                      {c.events.some((e) => e.type === 'installment_due') && <FontAwesomeIcon icon={faCalendarDay} title="Annual installments due" style={{ fontSize: 11, color: 'var(--text-muted)' }} />}
                    </span>
                    <span style={{ flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.income)}</span>
                    <span style={{ flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.expenses + c.distributions)}</span>
                    <span style={{ flex: 1, textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: c.closing < 0 ? 'var(--color-danger)' : undefined }}>{fmt(c.closing)}</span>
                    {data.fund_configured && (
                      <span style={{ flex: 1, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: fundShort ? 'var(--color-danger)' : undefined }}>{fmt(c.annual_fund?.closing)}</span>
                    )}
                    {c.capital && (
                      <span style={{ flex: 1.1, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(c.capital.closing)}</span>
                    )}
                  </div>
                  {open && (
                    <div style={{ padding: '0 1rem 0.75rem 2.4rem', fontSize: 12.5, color: 'var(--text-secondary)' }}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
                        {fmtShortDate(c.start)} – {fmtShortDate(c.end)} · {c.source === 'cycle' ? 'from the opened cycle' : 'from the template'}
                      </div>
                      <div>Opening {fmt(c.opening)} + income {fmt(c.income)} − expenses {fmt(c.expenses)} − distributions {fmt(c.distributions)}</div>
                      {c.annual_fund && (
                        <div>Annual fund: {fmt(c.annual_fund.opening)} + {fmt(c.annual_fund.in)} in{c.annual_fund.out.length ? ` − ${fmt(c.annual_fund.out.reduce((s, o) => s + o.amount, 0))} out` : ''} = {fmt(c.annual_fund.closing)}</div>
                      )}
                      {c.capital && (
                        <div>
                          Capital: {fmt(c.capital.opening)} {fmtSigned(c.capital.cash_flow)} cash flow{i === 0 ? ' still to go' : ''} + {fmt(c.capital.saved)} kept as savings
                          {c.capital.growth ? ` + ${fmt(c.capital.growth)} growth` : ''}
                          {c.capital.annual_bills ? ` − ${fmt(c.capital.annual_bills)} annual bills` : ''} = {fmt(c.capital.closing)}
                        </div>
                      )}
                      {c.events.length > 0 && (
                        <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                          {c.events.map((e, k) => <li key={k}>{eventText(e)}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
