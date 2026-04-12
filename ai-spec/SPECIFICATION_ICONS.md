# Capital Tracker — Icon System Specification

## 0. Instructions for Claude Code

- This specification is an **extension** to `SPECIFICATION_UI.md` and all other existing specifications.
- This document replaces all icon references in existing specs (emoji, Lucide, Unicode) with **Font Awesome 6 Free** icons.
- **No emoji characters may be used anywhere in the UI** — not in navigation, glances, buttons, badges, labels, or any other element.
- All icons must come from Font Awesome 6 Free (solid or regular weight).
- Before generating any files, **propose the list of files to be created or modified** and wait for approval.

-----

## 1. Font Awesome Integration

### 1.1 Installation

Install the Font Awesome React packages:

```bash
cd frontend
npm install @fortawesome/fontawesome-svg-core @fortawesome/free-solid-svg-icons @fortawesome/free-regular-svg-icons @fortawesome/react-fontawesome
```

### 1.2 Library Setup

Create `frontend/src/icons.js`:

```js
import { library } from '@fortawesome/fontawesome-svg-core';
import {
  faHouse,
  faGem,
  faReceipt,
  faCalendarDays,
  faScrewdriverWrench,
  faBullseye,
  faShieldHalved,
  faGear,
  faUsers,
  faChevronDown,
  faChevronRight,
  faChevronLeft,
  faPlus,
  faPen,
  faTrash,
  faXmark,
  faCheck,
  faArrowUp,
  faArrowDown,
  faCircleExclamation,
  faTriangleExclamation,
  faClock,
  faLock,
  faLockOpen,
  faArrowRotateLeft,
  faBars,
  faSun,
  faMoon,
  faCircleHalfStroke,
  faRightFromBracket,
  faKey,
  faEllipsisVertical,
  faFolder,
  faChartLine,
  faMoneyBillWave,
  faWallet,
  faPiggyBank,
  faCreditCard,
  faCoins,
  faSackDollar,
  faHandHoldingDollar,
  faCircleInfo,
  faCircleCheck,
  faCircleXmark,
  faChartPie,
  faThumbTack,
  faSparkles,
  faFileInvoiceDollar,
  faArrowsRotate,
  faFloppyDisk,
  faDownload,
  faUpload,
  faFilter,
  faSort,
  faGripVertical,
  faEye,
  faEyeSlash,
  faCaretDown,
  faCaretUp,
} from '@fortawesome/free-solid-svg-icons';

import {
  faCircle as farCircle,
  faSquare as farSquare,
  faSquareCheck as farSquareCheck,
  faCalendar as farCalendar,
  faClock as farClock,
  faStar as farStar,
} from '@fortawesome/free-regular-svg-icons';

library.add(
  faHouse, faGem, faReceipt, faCalendarDays, faScrewdriverWrench,
  faBullseye, faShieldHalved, faGear, faUsers, faChevronDown,
  faChevronRight, faChevronLeft, faPlus, faPen, faTrash, faXmark,
  faCheck, faArrowUp, faArrowDown, faCircleExclamation,
  faTriangleExclamation, faClock, faLock, faLockOpen,
  faArrowRotateLeft, faBars, faSun, faMoon, faCircleHalfStroke,
  faRightFromBracket, faKey, faEllipsisVertical, faFolder,
  faChartLine, faMoneyBillWave, faWallet, faPiggyBank,
  faCreditCard, faCoins, faSackDollar, faHandHoldingDollar,
  faCircleInfo, faCircleCheck, faCircleXmark, faChartPie,
  faThumbTack, faSparkles, faFileInvoiceDollar, faArrowsRotate,
  faFloppyDisk, faDownload, faUpload, faFilter, faSort,
  faGripVertical, faEye, faEyeSlash, faCaretDown, faCaretUp,
  farCircle, farSquare, farSquareCheck, farCalendar, farClock, farStar
);
```

Import this file once in `frontend/src/main.jsx` (or `index.jsx`):

```js
import './icons';
```

### 1.3 Usage Pattern

All components use the `<FontAwesomeIcon>` component:

```jsx
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';

// Solid (default)
<FontAwesomeIcon icon="shield-halved" />

// Regular weight
<FontAwesomeIcon icon={['far', 'calendar']} />

// With sizing and colour
<FontAwesomeIcon icon="check" style={{ fontSize: 12, color: 'var(--color-success)' }} />

// Fixed width (for alignment in lists/nav)
<FontAwesomeIcon icon="house" fixedWidth />
```

### 1.4 Global CSS Override

Add to `index.css` to prevent Font Awesome SVGs from flashing at large size before CSS loads:

```css
.svg-inline--fa {
  vertical-align: -0.125em;
}
```

-----

## 2. Icon Map — Complete Reference

### 2.1 Sidebar Navigation

| Route / Section         | Icon (solid)              | FA name               |
|-------------------------|---------------------------|------------------------|
| Dashboard / Home        | house                     | `fa-house`             |
| Capital                 | gem                       | `fa-gem`               |
| Monthly Expenses        | receipt                   | `fa-receipt`           |
| Annual Expenses         | calendar-days             | `fa-calendar-days`     |
| Workbench               | screwdriver-wrench        | `fa-screwdriver-wrench`|
| Goals                   | bullseye                  | `fa-bullseye`          |
| Emergency Fund          | shield-halved             | `fa-shield-halved`     |
| Settings                | gear                      | `fa-gear`              |
| Users                   | users                     | `fa-users`             |

### 2.2 Bottom Navigation Bar (Mobile)

| Tab              | Icon (solid)       | FA name          |
|------------------|--------------------|------------------|
| Capital          | gem                | `fa-gem`         |
| Expenses         | receipt            | `fa-receipt`     |
| Workbench        | screwdriver-wrench | `fa-screwdriver-wrench` |
| Goals            | bullseye           | `fa-bullseye`    |

### 2.3 Glances Panel Cards

| Card              | Icon (solid)          | FA name                  |
|-------------------|-----------------------|--------------------------|
| Emergency Fund    | shield-halved         | `fa-shield-halved`       |
| Capital           | chart-line            | `fa-chart-line`          |
| Current Cycle     | wallet                | `fa-wallet`              |
| Next Expense      | clock                 | `fa-clock`               |
| Goals             | bullseye              | `fa-bullseye`            |

### 2.4 Warning / State Icons

| State / Context           | Icon (solid)              | FA name                    |
|---------------------------|---------------------------|----------------------------|
| Warning (amber)           | triangle-exclamation      | `fa-triangle-exclamation`  |
| Error / Danger            | circle-exclamation        | `fa-circle-exclamation`    |
| Success / Done            | circle-check              | `fa-circle-check`          |
| Failed                    | circle-xmark              | `fa-circle-xmark`          |
| Info                      | circle-info               | `fa-circle-info`           |

### 2.5 Action Buttons

| Action             | Icon (solid)         | FA name                |
|--------------------|----------------------|------------------------|
| Add / Create       | plus                 | `fa-plus`              |
| Edit               | pen                  | `fa-pen`               |
| Delete             | trash                | `fa-trash`             |
| Close / Dismiss    | xmark                | `fa-xmark`             |
| Confirm / Save     | check                | `fa-check`             |
| Save to disk       | floppy-disk          | `fa-floppy-disk`       |
| Refresh / Sync     | arrows-rotate        | `fa-arrows-rotate`     |
| Undo / Reopen      | arrow-rotate-left    | `fa-arrow-rotate-left` |
| Hamburger menu     | bars                 | `fa-bars`              |
| Context menu       | ellipsis-vertical    | `fa-ellipsis-vertical` |
| Drag handle        | grip-vertical        | `fa-grip-vertical`     |
| Filter             | filter               | `fa-filter`            |
| Sort               | sort                 | `fa-sort`              |
| Download           | download             | `fa-download`          |
| Upload             | upload               | `fa-upload`            |
| Show password      | eye                  | `fa-eye`               |
| Hide password      | eye-slash            | `fa-eye-slash`         |

### 2.6 Navigation / Collapse

| Context              | Icon (solid)       | FA name             |
|----------------------|--------------------|----------------------|
| Expand / Collapse    | chevron-down       | `fa-chevron-down`    |
| Navigate forward     | chevron-right      | `fa-chevron-right`   |
| Navigate back        | chevron-left       | `fa-chevron-left`    |
| Caret up (sort)      | caret-up           | `fa-caret-up`        |
| Caret down (sort)    | caret-down         | `fa-caret-down`      |

### 2.7 Theme Toggle

| Mode     | Icon (solid)          | FA name                |
|----------|-----------------------|------------------------|
| System   | circle-half-stroke    | `fa-circle-half-stroke`|
| Light    | sun                   | `fa-sun`               |
| Dark     | moon                  | `fa-moon`              |

### 2.8 User / Auth

| Context            | Icon (solid)         | FA name                 |
|--------------------|----------------------|-------------------------|
| Logout             | right-from-bracket   | `fa-right-from-bracket` |
| Change password    | key                  | `fa-key`                |
| User avatar (fallback) | —              | Use initials, not icon  |

### 2.9 Financial / Domain

| Context                   | Icon (solid)           | FA name                   |
|---------------------------|------------------------|---------------------------|
| Capital / Total           | chart-line             | `fa-chart-line`           |
| Salary / Income           | money-bill-wave        | `fa-money-bill-wave`      |
| Balance / Wallet          | wallet                 | `fa-wallet`               |
| Savings / Piggy bank      | piggy-bank             | `fa-piggy-bank`           |
| Account / Card            | credit-card            | `fa-credit-card`          |
| Coins / Spare             | coins                  | `fa-coins`                |
| Distribution              | hand-holding-dollar    | `fa-hand-holding-dollar`  |
| Target / Goal amount      | sack-dollar            | `fa-sack-dollar`          |
| Budget chart / Pie        | chart-pie              | `fa-chart-pie`            |
| Invoice / Annual expense  | file-invoice-dollar    | `fa-file-invoice-dollar`  |
| Dossier / Folder          | folder                 | `fa-folder`               |

### 2.10 Expense Classification

| Classification   | Icon (solid)    | FA name          | Colour token         |
|------------------|-----------------|------------------|----------------------|
| Must (essential) | thumbtack       | `fa-thumbtack`   | `--color-danger`     |
| Want (optional)  | sparkles        | `fa-sparkles`    | `--color-warning`    |

### 2.11 Cycle State

| State     | Icon (solid)    | FA name           |
|-----------|-----------------|--------------------|
| Open      | lock-open       | `fa-lock-open`     |
| Closed    | lock            | `fa-lock`          |

-----

## 3. Icon Sizing Standards

| Context                | Size  | CSS `font-size`  |
|------------------------|-------|------------------|
| Sidebar nav item       | 16 px | `16px`           |
| Bottom nav (mobile)    | 20 px | `20px`           |
| Glance card header     | 14 px | `14px`           |
| Table row icon         | 13 px | `13px`           |
| Button icon (inline)   | 13 px | `13px`           |
| Action icon button     | 14 px | `14px`           |
| Badge / small          | 10 px | `10px`           |
| Warning / alert icon   | 16 px | `16px`           |
| Hero / large display   | 24 px | `24px`           |

-----

## 4. Migration Checklist

When implementing this specification, update the following existing components to replace emoji/Unicode/Lucide with Font Awesome:

1. `Sidebar.jsx` — all nav item icons
2. `Navbar.jsx` — hamburger, theme toggle, user menu icons
3. `AppShell.jsx` — bottom navigation bar icons (mobile)
4. `GlancesPanel.jsx` and all Glance card components — card header icons, warning icons
5. `DossierView.jsx` — tab bar icons (if any)
6. `CycleEditor.jsx` — paid/done status icons, section icons, action buttons
7. `GoalDetail.jsx` — state badges, action buttons
8. `EmergencyFundTab.jsx` — status icons
9. `ConfirmModal.jsx` — close button icon
10. `DossierSettingsTab.jsx` — section header icons
11. All components using `ConfirmModal` — ensure danger/primary icons are FA
12. Any component rendering classification badges (must/want) — replace emoji with FA icons

-----

## 5. Out of Scope

- Custom SVG icons (all icons come from Font Awesome Free)
- Font Awesome Pro features (duotone, thin, sharp)
- Animated icons (use CSS transitions on the wrapper instead)
