# boodget — UI / Design System Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to all existing specifications. Read `SPECIFICATION.md`, `SPECIFICATION_MONTHLY_EXPENSES.md`, `SPECIFICATION_WORKBENCH.md`, `SPECIFICATION_GOALS.md`, and `SPECIFICATION_GLANCES.md` before writing any code.
- This document defines the **visual design system and layout** for the entire application. It does **not** change any backend API, database schema, or business logic.
- All existing functionality must be **fully preserved**. This is a visual redesign only.
- Before generating any files, **propose the list of files to be created or modified** and wait for approval.
- Do **not overwrite** any backend file. Only frontend files (`frontend/src/`) and `frontend/index.html` are in scope.
- **Migration strategy**: implement in this exact order:
1. CSS variables + theme system (`index.css` + `ThemeContext`)
1. Layout shell (`App.jsx`, `Sidebar`, `Navbar`, `AppShell`)
1. Base components (buttons, inputs, cards, modals, badges, tables)
1. Screen-by-screen: Capital → Monthly Expenses → Workbench → Goals → Settings → Users
- At each step, **do not move to the next until the current compiles and renders correctly**.
- The project uses **inline styles + `index.css` with CSS variables**. Do not introduce Tailwind, CSS Modules, or any CSS-in-JS library.
- The font **Inter** must be loaded from Google Fonts via a `<link>` tag in `frontend/index.html`.

-----

## 1. Overview

The redesign transforms the current application into a modern, dashboard-grade interface inspired by the provided mockup. The visual language is clean, data-dense, and professional — dark sidebar, light content area, semantic colour coding, and a clear typographic hierarchy.

Key design principles:

- **Clarity first**: every pixel of space earns its place.
- **Semantic colour**: green = positive/done, amber = attention needed, red = urgent/negative, blue = neutral/informational.
- **Consistent spacing**: all spacing derives from a 4 px base unit.
- **Responsive**: desktop uses a collapsible sidebar; mobile uses a bottom navigation bar.
- **Theme-aware**: light, dark, and system-auto modes.

-----

## 2. Design Tokens — CSS Variables

All tokens are defined as CSS custom properties on `:root` (light theme) and overridden under `[data-theme="dark"]`. They are set in `frontend/src/index.css`.

### 2.1 Colour Palette

```css
:root {
  /* --- Sidebar --- */
  --sidebar-bg:              #1a2035;
  --sidebar-bg-hover:        #232d47;
  --sidebar-bg-active:       #2a3655;
  --sidebar-text:            #c8d0e0;
  --sidebar-text-muted:      #6b7a99;
  --sidebar-text-active:     #ffffff;
  --sidebar-border:          #252f48;
  --sidebar-logo-text:       #ffffff;

  /* --- App shell --- */
  --bg-app:                  #f0f4f8;
  --bg-navbar:               #ffffff;
  --bg-card:                 #ffffff;
  --bg-card-hover:           #f8fafc;
  --bg-input:                #ffffff;
  --bg-overlay:              rgba(0, 0, 0, 0.45);
  --bg-table-header:         #f8fafc;
  --bg-table-row-hover:      #f1f5f9;
  --bg-table-group-header:   #f1f5f9;

  /* --- Borders --- */
  --border-default:          #e2e8f0;
  --border-strong:           #cbd5e1;
  --border-focus:            #3b82f6;
  --border-input:            #d1d5db;

  /* --- Text --- */
  --text-primary:            #0f172a;
  --text-secondary:          #475569;
  --text-muted:              #94a3b8;
  --text-disabled:           #cbd5e1;
  --text-on-dark:            #ffffff;
  --text-link:               #3b82f6;

  /* --- Accent / Brand --- */
  --color-brand:             #3b82f6;
  --color-brand-hover:       #2563eb;
  --color-brand-light:       #eff6ff;

  /* --- Semantic: Success --- */
  --color-success:           #22c55e;
  --color-success-hover:     #16a34a;
  --color-success-light:     #f0fdf4;
  --color-success-text:      #15803d;
  --color-success-border:    #bbf7d0;

  /* --- Semantic: Warning --- */
  --color-warning:           #f59e0b;
  --color-warning-hover:     #d97706;
  --color-warning-light:     #fffbeb;
  --color-warning-text:      #92400e;
  --color-warning-border:    #fde68a;

  /* --- Semantic: Danger --- */
  --color-danger:            #ef4444;
  --color-danger-hover:      #dc2626;
  --color-danger-light:      #fef2f2;
  --color-danger-text:       #991b1b;
  --color-danger-border:     #fecaca;

  /* --- Semantic: Neutral / Info --- */
  --color-neutral:           #64748b;
  --color-neutral-light:     #f1f5f9;
  --color-neutral-border:    #e2e8f0;

  /* --- Value colours (financial) --- */
  --color-value-positive:    #22c55e;
  --color-value-negative:    #ef4444;
  --color-value-neutral:     #475569;

  /* --- Navbar environment tints (existing) --- */
  --color-navbar-dev:        #f0fdfa;
  --color-navbar-ephemeral:  #fff1f2;

  /* --- Shadows --- */
  --shadow-sm:    0 1px 2px rgba(0,0,0,0.05);
  --shadow-md:    0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.05);
  --shadow-lg:    0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.05);
  --shadow-modal: 0 20px 60px rgba(0,0,0,0.18), 0 4px 12px rgba(0,0,0,0.08);

  /* --- Border radius --- */
  --radius-xs:   3px;
  --radius-sm:   6px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-xl:   16px;
  --radius-full: 9999px;

  /* --- Spacing scale (4px base) --- */
  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;

  /* --- Sidebar dimensions --- */
  --sidebar-width-expanded: 220px;
  --sidebar-width-collapsed: 60px;

  /* --- Z-index stack --- */
  --z-sidebar:  100;
  --z-navbar:   90;
  --z-dropdown: 200;
  --z-modal:    300;
  --z-toast:    400;

  /* --- Transitions --- */
  --transition-fast:   120ms ease;
  --transition-normal: 200ms ease;
  --transition-slow:   300ms ease;
}
```

### 2.2 Dark Theme Overrides

```css
[data-theme="dark"] {
  /* App shell */
  --bg-app:                  #0f1117;
  --bg-navbar:               #1a1d27;
  --bg-card:                 #1e2130;
  --bg-card-hover:           #252840;
  --bg-input:                #252840;
  --bg-table-header:         #252840;
  --bg-table-row-hover:      #2a2e45;
  --bg-table-group-header:   #1e2130;

  /* Borders */
  --border-default:          #2d3250;
  --border-strong:           #3a3f5c;
  --border-input:            #3a3f5c;

  /* Text */
  --text-primary:            #e2e8f0;
  --text-secondary:          #94a3b8;
  --text-muted:              #64748b;
  --text-disabled:           #3a3f5c;

  /* Semantic: light backgrounds become darker tints */
  --color-brand-light:       #1e3a5f;
  --color-success-light:     #14291e;
  --color-success-text:      #4ade80;
  --color-success-border:    #166534;
  --color-warning-light:     #2d1f06;
  --color-warning-text:      #fbbf24;
  --color-warning-border:    #92400e;
  --color-danger-light:      #2d0f0f;
  --color-danger-text:       #f87171;
  --color-danger-border:     #991b1b;
  --color-neutral-light:     #1e2130;

  /* Sidebar stays the same — it's already dark */
}
```

-----

## 3. Typography

### 3.1 Font Loading

In `frontend/index.html`, inside `<head>`, add:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### 3.2 Base reset

In `index.css`, set on `body`:

```css
body {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
  background-color: var(--bg-app);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

### 3.3 Type Scale

|Token class |Size|Weight|Usage                                  |
|------------|----|------|---------------------------------------|
|`.text-xs`  |11px|400   |Timestamps, metadata, helper text      |
|`.text-sm`  |12px|400   |Table cells, labels, secondary info    |
|`.text-base`|14px|400   |Body text, inputs, default             |
|`.text-md`  |15px|500   |Nav items, tab labels                  |
|`.text-lg`  |16px|600   |Card titles, section headings          |
|`.text-xl`  |18px|600   |Page titles                            |
|`.text-2xl` |20px|700   |Large data values (Glances card totals)|
|`.text-3xl` |24px|700   |Hero values                            |

These are utility CSS classes available globally in `index.css`.

### 3.4 Monospace numbers

Financial values use `font-variant-numeric: tabular-nums` to keep columns aligned. Apply via the `.tabular` utility class or directly on `<td>` in tables.

-----

## 4. Theme System

### 4.1 ThemeContext

Create `frontend/src/contexts/ThemeContext.jsx`:

- Provides `{ theme, setTheme }` where `theme` ∈ `'light' | 'dark' | 'system'`.
- Default: `'system'` (reads from `localStorage.getItem('ct-theme')`, falls back to `'system'`).
- On mount and on every change, derives the **resolved theme** (`'light'` or `'dark'`) by checking `prefers-color-scheme` when `theme === 'system'`.
- Sets `document.documentElement.setAttribute('data-theme', resolvedTheme)`.
- Saves the user’s choice to `localStorage.setItem('ct-theme', theme)`.
- Adds a `matchMedia` listener on `prefers-color-scheme` to react to OS-level changes when in `system` mode.

### 4.2 Theme Toggle Button

A button in the top-right of the Navbar that cycles through `system → light → dark → system`.

|Mode    |Icon           |Tooltip           |
|--------|---------------|------------------|
|`system`|◑ (half circle)|“Following system”|
|`light` |☀              |“Light mode”      |
|`dark`  |☽              |“Dark mode”       |

-----

## 5. Layout System

### 5.1 AppShell

The root layout is composed of three regions:

```
┌─────────────────────────────────────────────┐
│  Sidebar (fixed, left)  │  Main content       │
│  220px expanded          │  ┌──────────────┐  │
│  60px collapsed          │  │  Navbar      │  │
│                          │  ├──────────────┤  │
│                          │  │  Page body   │  │
│                          │  └──────────────┘  │
└─────────────────────────────────────────────┘
```

Create `frontend/src/components/layout/AppShell.jsx`. It renders `<Sidebar>` + a main column containing `<Navbar>` + `{children}`.

The main column has `margin-left` equal to the current sidebar width (toggled via a CSS variable or class). The transition is animated (`var(--transition-slow)`).

### 5.2 Sidebar

**Component**: `frontend/src/components/layout/Sidebar.jsx`

#### Structure

```
┌──────────────────────────┐
│  Logo + "boodget" │  ← always visible (icon-only when collapsed)
├──────────────────────────┤
│  Dossier selector area   │  ← hidden when collapsed
├──────────────────────────┤
│  Nav items               │
│    € Capital             │
│    ☰ Monthly Expenses    │
│    ⚙ Workbench           │
│    ◎ Goals               │
│  ───────────────         │
│    ⚙ Settings            │
│    👤 Users              │
├──────────────────────────┤
│  Collapse toggle (bottom)│
└──────────────────────────┘
```

#### Visual specs

- **Background**: `var(--sidebar-bg)` — same in both light and dark app themes (sidebar is always dark).
- **Width**: `var(--sidebar-width-expanded)` = 220 px when expanded; `var(--sidebar-width-collapsed)` = 60 px when collapsed.
- **Collapse toggle**: a small `‹` / `›` button at the very bottom of the sidebar, centred. Clicking it toggles the sidebar. State is persisted to `localStorage` under the key `ct-sidebar-collapsed`.
- **Position**: `position: fixed`, `top: 0`, `left: 0`, `height: 100vh`, `z-index: var(--z-sidebar)`, `overflow: hidden`.
- **Transition**: `width var(--transition-slow)`.

#### Logo area

- Height: 56 px.
- Icon: a circular gradient element (`background: linear-gradient(135deg, #38bdf8, #6366f1)`, 28 px × 28 px, `border-radius: 50%`) with a capital “C” in white, 16 px, weight 700.
- Text “boodget”: 15 px, weight 700, `var(--sidebar-logo-text)`. Hidden when collapsed (use `opacity: 0; width: 0; overflow: hidden` with transition).
- A thin bottom border: `1px solid var(--sidebar-border)`.

#### Dossier selector area

- Only visible when sidebar is expanded.
- Label “Dossier:” in `var(--sidebar-text-muted)`, 11 px, uppercase, letter-spacing 0.05em.
- Below it: the current dossier name in `var(--sidebar-text-active)`, 13 px, weight 500, with a folder icon (📁 or SVG) to the left.
- The whole area is a button that opens the dossier picker (existing behaviour).
- Padding: `var(--space-2) var(--space-4)`.
- Bottom border: `1px solid var(--sidebar-border)`.

#### Nav items

Each nav item:

```
[ icon ]  [ label ]
```

- Icon: 18 px SVG icon, `var(--sidebar-text)` when inactive.
- Label: 14 px, weight 500, `var(--sidebar-text)`. Hidden when collapsed.
- Padding: `10px var(--space-4)` expanded; `10px 0` collapsed (centred icon).
- Hover: background `var(--sidebar-bg-hover)`, text `var(--sidebar-text-active)`.
- Active (current route): background `var(--sidebar-bg-active)`, text `var(--sidebar-text-active)`, a 3 px accent bar on the **left edge** in `var(--color-brand)`.
- `border-radius: var(--radius-sm)` on the item (with 4 px horizontal margin so the border-radius shows).

When collapsed, show a **tooltip** on hover (the nav item label) using CSS `::after` positioned to the right of the icon.

Nav items list (icon suggestions use Lucide React or Unicode — implement with SVG):

|Route                          |Icon            |Label           |
|-------------------------------|----------------|----------------|
|`/dossiers/:id` → Capital tab  |`€` (EuroIcon)  |Capital         |
|`/dossiers/:id` → Expenses tab |calendar/receipt|Monthly Expenses|
|`/dossiers/:id` → Workbench tab|wrench/sliders  |Workbench       |
|`/dossiers/:id` → Goals tab    |target circle   |Goals           |
|— separator —                  |                |                |
|Settings                       |gear            |Settings        |
|Users                          |user/person     |Users           |

A thin horizontal `<hr>` with `border-color: var(--sidebar-border)` separates the main nav from Settings/Users.

### 5.3 Navbar

**Component**: `frontend/src/components/layout/Navbar.jsx`

- **Height**: 56 px.
- **Background**: `var(--bg-navbar)`. When `window.__APP_ENV__ === 'dev'`, use `var(--color-navbar-dev)`. When `ephemeral`, use `var(--color-navbar-ephemeral)`.
- **Border bottom**: `1px solid var(--border-default)`.
- **Position**: `position: sticky`, `top: 0`, `z-index: var(--z-navbar)`.
- **Layout**: flexbox, `align-items: center`, `justify-content: space-between`.
- **Left**: on mobile, a hamburger button (☰) that opens the sidebar as an overlay drawer. On desktop, this area is empty or shows the current page title as breadcrumb (e.g. “My Finances / Capital”).
- **Right**: a row of controls:
1. Environment badge (if `dev` or `ephemeral`): pill badge (see Section 6.1).
1. Git SHA: 12 px, `var(--text-muted)`, e.g. `a1b2c3d`.
1. Theme toggle button (see Section 4.2).
1. User menu: avatar circle with user’s initials, clicking opens a small dropdown with “Change Password” and “Logout”.

### 5.4 Page body

- `padding: var(--space-6)` on desktop.
- `padding: var(--space-4)` on mobile.
- `max-width: 1280px` (optional, centred with `margin: 0 auto`) — only if content becomes too wide on large screens. Leave unconstrained for now unless it looks bad.

### 5.5 Mobile layout

Below **768 px**:

- **Sidebar is hidden**. Instead, a **bottom navigation bar** is rendered by `AppShell`.
- The bottom nav is a fixed bar at the bottom of the screen, `height: 56 px`, `background: var(--bg-navbar)`, `border-top: 1px solid var(--border-default)`.
- It contains 4 icon buttons: Capital, Expenses, Workbench, Goals. Each shows the icon (24 px) and a short label (10 px) below it.
- Active item: icon and label in `var(--color-brand)`. Inactive: `var(--text-muted)`.
- The Navbar on mobile shows: hamburger (opens a full-screen drawer with the remaining items: Settings, Users, theme toggle, dossier selector) + page title + optional action button (⋮ context menu, used where needed).
- Page body `padding-bottom: 72px` on mobile to avoid content hiding behind the bottom nav.

-----

## 6. Base Components

All base components live in `frontend/src/components/ui/`. They are thin wrappers that apply design tokens via inline styles and CSS classes.

### 6.1 Badge

A small pill or rectangular tag for status, environment indicators, and counts.

|Variant  |BG                     |Text                  |Border                  |
|---------|-----------------------|----------------------|------------------------|
|`success`|`--color-success-light`|`--color-success-text`|`--color-success-border`|
|`warning`|`--color-warning-light`|`--color-warning-text`|`--color-warning-border`|
|`danger` |`--color-danger-light` |`--color-danger-text` |`--color-danger-border` |
|`brand`  |`--color-brand-light`  |`--color-brand`       |transparent             |
|`neutral`|`--color-neutral-light`|`--text-secondary`    |`--border-default`      |
|`dark`   |`#1a2035`              |`#ffffff`             |transparent             |

Size: 10–11 px font, `font-weight: 600`, `border-radius: var(--radius-full)`, `padding: 2px 8px`. Optional `border: 1px solid` using the border token.

Usage examples: environment badge (`dev` = success, `ephemeral` = warning), goal states, “Unclassified” label.

### 6.2 Button

Variants: `primary`, `secondary`, `ghost`, `danger`.

|Variant    |BG              |Text              |Border           |Hover BG               |
|-----------|----------------|------------------|-----------------|-----------------------|
|`primary`  |`--color-brand` |white             |none             |`--color-brand-hover`  |
|`secondary`|`--bg-card`     |`--text-primary`  |`--border-strong`|`--bg-card-hover`      |
|`ghost`    |transparent     |`--text-secondary`|none             |`--color-neutral-light`|
|`danger`   |`--color-danger`|white             |none             |`--color-danger-hover` |

Sizes:

- `sm`: `padding: 5px 12px`, `font-size: 12px`, `border-radius: var(--radius-sm)`.
- `md` (default): `padding: 8px 16px`, `font-size: 14px`, `border-radius: var(--radius-sm)`.
- `lg`: `padding: 10px 20px`, `font-size: 15px`.

States: `:hover` applies hover BG + slight `transform: translateY(-1px)`. `:active` reverses the translate. `:disabled` sets `opacity: 0.45`, `cursor: not-allowed`.

Icon buttons (square, just an icon): `padding: 6px`, `border-radius: var(--radius-sm)`.

### 6.3 Card

A white rounded container with shadow.

```css
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  padding: var(--space-5);
}
```

Variants:

- `.card--flat`: no shadow, just border.
- `.card--clickable`: adds `cursor: pointer`, `:hover` sets `box-shadow: var(--shadow-lg)` and `background: var(--bg-card-hover)`.
- `.card--accent-left`: adds `border-left: 3px solid` in the accent colour (used for Glances cards). The colour is set via inline style on the element: `style={{ borderLeftColor: 'var(--color-success)' }}`.

### 6.4 Input

Applies to `input[type="text"]`, `input[type="number"]`, `input[type="password"]`, `input[type="email"]`, `select`, `textarea`.

```css
input[type="text"], input[type="number"], input[type="password"],
input[type="email"], select, textarea {
  background: var(--bg-input);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  padding: 7px 10px;
  width: 100%;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

input:focus, select:focus, textarea:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
}
```

Label style: `font-size: 13px`, `font-weight: 500`, `color: var(--text-secondary)`, `margin-bottom: 5px`, `display: block`.

### 6.5 Modal

- Overlay: `position: fixed`, `inset: 0`, `background: var(--bg-overlay)`, `z-index: var(--z-modal)`, `display: flex`, `align-items: center`, `justify-content: center`.
- Dialog: `.card` with `box-shadow: var(--shadow-modal)`, `min-width: 400px`, `max-width: 520px`, `width: 90%`, `max-height: 90vh`, `overflow-y: auto`.
- Header: flex row, title (16 px, weight 600) + close button `×` (ghost icon button, top-right).
- Footer: right-aligned row of buttons (Cancel secondary, Confirm primary), `gap: var(--space-2)`, `margin-top: var(--space-5)`, `padding-top: var(--space-4)`, `border-top: 1px solid var(--border-default)`.
- Entrance animation: `opacity 0→1` + `translateY(8px→0)`, duration `var(--transition-normal)`.

On mobile: modal takes up 95% width, anchored to screen centre.

### 6.6 Table

```css
.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.table th {
  background: var(--bg-table-header);
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: var(--space-2) var(--space-3);
  text-align: left;
  border-bottom: 1px solid var(--border-default);
}

.table td {
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-default);
  color: var(--text-primary);
  vertical-align: middle;
}

.table tr:hover td {
  background: var(--bg-table-row-hover);
}
```

Group header rows (e.g. account groups in Capital): `background: var(--bg-table-group-header)`, `font-weight: 600`, `font-size: 12px`, `color: var(--text-secondary)`. Contains a chevron (▼/▶) for collapse/expand (existing drag-and-drop functionality preserved).

### 6.7 Tabs

A horizontal strip of tab buttons below the Glances panel (or wherever tabs appear).

```
[ Capital ]  [ Expenses ]  [ Workbench ]  [ Goals ]  [ Settings ]
```

- Container: flex row, `border-bottom: 1px solid var(--border-default)`, `margin-bottom: var(--space-5)`.
- Each tab button: `padding: 10px var(--space-4)`, `font-size: 14px`, `font-weight: 500`, `color: var(--text-secondary)`, `background: none`, `border: none`, `cursor: pointer`, `border-bottom: 2px solid transparent`, `margin-bottom: -1px`.
- Active tab: `color: var(--color-brand)`, `border-bottom-color: var(--color-brand)`.
- Hover: `color: var(--text-primary)`.

### 6.8 Collapsible Section

Used in Workbench and cycle editors to show/hide section details.

- Header row: full-width, flex, space-between. Left: section title + summary values. Right: expand/collapse chevron.
- Header background: `var(--bg-table-group-header)`, `padding: var(--space-3) var(--space-4)`, `border-radius: var(--radius-md)`, `cursor: pointer`.
- On hover: `background: var(--bg-table-row-hover)`.
- Chevron rotates 180° when expanded.

### 6.9 Progress Bar

```
[████████░░░░░░░░░░░░] 42%
```

- Track: `height: 8px`, `border-radius: var(--radius-full)`, `background: var(--border-default)`.
- Fill: `background: var(--color-brand)`, `border-radius: var(--radius-full)`, `transition: width var(--transition-slow)`.
- Fill colour changes based on progress: < 25% → `--color-danger`; 25–74% → `--color-warning`; ≥ 75% → `--color-success`.
- A larger variant (`height: 12px`) is used on the Goal Detail page.

### 6.10 Stat / KPI display

A small data block showing a label + value pair, used extensively in Glances cards and cycle summaries.

```
Total capital
€ 352,00
```

- Label: 11 px, `var(--text-muted)`, uppercase, letter-spacing.
- Value: 18–20 px, weight 700, `var(--text-primary)`.
- Positive delta: `var(--color-value-positive)` with ↑ arrow.
- Negative delta: `var(--color-value-negative)` with ↓ arrow.

-----

## 7. Glances Panel

The Glances panel renders four cards in a horizontal row (vertical stack on mobile). Refer to `SPECIFICATION_GLANCES.md` for all data and state logic — this section defines only visual changes.

### 7.1 Panel container

- `display: grid`, `grid-template-columns: repeat(4, 1fr)`, `gap: var(--space-4)`.
- On mobile: `grid-template-columns: 1fr 1fr`, then each pair stacks.
- `margin-bottom: var(--space-5)`.
- Section label “Glances” above the grid: 11 px, uppercase, letter-spacing 0.1em, `var(--text-muted)`, `margin-bottom: var(--space-3)`.

### 7.2 Card base

Each Glances card uses `.card.card--clickable.card--accent-left`. The left accent colour depends on card state:

|State          |Accent colour token|
|---------------|-------------------|
|Neutral        |`--color-brand`    |
|Amber / warning|`--color-warning`  |
|Red / danger   |`--color-danger`   |
|Success        |`--color-success`  |

The card background gets a very subtle tint in non-neutral states:

- Amber: `background: var(--color-warning-light)`
- Red: `background: var(--color-danger-light)`

Card `padding: var(--space-4)`, `min-height: 90px`.

### 7.3 Card header row

```
[ Card title ]                 [ optional icon ⚠ ]
```

- Title: 11 px, uppercase, letter-spacing 0.08em, `var(--text-muted)`.
- Warning icon: ⚠ in `var(--color-warning)` or `var(--color-danger)`, 14 px, visible only in non-neutral states.

### 7.4 Capital card

```
CAPITAL
€ 352,00                        (--text-2xl, --text-primary)
↑ +2,4% vs Feb                  (--color-value-positive, 12px)
€ 12 000 in idle                (--text-muted, 11px, italic)
```

### 7.5 Current Cycle card

```
CURRENT CYCLE
Balance      –1 113,00 €        (value in --color-value-negative)
Expected     € 359,00           (--text-secondary, smaller)
```

### 7.6 Next Expense card

Normal state:

```
NEXT EXPENSE
[Expense name]                  (14px, weight 600)
€ 50,00   ·   in 3 days (day 10)   (--text-secondary, 12px)
```

Overdue (amber state):

```
NEXT EXPENSE  ⚠
[Expense name]
€ 50,00   ·   Overdue (day 5)       (--color-warning-text)
```

### 7.7 Goals card

```
GOALS
4 active                         (--text-primary, 16px, weight 600)
1 completed                      (--color-success-text, 12px)
```

Failed state:

```
GOALS
3 active
2 failed ⚠                       (--color-danger-text, 12px)
```

-----

## 8. Capital Section

### 8.1 Total Capital Evolution chart

- Wrapped in a `.card`.
- Header row: title “Total Capital Evolution” (16 px, weight 600) left-aligned, a `<select>` dropdown “Summary” right-aligned (secondary button style).
- Chart: recharts `LineChart`, `height: 220px`. Line colour `var(--color-brand)`. Grid lines `var(--border-default)`. Axis text `var(--text-muted)`, 11 px. Dot fill `var(--color-brand)`, stroke `var(--bg-card)`.
- Tooltip: white card with shadow, `border-radius: var(--radius-sm)`, `border: 1px solid var(--border-default)`.

### 8.2 Accounts table

- Section title “Accounts” (16 px, weight 600) above the `.card` wrapping the table.
- Uses the `.table` styles.
- Columns: Account name | Value € (right-aligned, `font-variant-numeric: tabular-nums`) | Idle Money (centred, checkmark icon `✓` in `--color-success` or dash) | Actions (right-aligned icon buttons).
- Group header row: bold group name + account count + chevron. Clicking collapses/expands the group (existing functionality).
- Action icons: `⚙` (settings/edit) and `⋮` (more menu) — icon buttons, ghost variant, 28 px × 28 px.
- “Add account” button: primary, small, top-right of section header row.

-----

## 9. Monthly Expenses Section

### 9.1 Cycle list

- Each cycle is a `.card.card--clickable`.
- Shows: cycle **display name** (end month, e.g. “April 2025”), open/closed badge.
- Closed badge: `badge-filled`. Open badge: `badge-empty`.
- Placeholder rows above (next cycle) and below (previous cycle) use the same end-month naming.
- The **Open Cycle modal** selector shows end-month labels (e.g. “April 2025”) while storing the start month internally. The date range hint below the selector shows the full span.
- “Open new cycle” button: primary, top of the list.

### 9.2 Cycle Editor (CycleEditor)

- Page header: cycle **display name** (end month, e.g. "April 2025 Cycle") + date range subtitle + four header action buttons (flex row, wraps on mobile): **Period** (pencil icon, opens `EditPeriodModal`), **Income** (pencil icon, opens the salary/previous-balance edit form inline in the info card), **Close cycle** / **Reopen** (lock icon; shows "Close cycle" when open — clicking reveals the final-balance form inline in the card; shows "Reopen" when closed), **Delete** (danger, opens `ConfirmModal`, then navigates back).
- The **EditPeriodModal** shows a Cycle selector (dropdown of end-month labels derived from `new Date(year, m, startDay - 1)`) and a Start year selector. The date range hint updates live. Submitting sends `PATCH /cycles/:id { year, month }`. A 409 conflict is shown inline.
- **Summary card** (`.card`) directly below the header info card:
  - Section title "Summary" at top.
  - **Expenses** subsection: uppercase label above a `repeat(3, 1fr)` grid → Total | Paid | Unpaid.
  - **Distributions** subsection: uppercase label above a `repeat(3, 1fr)` grid → Total | Done | Pending.
  - **Closing** subsection (only when closed): divider + uppercase label + `repeat(3, 1fr)` grid → Final real balance | Difference.
  - Each data point: small muted label above, value in `fontWeight: 500` (600 for Closing).
- Below: **Expenses** section and **Distributions** section, each in a `.card`.
- Expenses use the `.table`. Fixed expense rows: name | value | day | paid checkbox | actions. Budget expense rows: name | max | spent (inline editable number) | progress bar | actions.
- The paid checkbox and done checkbox: use `<Checkbox>` component (see Section 9.4).
- Distributions table: name | value | done checkbox | actions.

### 9.3 Expense Template

- Accessible from Dossier Settings tab.
- Two tabs: “Expenses” | “Distributions” using the `.tabs` component (Section 6.7).
- Table layout identical to CycleEditor but with edit-in-place capability.
- Classification (Must/Want) column: small badge — `success` for Must, `brand` for Want, `neutral` for unclassified.

### 9.4 Checkboxes

All checkboxes use the `<Checkbox>` React component (`frontend/src/components/ui/Checkbox.jsx`). Native `<input type="checkbox">` is **never used** — it breaks dark mode on iOS/Chrome and produces tiny tap targets.

The component renders a `<span>` with `role="checkbox"`, `tabIndex={0}`, and keyboard handling (Space/Enter toggles). It uses the `.checkbox-custom` CSS class.

```css
.checkbox-custom {
  width: 20px; height: 20px; min-width: 20px;
  border: 2px solid var(--border-strong);
  border-radius: var(--radius-xs);
  background: var(--bg-input);
  cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background var(--transition-fast), border-color var(--transition-fast),
              box-shadow var(--transition-fast);
  flex-shrink: 0;
  user-select: none;
  font-size: 13px; font-weight: 700; color: transparent;
}
.checkbox-custom:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--color-brand-light), 0 0 0 5px var(--color-brand);
}
.checkbox-custom:hover:not(.checked) { border-color: var(--color-brand); }
.checkbox-custom.checked {
  background: var(--color-success);
  border-color: var(--color-success);
  color: #fff;
}
```

Usage: `<Checkbox checked={value} onChange={handler} title="..." />`

Files using `<Checkbox>`: `CycleEditor` (paid/done toggles), `AccountManager` (idle money), `EmergencyFundTab` (account picker), `GoalFormModal` (distribution and account multi-select).

-----

## 10. Workbench Section

### 10.1 Snapshot bar

- A horizontal bar above the main content: left side shows the snapshot name (or “Unsaved working state” in italic `--text-muted`); right side has buttons: “Save”, “Duplicate”, “Delete” (icon buttons or labeled).
- If no snapshot is loaded: “New from scratch” button replaces the name.

### 10.2 Section cards

Each section (Income, Monthly Expenses, Annual Expenses, Distributions, Summary) is a `.card` with a collapsible header (Section 6.8).

Collapsed header shows the section name + key summary values (total, Must, Want) as small stat pills.

### 10.3 Unclassified highlight

Entries without a Must/Want classification get a left border in `var(--color-warning)` and a `warning` badge “Unclassified”.

### 10.4 Global Summary

- Displayed as the last card (not collapsible, always visible).
- Shows 4 stat blocks: Total Income | Total Must | Total Want | Total Save.
- Below: three **donut chart segments** (one per Must/Want/Save) showing percentage of income. Use recharts `PieChart` with `innerRadius`. Colours: Must = `--color-danger`, Want = `--color-warning`, Save = `--color-success`. Label inside each donut: percentage value.
- Below donut charts: “Leftover” value in large text, coloured: positive = `--color-value-positive`, negative = `--color-value-negative`.

-----

## 11. Goals Section

### 11.1 Goal list

- Section header: “Goals” + “New goal” button (primary, right-aligned).
- Each goal: `.card.card--clickable`.
- Shows: goal name (weight 600) | state badge | target date | progress bar + percentage | “Infeasible” warning badge if applicable.
- State badge variants: Active = `brand`, Completed = `success`, Failed = `danger`.
- Infeasible warning: `warning` badge + ⚠ icon, visible in both list and detail views.
- Failed and completed goals are visually dimmed (`opacity: 0.8`) relative to active goals.

### 11.2 Goal Detail

- Page header: goal name + edit/delete icon buttons + state badge.
- **Key values block** (`.card`): a grid of stat blocks (Target value | Current progress | Remaining amount | Monthly value needed | Expected monthly contribution | Target date). 2-column grid on desktop, 1-column on mobile.
- **Progress bar** (large variant, `height: 12px`) below the key values, with percentage label.
- **Infeasibility warning**: a prominent alert box using `--color-warning-light` background, `--color-warning-border` border, `--color-warning-text` text, with a ⚠ icon. Positioned immediately below the progress bar when applicable.
- **Month-by-month chart** (`.card`): recharts `LineChart`, two lines — Expected (dashed, `--color-neutral`) and Real (solid, `--color-brand`). Historical contribution points marked differently (e.g. open circle dot).
- **Cycle contributions list** (Manual mode): `.table` with cycle name | expected | real (editable inline input) | difference.
- **Historical contributions** (Manual / Via Distributions): collapsible section with a small table (year/month/amount) and a “Save” button.

-----

## 12. Settings Section

### 12.1 Layout

- Settings cards grouped by topic: “Cycle Settings” | “Glances Thresholds” | “Dossier”.
- Each group: `.card` with a group title (16 px, weight 600, `border-bottom: 1px solid var(--border-default)`, `padding-bottom: var(--space-3)`, `margin-bottom: var(--space-4)`).

### 12.2 Field layout

Each setting field: label on the left (60% width), control on the right (40% width). On mobile: label above, control full width.

-----

## 13. Users Page

- Simple `.card` with a `.table` listing users: username | type (Local / SSO) | created date | actions (delete button, danger ghost variant).
- “Add user” button: primary, top-right.
- Delete confirmation uses the modal (Section 6.5) with danger confirm button.

-----

## 14. Responsive Breakpoints

|Breakpoint|Value      |Notes                                            |
|----------|-----------|-------------------------------------------------|
|Mobile    |< 768 px   |Bottom nav, full-width cards, single-column grids|
|Tablet    |768–1024 px|Sidebar hidden, 2-column Glances grid            |
|Desktop   |≥ 1024 px  |Sidebar visible, 4-column Glances grid           |

All breakpoints implemented via `@media` queries in `index.css`.

#### `.page-header` on mobile

`.page-header` stays as a **flex row** on all screen sizes — the Back link and page title remain on the same line. `flex-wrap: wrap` allows action buttons to flow to a second line if the row is too narrow. The `flex-direction: column` override that was previously applied on mobile has been removed.

#### `.cycle-derived-values` responsive class

The **Total available** and **Leftovers expected** values in the CycleEditor info card are wrapped in a single `div.cycle-derived-values` so they always travel together as a unit when the outer flex row wraps. Responsive rules:

- **Desktop (≥ 768 px)**: `border-left: 1px solid var(--color-border); padding-left: 2rem` — visual separator between input fields (salary/balance) and computed values.
- **Mobile (< 768 px)**: no border or padding — the pair wraps flush to the left edge, aligned with the fields above.

-----

## 15. Micro-interactions & Polish

- All interactive elements have `transition` on hover/focus states.
- Cards that are clickable use `cursor: pointer` and a subtle lift shadow on hover.
- Modal entrance: fade + slide up (see Section 6.5).
- Sidebar collapse: smooth width transition.
- Number values in tables use `font-variant-numeric: tabular-nums` to prevent layout shifts.
- Negative values in financial displays are always coloured `var(--color-value-negative)` (red). Positive values use `var(--color-value-positive)` (green).
- Zero or neutral values use `var(--color-value-neutral)` (default text colour).

### 15.1 Page entrance animations

- `.page-fade-in` — applied to the outermost wrapper of full pages (LoginPage, DossierList, DossierView, CycleEditor). Triggers `@keyframes fadeIn` (opacity 0→1), duration `var(--transition-slow)` (300ms), `animation-fill-mode: both`.
- `.tab-content` — wraps tab body in DossierView; `key={activeTab}` forces React to remount on tab switch, re-triggering the entrance animation. Uses `fadeIn` at 200ms. **Must NOT use `slideUp` (translateY)** — a persisted CSS transform makes the element a containing block for `position: fixed` descendants, which breaks modal overlay stacking.
- `.glance-card` — Glances cards use `slideUp` (`@keyframes slideUp`: opacity + translateY) with `nth-child` stagger delays: child 1 = 0ms, child 2 = 50ms, child 3 = 100ms, child 4 = 150ms, child 5 = 200ms.
- Body scroll lock: `body:has(.modal-overlay) { overflow: hidden }` — applied automatically whenever any modal with `.modal-overlay` is mounted. No JS required.

### 15.2 Confirmation dialogs

All destructive or irreversible actions use `<ConfirmModal>` (`frontend/src/components/ConfirmModal.jsx`) instead of `window.confirm()`. The modal is animated (entrance via `.modal` CSS), shows a title, message, and Cancel / Confirm buttons. The Confirm button is styled as `btn-danger` for destructive actions and `btn-primary` otherwise. Clicking the overlay cancels. The `confirmState` pattern (see CLAUDE.md Component Patterns) is used in every component that needs confirmation.

-----

## 16. Out of Scope (this phase)

- Replacing the recharts library with a different charting library
- Animations beyond CSS transitions (no Framer Motion)
- Drag-and-drop visual redesign (existing HTML5 drag-and-drop preserved as-is)
- Print/export styling
- Custom icon library (use Unicode characters or minimal inline SVGs; do not install lucide-react or similar)
- Toast/notification system (existing alert/confirm behaviour preserved)