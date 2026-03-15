import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatEur(value) {
  if (value == null) return null;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' €';
}

const DASH = <span style={{ color: 'var(--color-border)' }}>—</span>;

function DiffLabel({ diff }) {
  if (diff == null) return null;
  const color = diff > 0 ? 'var(--color-success)' : diff < 0 ? 'var(--color-danger)' : 'var(--color-text-muted)';
  return (
    <div style={{ fontSize: '0.7rem', color, marginTop: '0.15rem' }}>
      {diff > 0 ? '+' : ''}{new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(diff)} €
    </div>
  );
}

export default function CapitalCompareTable({ dossierId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .getCompare(dossierId)
      .then(setData)
      .catch(() => setError('Failed to load compare data'));
  }, [dossierId]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!data) return <div style={{ padding: '2rem', color: 'var(--color-text-muted)', textAlign: 'center' }}>Loading...</div>;
  if (data.months.length === 0) return <div className="empty-state"><p>No months to compare.</p></div>;

  const groups = data.rows.reduce((acc, row) => {
    if (!acc[row.group_name]) acc[row.group_name] = [];
    acc[row.group_name].push(row);
    return acc;
  }, {});

  const hasIdleAccounts = data.rows.some((r) => r.is_idle_money);

  const numericStyle = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: '0.875rem' };

  return (
    <div className="table-container">
      <table className="table-sticky-first-col">
        <thead>
          <tr>
            <th style={{ minWidth: 160 }}>Account</th>
            {(() => {
              const hasAnyGap = data.months.some((mn, i) => {
                if (i === 0) return false;
                const p = data.months[i - 1];
                return (mn.year - p.year) * 12 + (mn.month - p.month) - 1 > 0;
              });
              return data.months.map((m, mi) => {
                const prev = mi > 0 ? data.months[mi - 1] : null;
                const gap = prev ? (m.year - prev.year) * 12 + (m.month - prev.month) - 1 : 0;
                return (
                  <th key={m.id} style={{ textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'bottom' }}>
                    {hasAnyGap && (
                      <span style={{ display: 'block', fontSize: '0.6rem', fontWeight: 400, color: 'var(--color-text-muted)', marginBottom: '0.1rem', visibility: gap > 0 ? 'visible' : 'hidden' }}>
                        {gap} {gap === 1 ? 'month' : 'months'} skipped
                      </span>
                    )}
                    {MONTH_NAMES[m.month - 1]} {m.year}
                    {!m.filled && (
                      <span style={{ display: 'block', fontSize: '0.65rem', fontWeight: 400, color: 'var(--color-text-muted)' }}>
                        not filled
                      </span>
                    )}
                  </th>
                );
              });
            })()}
          </tr>
        </thead>
        <tbody>
          {Object.entries(groups).map(([groupName, rows]) => (
            <React.Fragment key={groupName}>
              <tr className="group-header">
                <td colSpan={data.months.length + 1}>{groupName}</td>
              </tr>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    {row.is_idle_money ? (
                      <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: 'var(--color-primary)' }}>idle</span>
                    ) : null}
                    {row.archived ? (
                      <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>archived</span>
                    ) : null}
                  </td>
                  {data.months.map((m, mi) => {
                    const prev = mi > 0 ? data.months[mi - 1] : null;
                    const cur = row.values[m.id];
                    const prevVal = prev ? row.values[prev.id] : null;
                    const diff = cur != null && prevVal != null ? cur - prevVal : null;
                    return (
                      <td key={m.id} style={numericStyle}>
                        {cur != null ? formatEur(cur) : DASH}
                        <DiffLabel diff={diff} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </React.Fragment>
          ))}

          <tr style={{ borderTop: '2px solid var(--color-border)', background: 'var(--color-bg)' }}>
            <td style={{ fontWeight: 600 }}>Total</td>
            {data.months.map((m, mi) => {
              const hasAny = data.rows.some((r) => r.values[m.id] != null);
              const total = data.rows.reduce((sum, r) => sum + (r.values[m.id] ?? 0), 0);
              const prev = mi > 0 ? data.months[mi - 1] : null;
              const prevHasAny = prev && data.rows.some((r) => r.values[prev.id] != null);
              const prevTotal = prev ? data.rows.reduce((sum, r) => sum + (r.values[prev.id] ?? 0), 0) : null;
              const diff = hasAny && prevHasAny ? total - prevTotal : null;
              return (
                <td key={m.id} style={{ ...numericStyle, fontWeight: 600 }}>
                  {hasAny ? formatEur(total) : DASH}
                  <DiffLabel diff={diff} />
                </td>
              );
            })}
          </tr>

          {hasIdleAccounts && (
            <tr style={{ background: 'var(--color-bg)' }}>
              <td style={{ fontWeight: 600, color: 'var(--color-primary)', fontSize: '0.875rem' }}>Idle total</td>
              {data.months.map((m, mi) => {
                const idleRows = data.rows.filter((r) => r.is_idle_money);
                const hasAny = idleRows.some((r) => r.values[m.id] != null);
                const total = idleRows.reduce((sum, r) => sum + (r.values[m.id] ?? 0), 0);
                const prev = mi > 0 ? data.months[mi - 1] : null;
                const prevHasAny = prev && idleRows.some((r) => r.values[prev.id] != null);
                const prevTotal = prev ? idleRows.reduce((sum, r) => sum + (r.values[prev.id] ?? 0), 0) : null;
                const diff = hasAny && prevHasAny ? total - prevTotal : null;
                return (
                  <td key={m.id} style={{ ...numericStyle, fontWeight: 600, color: 'var(--color-primary)' }}>
                    {hasAny ? formatEur(total) : DASH}
                    <DiffLabel diff={diff} />
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
