import { Badge } from 'capital-tracker-frontend';

export const Variants = () => (
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <Badge variant="success">Covered</Badge>
    <Badge variant="warning">Amber</Badge>
    <Badge variant="danger">Over budget</Badge>
    <Badge variant="brand">New</Badge>
    <Badge variant="neutral">Draft</Badge>
    <Badge variant="dark">Archived</Badge>
  </div>
);

export const InContext = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Streaming bundle</span>
    <Badge variant="success">Covered</Badge>
  </div>
);
