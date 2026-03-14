import { GlanceCard } from './CapitalGlance';

export default function GoalsGlance({ goals, onClick }) {
  if (goals.length === 0) {
    return (
      <GlanceCard title="Goals" color="neutral" onClick={onClick}>
        <p style={msgStyle}>No goals defined</p>
      </GlanceCard>
    );
  }

  const active = goals.filter((g) => g.state === 'active').length;
  const completed = goals.filter((g) => g.state === 'completed').length;
  const failed = goals.filter((g) => g.state === 'failed').length;

  const color = failed > 0 ? 'red' : 'neutral';

  return (
    <GlanceCard title="Goals" color={color} onClick={onClick}>
      {active > 0 && (
        <div style={{ fontSize: '0.85rem', color: 'var(--color-text)', marginBottom: '0.1rem' }}>
          {active} active
        </div>
      )}
      {completed > 0 && (
        <div style={{ fontSize: '0.85rem', color: '#16a34a', marginBottom: '0.1rem' }}>
          {completed} completed
        </div>
      )}
      {failed > 0 && (
        <div style={{ fontSize: '0.85rem', color: '#dc2626', fontWeight: 600 }}>
          {failed} failed ⚠
        </div>
      )}
    </GlanceCard>
  );
}

const msgStyle = { margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' };
