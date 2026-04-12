# Capital Tracker — Reference Screens Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION_UI.md`, `SPECIFICATION_ICONS.md`, and all other existing specifications.
- This document describes **two reference screen implementations** provided as standalone JSX files. These files are **visual references only** — they are not meant to be dropped into the codebase as-is.
- The reference files use mock data and inline styles to demonstrate the intended look, layout, and interactions. When implementing, use the project's existing CSS variables, component library, and data-fetching patterns.
- **All icons use Font Awesome** as specified in `SPECIFICATION_ICONS.md`. No emoji characters.
- Reference files are located in `ai-spec/reference/`:
  - `reference-dashboard-desktop.jsx` — Desktop dashboard layout
  - `reference-cycle-editor-desktop.jsx` — Desktop cycle editor layout
  - `reference-dashboard-mobile.jsx` — Mobile dashboard layout
  - `reference-cycle-editor-mobile.jsx` — Mobile cycle editor layout
- Before generating any files, **propose the list of files to be created or modified** and wait for approval.

-----

## 1. Overview

The reference screens demonstrate two key views of the application in both desktop and mobile layouts:

1. **Dashboard** — A summary landing page shown when a dossier is opened, displaying capital overview, glances, accounts, and recent expenses at a glance.
2. **Cycle Editor** — The interactive expense cycle management page with inputs, checkboxes, progress bars, and action buttons.

-----

## 2. Dashboard Screen

### 2.1 Purpose

The Dashboard is NOT a new page — it represents the **DossierView** default state when no specific tab is actively selected, or can serve as the visual design reference for how the Glances panel + Capital tab should look together. The key elements are:

### 2.2 Layout — Desktop

```
┌─────────────────────────────────────────────────────────────┐
│  Hero Capital Card (full width)                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  CAPITAL TOTAL         €87.432,50   ↑ +3.2% vs. Mar    │ │
│  │                        Idle: €12.000,00                 │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  Glances Row (4 cards, equal width)                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Emerg.   │ │ Cycle    │ │ Next Exp │ │ Goals    │       │
│  │ Fund     │ │ Balance  │ │          │ │          │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                              │
│  Two Columns                                                 │
│  ┌─────────────────────┐  ┌─────────────────────┐           │
│  │ Accounts Table      │  │ Recent Expenses     │           │
│  │ (group, value, Δ)   │  │ (name, cat, amount) │           │
│  └─────────────────────┘  └─────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 Layout — Mobile

```
┌─────────────────────────┐
│  Header (greeting + avatar) │
│                              │
│  Hero Capital Card           │
│  (full width, compact)       │
│                              │
│  Glances Grid (2x2)         │
│  ┌─────────┐ ┌─────────┐   │
│  │ Emerg.  │ │ Cycle   │   │
│  └─────────┘ └─────────┘   │
│  ┌─────────┐ ┌─────────┐   │
│  │ Next    │ │ Goals   │   │
│  └─────────┘ └─────────┘   │
│                              │
│  Accounts (stacked cards)    │
│                              │
│  Recent Expenses (list)      │
│                              │
│  ┌───────────────────────┐  │
│  │  Bottom Nav Bar       │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

### 2.4 Hero Capital Card

- Background: subtle gradient using brand/success colours at low opacity.
- Border: 1px solid with brand colour at low opacity.
- Border radius: `var(--radius-lg)` (16px).
- Content:
  - Label: "CAPITAL TOTAL" (uppercase, muted, small).
  - Value: large (34-40px), weight 800, animated count-up on mount.
  - Variation pill: rounded badge showing `↑ +X.X%` or `↓ -X.X%` with icon `fa-arrow-up` / `fa-arrow-down`. Green bg tint for positive, red for negative.
  - Idle money indicator: small dot + "€X.XXX,XX em dinheiro parado" — only shown when idle money > 0.

### 2.5 Glances Cards

Each card follows the existing Glances specification but with these visual enhancements:

- Left accent border (3px) coloured by card state.
- Header row: FA icon + uppercase label.
- Content varies by card type.
- Cards are clickable (navigate to relevant tab).
- Desktop: 4 in a row (`display: flex`, equal widths).
- Mobile: 2×2 grid.

### 2.6 Accounts Section

- Desktop: table with columns — Account name (+ group subtitle), Value, Variation.
- Mobile: stacked card rows with name/group left, value/change right.
- Table header row uses uppercase muted labels.
- Hover state on rows (desktop).
- Variation column colour-coded green/red.

### 2.7 Recent Expenses Section

- List of the 5 most recent expenses from the current cycle.
- Each row: classification icon (`fa-thumbtack` for must, `fa-sparkles` for want) in a tinted circle + name/date + classification badge + amount.
- Hover state on rows (desktop).

-----

## 3. Cycle Editor Screen

### 3.1 Purpose

The Cycle Editor is an **enhancement to the existing `CycleEditor.jsx`**. It adds a summary panel and modernises the layout while keeping all existing functionality.

### 3.2 Layout — Desktop

```
┌──────────────────────────────────────────────────────────────┐
│  Header: "Ciclo Abril 2026" [Open badge] [Delete btn]       │
│  Subtitle: "25 Mar – 24 Abr"                                │
│                                                               │
│  ┌──────┐ ┌──────────┐ ┌───────────────────────────────────┐ │
│  │Salary│ │Prev. Bal.│ │  Summary KPIs (5 columns)         │ │
│  │input │ │input     │ │  Available|Expenses|Paid|Unpaid|Bal│ │
│  └──────┘ └──────────┘ └───────────────────────────────────┘ │
│                                                               │
│  ┌─────────────────────────────────┐ ┌──────────────────────┐ │
│  │ Fixed Expenses Table            │ │ Distributions        │ │
│  │ [✓] Name [badge] | Value | Day │ │ [✓] Name | Value     │ │
│  │ ...                             │ │ ...                  │ │
│  │                                 │ │                      │ │
│  │ Budgets                         │ │ Close Cycle Panel    │ │
│  │ Name [badge] | progress bar    │ │ [Final balance input]│ │
│  │ [spent input] / max            │ │ [Difference display] │ │
│  │ ...                             │ │ [Close button]       │ │
│  └─────────────────────────────────┘ └──────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

- Left column (60%): Fixed expenses table + Budget expenses section.
- Right column (40%): Distributions + Close cycle panel.
- Top row: Salary input + Previous balance input + Summary KPIs.

### 3.3 Layout — Mobile

```
┌───────────────────────────┐
│  Header: ← Ciclo Abril    │
│  [Open badge]  25 Mar-24 Abr│
│                              │
│  ┌──────────┐ ┌──────────┐  │
│  │ Salary   │ │ Prev Bal │  │
│  │ [input]  │ │ [input]  │  │
│  └──────────┘ └──────────┘  │
│                              │
│  ▼ Summary (collapsible)     │
│    KPI grid (3+2 layout)     │
│    Expected balance bar      │
│                              │
│  ▼ Fixed Expenses (collapsi.)│
│    [✓] Renda [must] €650     │
│    [✓] Electr. [must] €89,50│
│    ...                       │
│    [+ Adicionar]             │
│                              │
│  ▼ Budgets                   │
│    Supermercado [must]  53%  │
│    [progress bar]            │
│    [spent input] / €350      │
│    ...                       │
│                              │
│  ▼ Distributions (collapsi.) │
│    [✓] Fundo Emerg. €200    │
│    ...                       │
│    [+ Adicionar]             │
│                              │
│  Close Cycle Panel           │
│  [Final balance input]       │
│  [Difference]                │
│  [Fechar Ciclo button]       │
└───────────────────────────────┘
```

- All sections are collapsible on mobile.
- Salary and Previous Balance side by side (2 columns).
- Everything else stacks vertically.

### 3.4 Interactive Elements

#### 3.4.1 Salary & Previous Balance Inputs

- Number inputs with `€` prefix.
- Update cycle summary in real-time.
- Use the project's `NumInput` component (or equivalent from the reference).

#### 3.4.2 Fixed Expense Rows

- Custom checkbox (project's `<Checkbox>` component) for paid status.
- When checked:
  - Row opacity reduces to 0.5.
  - Name gets `text-decoration: line-through`.
  - Value colour fades.
  - Smooth transition (250ms).
- Classification badge (`must` / `want`) next to name.
- Day of payment shown.
- Actions column (edit/delete) — icon buttons.

#### 3.4.3 Budget Expense Rows

- No checkbox (budgets don't have paid status).
- Progress bar: track + fill, colour changes based on %, animated width.
  - < 60%: `--color-success` (green)
  - 60–90%: `--color-warning` (amber)
  - > 90%: `--color-danger` (red)
- Inline number input for `spent` value.
- Max value displayed (read-only).
- Classification badge.

#### 3.4.4 Distribution Rows

- Custom checkbox for `done` status.
- Same visual treatment as fixed expenses when checked (line-through, faded).
- Checkbox colour: blue (`--color-brand`) instead of green.

#### 3.4.5 Summary Panel

- Real-time recalculation of all values.
- Desktop: 5 KPI blocks in a horizontal row.
- Mobile: 3+2 grid layout.
- Expected balance highlighted with coloured background (green if positive, red if negative).

#### 3.4.6 Close Cycle Panel

- Input for "Final Real Balance" with `€` prefix.
- Difference calculation displayed below (colour-coded).
- "Fechar Ciclo" primary button with `fa-check` icon.
- Only shown when cycle is open.
- When cycle is closed: show "Reabrir" (secondary with `fa-arrow-rotate-left`) and "Eliminar" (danger with `fa-trash`) buttons.

#### 3.4.7 Add Buttons

- Each section (Fixed Expenses, Budgets, Distributions) has an "Adicionar" button.
- Ghost variant with `fa-plus` icon.
- Opens the relevant creation modal (existing functionality).

### 3.5 Toast Notifications

- Success toasts appear on: cycle closed, cycle reopened, item added, item deleted.
- Position: bottom-right on desktop, bottom-center on mobile.
- Green background, dark text, rounded, shadow.
- Auto-dismiss after 2 seconds.
- Slide-up entrance animation.

-----

## 4. Shared Component Patterns

### 4.1 Animated Number

A utility component that animates from 0 to the target value on mount using `requestAnimationFrame` with easing. Used for the hero capital value. Duration: ~900ms, cubic ease-out.

### 4.2 Progress Ring (SVG)

A circular progress indicator used in Glance cards. Props: `pct` (0-1), `size`, `strokeWidth`, `color`, `bgColor`. Animated stroke-dashoffset on mount.

### 4.3 Collapsible Section (Mobile)

A wrapper component with a clickable header that toggles content visibility. Header shows:
- Left: accent bar + title + optional count badge.
- Right: chevron icon (`fa-chevron-down`) that rotates 180° when expanded.

-----

## 5. Colour Semantics Reminder

These reference screens use the following colour semantics consistently:

| Colour    | Hex (dark theme) | Token                  | Meaning                    |
|-----------|------------------|------------------------|----------------------------|
| Green     | `#6ee7b7`        | `--color-success`      | Positive, paid, done, good |
| Red       | `#f87171`        | `--color-danger`       | Negative, unpaid, danger   |
| Amber     | `#fbbf24`        | `--color-warning`      | Attention, pending, caution|
| Blue      | `#3b82f6`        | `--color-brand`        | Neutral, informational     |

-----

## 6. Implementation Notes

When implementing these screens into the actual codebase:

1. **Do not copy inline styles** — translate them into the project's CSS variable system.
2. **Use existing components** — `Checkbox`, `Badge`, `Button`, `Card`, `Table` from `frontend/src/components/ui/`.
3. **Use existing data fetching** — replace mock data with API calls via `services/api.js`.
4. **Use existing routing** — these screens integrate into the existing React Router structure.
5. **Font Awesome icons** — use `<FontAwesomeIcon>` as specified in `SPECIFICATION_ICONS.md`.
6. **The reference files use `DM Sans` font** — the actual app uses `Inter`. Ignore the font choice in reference files.
7. **Toast notifications** — integrate with the project's existing toast/notification system if one exists, or create a lightweight `Toast` component.
8. **Animations** — use `@keyframes` in `index.css` rather than inline transition hacks.
