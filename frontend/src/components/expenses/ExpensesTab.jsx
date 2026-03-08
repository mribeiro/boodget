import CycleList from './CycleList';

export default function ExpensesTab({ dossierId }) {
  return (
    <div>
      <CycleList dossierId={dossierId} />
    </div>
  );
}
