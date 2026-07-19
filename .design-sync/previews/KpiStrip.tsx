import { KpiStrip } from 'capital-tracker-frontend';
import { faMoneyBillWave, faWallet, faSackDollar, faReceipt, faCircleCheck, faClock, faPiggyBank } from '@fortawesome/free-solid-svg-icons';

export const CycleSummary = () => (
  <KpiStrip
    defaultOpen
    items={[
      { label: 'Salary', value: '3,200 €', icon: faMoneyBillWave },
      { label: 'Prev. bal.', value: '450 €', icon: faWallet },
      { label: 'Available', value: '3,650 €', icon: faSackDollar },
      { label: 'Expenses', value: '1,840 €', icon: faReceipt, highlight: 'danger' },
      { label: 'Paid', value: '1,200 €', icon: faCircleCheck, highlight: 'success' },
      { label: 'Unpaid', value: '640 €', icon: faClock, highlight: 'warning' },
      { label: 'Curr. balance', value: '1,810 €', icon: faWallet, highlight: 'success', large: true },
      { label: 'Exp. balance', value: '1,170 €', icon: faPiggyBank, highlight: 'success' },
    ]}
  />
);

export const LoansSummary = () => (
  <KpiStrip
    defaultOpen
    items={[
      { label: 'Monthly total', value: '620 €', large: true },
      { label: 'Total amount due', value: '18,400 €' },
      { label: 'Loans ongoing', value: '2' },
      { label: '% of salary', value: '19.4%', highlight: 'warning', note: '620 € of 660 € (20% max) · 40 € free' },
    ]}
  />
);
