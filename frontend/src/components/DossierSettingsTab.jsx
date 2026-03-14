import DossierSettings from './expenses/DossierSettings';
import ExpenseTemplate from './expenses/ExpenseTemplate';
import AnnualExpenseTemplate from './expenses/AnnualExpenseTemplate';

function SettingsCard({ title, description, children }) {
  return (
    <div className="card card--flat" style={{ marginBottom: 'var(--space-5)' }}>
      <h2 style={{
        fontSize: 16, fontWeight: 600,
        borderBottom: '1px solid var(--border-default)',
        paddingBottom: 'var(--space-3)',
        marginBottom: 'var(--space-4)',
      }}>
        {title}
      </h2>
      {description && (
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 'var(--space-4)' }}>
          {description}
        </p>
      )}
      {children}
    </div>
  );
}

export default function DossierSettingsTab({ dossierId }) {
  return (
    <div>
      <SettingsCard title="Cycle Settings">
        <DossierSettings dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard
        title="Monthly Expense Template"
        description="Template entries are copied into each new cycle. Changes here do not affect existing cycles. Use the Classification column to set Must/Want for Workbench calculations."
      >
        <ExpenseTemplate dossierId={dossierId} />
      </SettingsCard>

      <SettingsCard
        title="Annual Expense Template"
        description="Annual expenses are used in the Workbench (as monthly averages). They are not copied into cycles."
      >
        <AnnualExpenseTemplate dossierId={dossierId} />
      </SettingsCard>
    </div>
  );
}
