import { useState } from 'react';
import { CollapsibleShell } from './CollapsibleSection';

/**
 * SettingsCard — a top-level settings section.
 *
 * The card-title level of the three collapsible headers (see SPECIFICATION_UI.md
 * §6.8): 16px/600, no fill — one per settings section, itself a card rather than
 * sitting inside one (contrast with CollapsibleSection, the sub-group level).
 *
 * Props:
 *   title       — card heading
 *   description — optional hint shown above children when open
 *   defaultOpen — initial expanded state (uncontrolled)
 *   children    — expanded content
 */
export default function SettingsCard({ title, description, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <CollapsibleShell
      containerClassName="card card--flat"
      containerStyle={{ marginBottom: 'var(--space-5)' }}
      headerClassName="settings-card-header"
      open={open}
      onToggle={() => setOpen((v) => !v)}
      header={<h2>{title}</h2>}
    >
      <div style={{ paddingTop: 'var(--space-4)' }}>
        {description && <p className="hint" style={{ marginTop: 0, marginBottom: 'var(--space-4)' }}>{description}</p>}
        {children}
      </div>
    </CollapsibleShell>
  );
}
