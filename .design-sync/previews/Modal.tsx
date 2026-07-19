import { Modal, Button } from 'capital-tracker-frontend';

export const EditFieldModal = () => (
  <Modal
    title="Reference monthly salary"
    onClose={() => {}}
    footer={
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary">Save</Button>
      </div>
    }
  >
    <label style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
      Monthly salary (€)
    </label>
    <input type="text" defaultValue="3,200" style={{ width: '100%' }} />
  </Modal>
);

export const NoFooter = () => (
  <Modal title="Archived accounts" onClose={() => {}}>
    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
      12 archived accounts — historical data is preserved.
    </div>
  </Modal>
);
