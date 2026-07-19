import { Checkbox } from 'capital-tracker-frontend';

export const CheckedAndUnchecked = () => (
  <div style={{ display: 'flex', gap: 20 }}>
    <Checkbox checked={true} onChange={() => {}} title="Mark as unpaid" />
    <Checkbox checked={false} onChange={() => {}} title="Mark as paid" />
  </div>
);

// The real app never uses the `label` prop (verified: zero usages outside
// the component's own JSDoc) — it renders a caption as a separate sibling
// element instead. That's not a style preference: the checkbox's own box is
// a fixed 20x20px with `justify-content: center`, so a `label` wider than
// the box centers-and-overflows in both directions and visibly overlaps the
// checkmark for any non-trivial caption. This preview follows the real,
// working convention.
export const WithCaption = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
    <Checkbox checked={true} onChange={() => {}} />
    <span style={{ fontSize: 13 }}>Enable AI features for this dossier</span>
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
      <Checkbox checked={true} onChange={() => {}} disabled title="Already paid" />
      <span style={{ fontSize: 13 }}>Already paid</span>
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: 0.6 }}>
      <Checkbox checked={false} onChange={() => {}} disabled title="No installment due yet" />
      <span style={{ fontSize: 13 }}>No installment due yet</span>
    </div>
  </div>
);
