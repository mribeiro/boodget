import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBullseye, faCircleCheck, faTriangleExclamation, faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { GlanceCard } from './CapitalGlance';

function formatEur(value) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + ' €';
}

export default function GoalsGlance({ goals, onClick, efStatus, onEfClick }) {
  const efUnderfunded = efStatus?.status === 'underfunded';

  function handleEfClick(e) {
    e.stopPropagation();
    onEfClick?.();
  }

  const efBanner = efUnderfunded && (
    <div
      onClick={handleEfClick}
      style={{ marginTop: 4, paddingTop: 8, borderTop: '1px solid var(--border-default)', cursor: onEfClick ? 'pointer' : 'default' }}
    >
      <div className="text-sm" style={{ color: 'var(--color-danger-text)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
        <FontAwesomeIcon icon={faShieldHalved} />
        Emergency Fund: {formatEur(efStatus.deficit)} short
        <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginLeft: 'auto', color: 'var(--color-danger)' }} />
      </div>
      <div className="text-xs" style={{ color: 'var(--text-muted)', marginTop: 2 }}>
        Target: {formatEur(efStatus.target_value)}
      </div>
    </div>
  );

  if (goals.length === 0) {
    return (
      <GlanceCard title="Goals" icon={faBullseye} color={efUnderfunded ? 'red' : 'neutral'} onClick={onClick}>
        <p style={msgStyle}>No goals defined</p>
        {efBanner}
      </GlanceCard>
    );
  }

  const active = goals.filter((g) => g.state === 'active').length;
  const completed = goals.filter((g) => g.state === 'completed').length;
  const failed = goals.filter((g) => g.state === 'failed').length;

  const color = failed > 0 || efUnderfunded ? 'red' : 'neutral';

  return (
    <GlanceCard title="Goals" icon={faBullseye} color={color} onClick={onClick}>
      {active > 0 && (
        <div className="text-lg" style={{ color: 'var(--text-primary)', marginBottom: 2 }}>
          <FontAwesomeIcon icon={faBullseye} style={{ marginRight: '0.4rem', opacity: 0.6 }} />{active} active
        </div>
      )}
      {completed > 0 && (
        <div className="text-sm" style={{ color: 'var(--color-success-text)', marginBottom: 2 }}>
          <FontAwesomeIcon icon={faCircleCheck} style={{ marginRight: '0.4rem' }} />{completed} completed
        </div>
      )}
      {failed > 0 && (
        <div className="text-sm" style={{ color: 'var(--color-danger-text)', fontWeight: 600 }}>
          <FontAwesomeIcon icon={faTriangleExclamation} style={{ marginRight: '0.4rem' }} />{failed} failed
        </div>
      )}
      {efBanner}
    </GlanceCard>
  );
}

const msgStyle = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
