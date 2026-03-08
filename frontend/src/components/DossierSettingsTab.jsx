import DossierSettings from './expenses/DossierSettings';
import ExpenseTemplate from './expenses/ExpenseTemplate';

export default function DossierSettingsTab({ dossierId }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
      <section>
        <h2 style={{ margin: '0 0 1.25rem 0', fontSize: '1rem', fontWeight: 600 }}>Expenses</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: '0.6rem' }}>
              Cycle start day
            </div>
            <DossierSettings dossierId={dossierId} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>
              Expense template
            </div>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem', margin: '0 0 0.75rem 0' }}>
              Template entries are copied into each new cycle. Changes here do not affect existing cycles.
            </p>
            <ExpenseTemplate dossierId={dossierId} />
          </div>
        </div>
      </section>
    </div>
  );
}
