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
        <div className="text-lg" style={{ color: 'var(--text-primary)', marginBottom: 2 }}>
          {active} active
        </div>
      )}
      {completed > 0 && (
        <div className="text-sm" style={{ color: 'var(--color-success-text)', marginBottom: 2 }}>
          {completed} completed
        </div>
      )}
      {failed > 0 && (
        <div className="text-sm" style={{ color: 'var(--color-danger-text)', fontWeight: 600 }}>
          {failed} failed ⚠
        </div>
      )}
    </GlanceCard>
  );
}

const msgStyle = { margin: 0, fontSize: 13, color: 'var(--text-muted)' };
