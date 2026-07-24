export default function ClassificationPills({ value, onChange }) {
  const options = [
    { value: 'must', label: 'Must', activeClass: 'must-active' },
    { value: 'want', label: 'Want', activeClass: 'want-active' },
  ];
  return (
    <span className="class-toggle">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`class-pill${active ? ` ${opt.activeClass}` : ''}`}
            onClick={() => onChange(active ? null : opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </span>
  );
}
