import { Button } from 'capital-tracker-frontend';

export const Variants = () => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
    <Button variant="primary">Save changes</Button>
    <Button variant="secondary">Cancel</Button>
    <Button variant="ghost">Skip</Button>
    <Button variant="danger">Delete account</Button>
  </div>
);

export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
    <Button variant="primary" size="sm">Small</Button>
    <Button variant="primary" size="md">Medium</Button>
    <Button variant="primary" size="lg">Large</Button>
    <Button variant="secondary" size="icon" title="Edit">✎</Button>
  </div>
);

export const Disabled = () => (
  <div style={{ display: 'flex', gap: 10 }}>
    <Button variant="primary" disabled>Saving…</Button>
    <Button variant="danger" disabled>Delete account</Button>
  </div>
);
