## Setup

No provider/root wrapper is required — every component here renders standalone
(no ThemeProvider, no context). Just import from the bundle and use directly.

One optional runtime toggle: dark mode is driven by a `[data-theme="dark"]`
attribute on an ancestor (normally `<html>` or `<body>`) — set
`document.documentElement.dataset.theme = 'dark'` to opt a screen into dark
mode. Omit it for the light theme (the default — every token below already
has a light-theme value at `:root`).

Fonts: the real app loads **Inter** from Google Fonts via an HTML `<link>` tag
(not shipped in this bundle). Add the same `<link>` if you want the exact
typeface; otherwise text falls back to the system sans-serif stack, which is
close but not identical.

## Styling idiom: CSS custom properties + a small text-size utility set

This is not a utility-class framework (no Tailwind-style `bg-*`/`p-*` grid) —
components are styled by their own internal classes (`btn-primary`, `card`,
`badge-success`, …), and **your own layout glue should use the design
tokens directly**, as CSS custom properties (`var(--name)`), the same way the
components' own source does. Real names, straight from `styles.css`:

| Purpose | Tokens |
|---|---|
| Surfaces | `--bg-app`, `--bg-card`, `--bg-card-hover`, `--bg-input`, `--bg-overlay`, `--bg-table-header` |
| Borders | `--border-default`, `--border-strong`, `--border-focus`, `--border-input` |
| Text | `--text-primary`, `--text-secondary`, `--text-muted`, `--text-disabled`, `--text-on-dark`, `--text-link` |
| Brand | `--color-brand`, `--color-brand-hover`, `--color-brand-light` |
| Semantic | `--color-success`/`-hover`/`-light`/`-text`/`-border`, same pattern for `warning` and `danger` |
| Financial | `--color-value-positive`, `--color-value-negative`, `--color-value-neutral` |
| Shadows | `--shadow-sm`, `--shadow-md`, `--shadow-lg`, `--shadow-modal` |
| Radius | `--radius-xs` (3px) … `--radius-xl` (16px), `--radius-full` |
| Spacing (4px base) | `--space-1` (4px) … `--space-12` (48px) |
| Z-index | `--z-sidebar`, `--z-navbar`, `--z-dropdown`, `--z-modal`, `--z-toast` |
| Transitions | `--transition-fast`/`-normal`/`-slow` |

A handful of text-size utility classes exist for typography outside the
components: `.text-xs` … `.text-3xl` (11px→24px, weight scales with size),
plus `.text-muted`, `.text-secondary`, and `.tabular` (tabular-nums, for
aligning numeric columns — this app is a finance tracker, use it for money
values). Prefer these + the tokens above over inventing new class names or
hardcoded hex colors/px values — nothing here is themeable if you do.

## Where the truth lives

Read `styles.css` (imports `_ds_bundle.css`, which is the app's real
`index.css` verbatim — same file, so no drift) before styling anything
non-trivial; it's the full token list and every component class, not a
subset. Each component's `.prompt.md` has its real usage patterns pulled
from the actual app where they exist.

## Example

```jsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
  <Card style={{ maxWidth: 320 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontWeight: 700 }}>Emergency Fund</span>
      <Badge variant="danger">Underfunded</Badge>
    </div>
    <div className="text-muted text-sm" style={{ marginTop: 4 }}>2,340 € short of target</div>
    <Button variant="primary" size="sm" style={{ marginTop: 'var(--space-3)' }}>Review</Button>
  </Card>
</div>
```
