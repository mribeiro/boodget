import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { GlanceCard } from './CapitalGlance';

function formatEur(value) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value) + ' €';
}

export default function EmergencyFundGlance({ efStatus, onClick }) {
  if (!efStatus || efStatus.status !== 'underfunded') return null;

  return (
    <GlanceCard title="Emergency Fund" icon={faShieldHalved} color="red" onClick={onClick}>
      <div className="text-lg" style={{ color: 'var(--color-danger-text)', fontWeight: 700, marginBottom: 2 }}>
        {formatEur(efStatus.deficit)} short
      </div>
      <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Target: {formatEur(efStatus.target_value)}
      </div>
    </GlanceCard>
  );
}
