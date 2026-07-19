import { KpiBlock } from 'capital-tracker-frontend';
import { faWallet, faReceipt, faCircleCheck } from '@fortawesome/free-solid-svg-icons';

export const HighlightSweep = () => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
    <KpiBlock label="Salary" value="3,200 €" icon={faWallet} highlight="neutral" />
    <KpiBlock label="Expenses" value="1,840 €" icon={faReceipt} highlight="danger" />
    <KpiBlock label="Paid" value="1,200 €" icon={faCircleCheck} highlight="success" />
  </div>
);

export const LargeWithNote = () => (
  <KpiBlock
    label="Curr. balance"
    value="1,360 €"
    icon={faWallet}
    highlight="success"
    large
    note="Projected from unpaid items"
  />
);
