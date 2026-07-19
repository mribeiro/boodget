// Hand-authored entry point for claude.ai/design sync (see /design-sync).
// frontend/src/components/ui/*.jsx are default-export-only, and `export *`
// never re-exports a `default` binding — so these are named explicitly.
// Side-effect import registers the FontAwesome icons the ui/ components
// reference by string name (e.g. Checkbox's icon="check").
import './src/icons.js';

export { default as Badge } from './src/components/ui/Badge.jsx';
export { default as Button } from './src/components/ui/Button.jsx';
export { default as Card } from './src/components/ui/Card.jsx';
export { default as Checkbox } from './src/components/ui/Checkbox.jsx';
export { default as CollapsibleSection } from './src/components/ui/CollapsibleSection.jsx';
export { default as KpiBlock } from './src/components/ui/KpiBlock.jsx';
export { default as KpiStrip } from './src/components/ui/KpiStrip.jsx';
export { default as Modal } from './src/components/ui/Modal.jsx';
export { default as Toast } from './src/components/ui/Toast.jsx';
