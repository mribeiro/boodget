import { useState } from 'react';
import { CollapsibleSection } from 'capital-tracker-frontend';
import { faWallet } from '@fortawesome/free-solid-svg-icons';

export const WithCountBadge = () => {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <CollapsibleSection
      title="Investments"
      count={4}
      accent="var(--color-brand)"
      collapsed={collapsed}
      onToggle={() => setCollapsed((v) => !v)}
    >
      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>4 accounts — Guaranteed Investment, Risk Investment.</div>
    </CollapsibleSection>
  );
};

export const WithIcon = () => (
  <CollapsibleSection
    title="Loan details"
    icon={faWallet}
    accent="var(--text-muted)"
    collapsed={false}
    onToggle={() => {}}
  >
    <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
      Purchase price: 220,000 €<br />
      Down payment: 20,000 €<br />
      TAEG: 3.8 %
    </div>
  </CollapsibleSection>
);

export const Collapsed = () => (
  <CollapsibleSection
    title="Archived accounts"
    count={12}
    accent="var(--text-muted)"
    collapsed={true}
    onToggle={() => {}}
  >
    <div>This content is hidden while collapsed.</div>
  </CollapsibleSection>
);
