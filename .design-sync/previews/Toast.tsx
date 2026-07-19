import { Toast } from 'capital-tracker-frontend';

export const Visible = () => (
  <div style={{ position: 'relative', height: 120 }}>
    <Toast message="Account saved" visible={true} />
  </div>
);

export const Hidden = () => (
  <div style={{ position: 'relative', height: 120 }}>
    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>visible=false — Toast renders faded out, non-interactive</div>
    <Toast message="Account saved" visible={false} />
  </div>
);
