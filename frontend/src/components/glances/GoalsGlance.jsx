import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBullseye, faCircleCheck, faTriangleExclamation, faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { GlanceCard } from './CapitalGlance';
import { formatNumber } from '../../utils/numbers';

function formatEur(value) {
  return formatNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' €';
}

export default function GoalsGlance({ goals, onClick, efStatus, onEfClick }) {
  const efUnderfunded = efStatus?.status === 'underfunded';

  function handleEfClick(e) {
    e.stopPropagation();
    onEfClick?.();
  }

  function renderEfBanner(compact) {
    if (!efUnderfunded) return null;
    return (
      <div
        onClick={handleEfClick}
        style={{ marginTop: compact ? 5 : 4, paddingTop: compact ? 5 : 6, borderTop: '1px solid var(--border-default)', cursor: onEfClick ? 'pointer' : 'default' }}
      >
        <div className="text-xs" style={{ color: 'var(--color-danger-text)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
          <FontAwesomeIcon icon={faShieldHalved} />
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {compact
              ? <>{formatEur(efStatus.deficit)} short of {formatEur(efStatus.target_value)}</>
              : <>Emergency Fund: {formatEur(efStatus.deficit)} short</>}
          </span>
          <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginLeft: 'auto', color: 'var(--color-danger)', flexShrink: 0 }} />
        </div>
        {!compact && (
          <div className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 2 }}>
            Target: {formatEur(efStatus.target_value)}
          </div>
        )}
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <GlanceCard title="Goals" icon={faBullseye} color={efUnderfunded ? 'red' : 'neutral'} onClick={onClick}>
        <p style={msgStyle}>No goals defined</p>
        {renderEfBanner(false)}
      </GlanceCard>
    );
  }

  const active = goals.filter((g) => g.state === 'active').length;
  const completed = goals.filter((g) => g.state === 'completed').length;
  const failed = goals.filter((g) => g.state === 'failed').length;

  const color = failed > 0 || efUnderfunded ? 'red' : 'neutral';

  const avgCompleteness =
    goals.reduce((sum, g) => sum + Math.min(100, (g.total_current_progress / g.target_value) * 100), 0) /
    goals.length;

  const barColor =
    avgCompleteness < 25 ? 'var(--color-danger)' :
    avgCompleteness < 75 ? 'var(--color-warning)' :
    'var(--color-success)';

  return (
    <GlanceCard title="Goals" icon={faBullseye} color={color} onClick={onClick}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {active > 0 && (
            <span className="text-lg" style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              <FontAwesomeIcon icon={faBullseye} style={{ marginRight: '0.4rem', opacity: 0.6 }} />{active} active
            </span>
          )}
          {completed > 0 && (
            <span className="text-sm" style={{ color: 'var(--color-success-text)', whiteSpace: 'nowrap' }}>
              <FontAwesomeIcon icon={faCircleCheck} style={{ marginRight: '0.4rem' }} />{completed} completed
            </span>
          )}
          {failed > 0 && (
            <span className="text-sm" style={{ color: 'var(--color-danger-text)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.4rem' }} />{failed} failed
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 }}>
          <div className="progress-track" style={{ flex: 1 }}>
            <div className="progress-fill" style={{ width: `${avgCompleteness}%`, background: barColor }} />
          </div>
          <span className="text-xs tabular" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{avgCompleteness.toFixed(0)}%</span>
        </div>
        {renderEfBanner(true)}
      </div>
    </GlanceCard>
  );
}

const msgStyle = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
