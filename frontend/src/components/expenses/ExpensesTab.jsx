import CycleList from './CycleList';

export default function ExpensesTab({ dossierId, settings }) {
  return (
    <div>
      <CycleList dossierId={dossierId} settings={settings} />
    </div>
  );
}
