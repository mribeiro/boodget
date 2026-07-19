import { Card } from 'capital-tracker-frontend';

export const Default = () => (
  <Card style={{ maxWidth: 280 }}>
    <div style={{ fontWeight: 700, marginBottom: 6 }}>My Finances</div>
    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Default dossier — 6 accounts, updated this month.</div>
  </Card>
);

export const FlatAndClickable = () => (
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
    <Card variant="flat" style={{ maxWidth: 220 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Flat</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No shadow — used inside another surface.</div>
    </Card>
    <Card variant="clickable" style={{ maxWidth: 220 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Clickable</div>
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Hover for a lift + background change.</div>
    </Card>
  </div>
);

export const AccentBorder = () => (
  <Card accentColor="var(--color-danger)" style={{ maxWidth: 280 }}>
    <div style={{ fontWeight: 700, marginBottom: 4 }}>Emergency Fund</div>
    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Underfunded — 2,340 € short of target.</div>
  </Card>
);
