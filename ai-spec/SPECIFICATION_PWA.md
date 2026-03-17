# Capital Tracker — PWA & Push Notifications Specification

## 0. Status

**Fully implemented.** This specification has been executed and all features described below are live in the codebase. Refer to `CLAUDE.md` for the up-to-date architecture overview, schema summary, and API route listing.

-----

## 1. Overview

### 1.1 PWA (Installability)

The application becomes installable on mobile and desktop devices — appearing on the home screen, launching without the browser chrome, and caching the application shell for fast startup. **There is no offline data support** — the app requires the backend to function.

### 1.2 Push Notifications

Users receive Web Push notifications for financial events: upcoming expenses, overdue payments, unclosed cycles, unopened cycles, and missing capital snapshots. Notifications are opt-in per dossier, configurable per user, and delivered via the Web Push API with VAPID authentication.

-----

## 2. PWA — Installability

### 2.1 Web App Manifest

Create `frontend/public/manifest.webmanifest`:

```json
{
  "name": "Capital Tracker",
  "short_name": "Capital",
  "description": "Personal finance tracking",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f0f4f8",
  "theme_color": "#1a2035",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512-maskable.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

The `background_color` matches `--bg-app` (light theme). The `theme_color` matches `--sidebar-bg`.

### 2.2 Icon Generation

Icons are generated at build time from `frontend/public/icon.svg` using `vite-plugin-pwa` (which uses `sharp` internally) or a dedicated build script. The following sizes must be produced and placed in `frontend/public/icons/`:

| File | Size | Usage |
|------|------|-------|
| `icon-16.png` | 16×16 | Favicon (small) |
| `icon-32.png` | 32×32 | Favicon |
| `icon-180.png` | 180×180 | Apple touch icon |
| `icon-192.png` | 192×192 | Android home screen, manifest |
| `icon-512.png` | 512×512 | Android splash screen, manifest |
| `icon-512-maskable.png` | 512×512 | Maskable icon (with safe-zone padding) |

The maskable variant must have the icon content centred within the inner 80% of the canvas, with the background colour filling the full 512×512 area.

### 2.3 HTML Meta Tags

Add to `frontend/index.html` inside `<head>`:

```html
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#1a2035">
```

### 2.4 Service Worker

Use `vite-plugin-pwa` to generate the service worker during the Vite build. The service worker must:

1. **Pre-cache the application shell** — HTML, CSS, JS bundles, fonts, and icons. Strategy: cache-first for static assets.
2. **Register for push events** — handle incoming push messages and display notifications (see Section 5).
3. **Handle notification clicks** — open or focus the app window and navigate to the relevant page.
4. **Not cache API responses** — all `/api/*` requests go to the network. If the network is unavailable on startup, the app shows a dedicated server-error screen (see Section 2.6).

#### Vite plugin configuration

In `vite.config.js`:

```js
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    // ... existing plugins
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      },
      manifest: false // we provide our own manifest.webmanifest
    })
  ]
});
```

### 2.5 New Dependencies

| Package | Purpose | Dev/Prod |
|---------|---------|----------|
| `vite-plugin-pwa` | Service worker generation + PWA build tooling | devDependency (frontend) |

### 2.6 Server-Unreachable Error Screen

When the app is opened as a PWA and the initial server check (`getSetupStatus`) fails with a network error (`TypeError` — server completely unreachable), the app must display a centered error card instead of silently redirecting to the login page.

**Behaviour:**
- `App.jsx` holds a `serverError` boolean state alongside `authState`.
- The `init()` function is extracted from `useEffect` so it can be called directly as a retry handler.
- On `TypeError` (network-level failure), `serverError` is set to `true` and loading is set to `false`.
- Other errors (e.g. 4xx/5xx HTTP responses) fall through to the existing login-redirect behaviour.

**Error screen UI** (rendered before `ThemeProvider` wraps the normal app, but wrapped in its own `ThemeProvider`):
- Full-viewport centered container (`.server-error-screen`).
- Card (`.server-error-card`) containing:
  - Warning icon (`.server-error-icon`): `⚠` in amber.
  - Title (`.server-error-title`): "Server unavailable"
  - Message (`.server-error-message`): "Could not connect to the server. Check your connection and try again."
  - Retry button (`.server-error-retry`): calls `init()`, resetting both `serverError` and `authState.loading` before re-running the full init sequence.

**CSS classes:** `.server-error-screen`, `.server-error-card`, `.server-error-icon`, `.server-error-title`, `.server-error-message`, `.server-error-retry`.

-----

## 3. Push Notifications — VAPID Keys

### 3.1 Generation

VAPID keys are auto-generated on first application startup and stored in the SQLite database. The backend checks for existing keys before generating new ones.

At startup (in `backend/src/index.js`, after migrations and before starting the HTTP server):

```
if no VAPID keys exist in the database:
  generate a new VAPID key pair using web-push library
  store both keys in the app_settings table
```

### 3.2 Storage

A new `app_settings` table stores application-wide key-value configuration:

| Column | Type | Description |
|--------|------|-------------|
| `key` | TEXT PRIMARY KEY | Setting name |
| `value` | TEXT NOT NULL | Setting value |

Initial entries (created on first startup):

| Key | Value |
|-----|-------|
| `vapid_public_key` | Base64url-encoded public key |
| `vapid_private_key` | Base64url-encoded private key |

### 3.3 Public Key Endpoint

```
GET /api/push/vapid-public-key
```

Returns: `{ "publicKey": "<base64url-encoded public key>" }`

This endpoint is **authenticated** (requires a valid session). The frontend needs the public key to create push subscriptions.

-----

## 4. Push Notifications — Subscription Management

### 4.1 Push Subscription Storage

A new `push_subscriptions` table stores browser push subscriptions:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `user_id` | INTEGER NOT NULL | FK to `users` |
| `endpoint` | TEXT NOT NULL UNIQUE | Push service endpoint URL |
| `keys_p256dh` | TEXT NOT NULL | Client public key |
| `keys_auth` | TEXT NOT NULL | Client auth secret |
| `created_at` | TEXT NOT NULL | ISO 8601 timestamp |

A user can have **multiple subscriptions** (one per browser/device). The `endpoint` column has a UNIQUE constraint to prevent duplicate registrations from the same browser.

### 4.2 API Endpoints

```
POST   /api/push/subscribe       { endpoint, keys: { p256dh, auth } }
DELETE /api/push/subscribe       { endpoint }
GET    /api/push/subscriptions
```

- **POST subscribe**: creates a new subscription for the authenticated user. If the endpoint already exists (from the same or different user), it updates the existing record to point to the current user.
- **DELETE subscribe**: removes the subscription matching the given endpoint for the authenticated user.
- **GET subscriptions**: returns all active subscriptions for the authenticated user (for the settings UI to show registered devices).

### 4.3 Cascade on User Deletion

When a user is deleted, all their push subscriptions are deleted (CASCADE).

-----

## 5. Push Notifications — User Preferences

### 5.1 User Notification Settings

A new `user_notification_settings` table stores per-user notification preferences:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `user_id` | INTEGER PRIMARY KEY | — | FK to `users` |
| `enabled` | INTEGER NOT NULL | 1 | Master on/off toggle (1 = enabled) |
| `send_hour` | INTEGER NOT NULL | 9 | Hour of day to send notifications (0–23) |
| `send_minute` | INTEGER NOT NULL | 0 | Minute of hour (0–59) |
| `repeat_enabled` | INTEGER NOT NULL | 0 | Whether to repeat notifications (1 = repeat) |
| `repeat_interval_days` | INTEGER NOT NULL | 1 | Days between repeated notifications (1–7) |

### 5.2 Dossier Notification Opt-in

A new `dossier_notification_subscriptions` table stores which dossiers generate notifications for each user:

| Column | Type | Description |
|--------|------|-------------|
| `user_id` | INTEGER NOT NULL | FK to `users` |
| `dossier_id` | INTEGER NOT NULL | FK to `dossiers` |
| PRIMARY KEY | `(user_id, dossier_id)` | Composite key |

Only dossiers present in this table generate notifications for the given user. By default, no dossiers are opted in — the user must explicitly enable them.

### 5.3 API Endpoints

```
GET    /api/notifications/settings
PATCH  /api/notifications/settings    { enabled?, send_hour?, send_minute?, repeat_enabled?, repeat_interval_days? }
GET    /api/notifications/dossiers
PUT    /api/notifications/dossiers    { dossier_ids: [] }
```

- **GET settings**: returns the authenticated user's notification preferences. If no record exists, returns defaults.
- **PATCH settings**: creates or updates the user's notification preferences. The record is created on first PATCH (upsert).
- **GET dossiers**: returns the list of dossier IDs the user has opted into.
- **PUT dossiers**: replaces the entire set of opted-in dossiers atomically.

-----

## 6. Push Notifications — Dossier Settings

### 6.1 Expense Advance Warning

A new column is added to the `dossiers` table:

| Column | Type | Default | Constraint | Description |
|--------|------|---------|------------|-------------|
| `expense_notification_days_before` | INTEGER | 1 | 0–7 | Days before payment day to notify about upcoming expenses |

This setting is configured in the Dossier Settings tab, alongside the existing Glances warning thresholds.

### 6.2 UI Label

| Field | UI Label |
|-------|----------|
| `expense_notification_days_before` | Notify about upcoming expenses ___ days before payment |

### 6.3 API

The existing `GET /api/dossiers/:id/settings` and `PATCH /api/dossiers/:id/settings` endpoints are extended to include this field.

-----

## 7. Push Notifications — Notification Events

### 7.1 Event Types

Five notification types are supported:

| Event ID | Trigger | Title | Body example |
|----------|---------|-------|-------------|
| `expense_upcoming` | A fixed expense's payment day is within `expense_notification_days_before` days, and the expense is unpaid | "Upcoming expense" | "[Dossier] — [Expense name]: €50.00 due in 2 days" |
| `expense_overdue` | A fixed expense's payment day has passed in the current cycle and the expense is still unpaid | "Overdue expense" | "[Dossier] — [Expense name]: €50.00 was due on Mar 5" |
| `cycle_not_closed` | Today's day-of-month ≥ `previous_cycle_close_warning_day` and the previous cycle is not closed | "Cycle not closed" | "[Dossier] — The [Month] cycle has not been closed yet" |
| `cycle_not_opened` | Today's day-of-month ≥ `next_cycle_warning_day` and the next cycle has not been opened | "Cycle not opened" | "[Dossier] — The [Month] cycle has not been opened yet" |
| `snapshot_missing` | Today's day-of-month ≥ `capital_snapshot_warning_day` and no filled snapshot exists for the current month | "Snapshot missing" | "[Dossier] — [Month] capital snapshot not yet recorded" |

The warning thresholds for `cycle_not_closed`, `cycle_not_opened`, and `snapshot_missing` are the **same values** already used by Glances (`previous_cycle_close_warning_day`, `next_cycle_warning_day`, `capital_snapshot_warning_day`). No new thresholds are introduced for these.

### 7.2 Determining the "Current Cycle"

The current cycle for notification purposes uses the same logic as Glances (Section 4.1 of `SPECIFICATION_GLANCES.md`): the cycle whose date range covers today, computed using the dossier's `cycle_start_day`.

### 7.3 Expense Detection

For `expense_upcoming` and `expense_overdue`, the system checks:

1. **Monthly fixed expenses** — unpaid items in the current cycle with a `day_of_payment`.
2. **Annual expense installment payments** — unpaid payment records in the current cycle.

Both types use the same cycle day ordering logic as the Next Expense Glance card (see `SPECIFICATION_GLANCES.md`, Section 5.1 and `SPECIFICATION_ANNUAL_EXPENSES_TRACKING.md`, Section 9.1).

An expense is considered "upcoming" when its payment date falls within the next `expense_notification_days_before` days (inclusive of today). An expense is "overdue" when its payment date has already passed in the current cycle and it remains unpaid.

### 7.4 Notification Payload

Each push message payload is a JSON object:

```json
{
  "type": "expense_upcoming",
  "title": "Upcoming expense",
  "body": "My Finances — Internet: €35.00 due in 2 days",
  "dossierId": 1,
  "url": "/dossiers/1"
}
```

The `url` field tells the service worker where to navigate when the notification is clicked.

-----

## 8. Push Notifications — Notification Log

### 8.1 Purpose

The notification log prevents duplicate notifications and controls repetition behaviour. Before sending any notification, the scheduler checks whether a matching entry already exists in the log.

### 8.2 Storage

A new `notification_log` table:

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `user_id` | INTEGER NOT NULL | FK to `users` |
| `dossier_id` | INTEGER NOT NULL | FK to `dossiers` |
| `event_type` | TEXT NOT NULL | One of the five event IDs |
| `event_key` | TEXT NOT NULL | Unique identifier for the specific event instance (see below) |
| `sent_at` | TEXT NOT NULL | ISO 8601 timestamp of when the notification was sent |

### 8.3 Event Keys

The `event_key` uniquely identifies a specific event instance so the system can track what has already been notified:

| Event type | Event key format | Example |
|------------|-----------------|---------|
| `expense_upcoming` | `cycle:{cycleId}:item:{itemId}` | `cycle:12:item:45` |
| `expense_overdue` | `cycle:{cycleId}:item:{itemId}` | `cycle:12:item:45` |
| `cycle_not_closed` | `cycle:{year}-{month}:close` | `cycle:2026-03:close` |
| `cycle_not_opened` | `cycle:{year}-{month}:open` | `cycle:2026-04:open` |
| `snapshot_missing` | `snapshot:{year}-{month}` | `snapshot:2026-03` |

For annual expense payments, the event key uses `payment:{paymentId}` instead of `item:{itemId}`.

### 8.4 Deduplication Logic

Before sending a notification:

1. Query the log for the same `(user_id, dossier_id, event_type, event_key)`.
2. If **no entry** exists → send and log.
3. If an entry exists:
   - If the user has **repeat disabled** → skip (already sent once).
   - If the user has **repeat enabled** → check if `sent_at` is older than `repeat_interval_days` days ago. If yes → send and log a new entry. If no → skip.

### 8.5 Log Cleanup

Log entries older than **90 days** are deleted automatically during each scheduler run to prevent unbounded growth.

-----

## 9. Push Notifications — Scheduler

### 9.1 Implementation

The scheduler runs inside the Express process using `node-cron`. It executes once per minute.

### 9.2 Scheduler Logic (per minute)

```
for each user with notifications enabled:
  if current time does not match user's send_hour:send_minute → skip
  for each dossier the user has opted into:
    evaluate all 5 notification conditions
    for each triggered condition:
      check deduplication log
      if should send:
        send push to all user's subscriptions
        write to notification log
```

The minute-level granularity means the scheduler checks `current_hour == send_hour AND current_minute == send_minute`. This gives a 1-minute window per day per user.

### 9.3 Time Zone Handling

The `send_hour` and `send_minute` are stored as **UTC**. The frontend is responsible for converting the user's local time to UTC before saving, and converting back to local time for display.

### 9.4 Failed Deliveries

When a push delivery fails with a **410 Gone** or **404 Not Found** status, the subscription endpoint is no longer valid. The scheduler must **delete the subscription** from the `push_subscriptions` table automatically.

Other errors (network timeouts, 5xx) are logged but the subscription is retained.

### 9.5 node-cron Setup

In `backend/src/index.js`, after starting the HTTP server:

```js
const cron = require('node-cron');
const { runNotificationScheduler } = require('./notifications/scheduler');

cron.schedule('* * * * *', () => {
  runNotificationScheduler();
});
```

-----

## 10. Service Worker — Push Event Handling

The service worker (generated by `vite-plugin-pwa` with custom code injection) must handle two events:

### 10.1 Push Event

```js
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Capital Tracker', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});
```

### 10.2 Notification Click

```js
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});
```

-----

## 11. Frontend — Notification Settings UI

### 11.1 Location

Notification settings are managed in two places:

1. **User-level settings** — a new "Notifications" section in the user menu dropdown or a dedicated page accessible from the sidebar/navbar.
2. **Dossier opt-in** — within each dossier's Settings tab, or centralised in the user-level notification settings.

### 11.2 User Notification Settings Page

A new page or section accessible from the user menu. Contains:

#### Master Toggle
- Label: "Enable push notifications"
- Toggle switch. When disabled, no notifications are sent regardless of other settings.

#### Device Registration
- "Enable notifications on this device" button — triggers the browser's push permission dialog and subscribes.
- List of registered devices (from `GET /api/push/subscriptions`), showing creation date and a "Remove" button for each.
- If the current browser is already subscribed, the button shows "Notifications enabled on this device" (disabled state).

#### Delivery Time
- Label: "Send notifications at"
- Time picker (hour and minute). Displayed in the user's local timezone, stored as UTC.

#### Repetition
- Label: "Repeat notifications while condition persists"
- Toggle switch.
- When enabled, a number input appears: "Repeat every ___ day(s)" (1–7).

#### Dossier Selection
- Label: "Send notifications for these dossiers"
- Checkbox list of all dossiers the user has access to (owned + shared).
- Unchecked by default for new dossiers.

### 11.3 Dossier Settings Extension

The Dossier Settings tab gains a new field in the "Notifications" group (below Glances thresholds):

- "Notify about upcoming expenses ___ days before payment" — number input (0–7, default 1).

### 11.4 Permission Handling

The frontend must handle the browser notification permission state:

| State | Behaviour |
|-------|-----------|
| `default` | Show "Enable notifications on this device" button. Clicking requests permission. |
| `granted` | Automatically subscribe (if not already). Show "Notifications enabled on this device". |
| `denied` | Show a message: "Notifications are blocked in your browser settings. To enable them, update your browser's notification permissions for this site." The enable button is hidden. |

-----

## 12. Schema Changes

### 12.1 New Tables

#### `app_settings`

```sql
CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

#### `push_subscriptions`

```sql
CREATE TABLE push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth   TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

#### `user_notification_settings`

```sql
CREATE TABLE user_notification_settings (
  user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled              INTEGER NOT NULL DEFAULT 1,
  send_hour            INTEGER NOT NULL DEFAULT 9,
  send_minute          INTEGER NOT NULL DEFAULT 0,
  repeat_enabled       INTEGER NOT NULL DEFAULT 0,
  repeat_interval_days INTEGER NOT NULL DEFAULT 1
);
```

#### `dossier_notification_subscriptions`

```sql
CREATE TABLE dossier_notification_subscriptions (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, dossier_id)
);
```

#### `notification_log`

```sql
CREATE TABLE notification_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dossier_id INTEGER NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_key  TEXT NOT NULL,
  sent_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notification_log_lookup ON notification_log(user_id, dossier_id, event_type, event_key);
```

### 12.2 Dossier Table Extension

New column added via migration:

| Column | Type | Default |
|--------|------|---------|
| `expense_notification_days_before` | INTEGER | 1 |

### 12.3 Migration

All schema changes above go into a single migration: `020_pwa_push_notifications`.

-----

## 13. Backend Dependencies

| Package | Purpose | Dev/Prod |
|---------|---------|----------|
| `web-push` | VAPID key generation + sending push messages | production |
| `node-cron` | Minute-level scheduler | production |

-----

## 14. Icon Source File

The developer must place the app icon SVG at `frontend/public/icon.svg`. The SVG provided for this project is:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="120" fill="url(#bg)"/>
  <path
    d="M330 160 A120 120 0 1 0 330 352"
    fill="none" stroke="#ffffff" stroke-width="42" stroke-linecap="round"/>
  <polyline
    points="190,300 240,260 280,280 330,210"
    fill="none" stroke="#ffffff" stroke-width="28"
    stroke-linecap="round" stroke-linejoin="round"/>
  <polygon points="330,210 312,214 326,228" fill="#ffffff"/>
</svg>
```

This icon features a bold "C" with an integrated upward trend line and arrow, on a blue-to-indigo gradient background with rounded corners.

-----

## 15. File Summary

| File / Directory | Description |
|------------------|-------------|
| `frontend/public/manifest.webmanifest` | PWA manifest |
| `frontend/public/icon.svg` | Master icon source (developer-provided) |
| `frontend/public/icons/` | Generated PNG icons (build output) |
| `frontend/index.html` | Updated with manifest link, meta tags, apple-touch-icon |
| `frontend/vite.config.js` | Updated with `vite-plugin-pwa` configuration |
| `frontend/src/pages/NotificationSettings.jsx` | User notification settings page |
| `backend/src/notifications/scheduler.js` | Cron-based notification scheduler |
| `backend/src/notifications/push.js` | Web Push sending utilities (VAPID setup, send helpers) |
| `backend/src/routes/push.js` | Push subscription and VAPID key API routes |
| `backend/src/routes/notifications.js` | Notification settings and dossier opt-in API routes |
| `backend/src/db/index.js` | Migration `020_pwa_push_notifications` |

-----

## 16. iOS Safe Area

When running as a standalone PWA on iOS (with `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style: black-translucent`), the status bar overlaps the app content. The navbar and sidebar header must account for this using `env(safe-area-inset-top)`:

- `.navbar` and `.sidebar-logo` both have `height: calc(56px + env(safe-area-inset-top, 0px))`, `padding-top: env(safe-area-inset-top, 0px)`, `padding-bottom: 10px`, and `align-items: flex-end` so that the visible content sits in the lower 56px of the bar on all devices. The extra top area fills behind the iOS status bar with the app's background colour.
- The `viewport-fit=cover` meta tag is set in `index.html` to expose the safe area inset CSS variables.

-----

## 17. Out of Scope (this phase)

- Offline data access (reading/writing without backend connectivity)
- Email or SMS notifications
- Grouping or digest of multiple notifications into a single message
- Per-event-type opt-in (all 5 event types are always active when notifications are enabled)
- Notification history page in the UI (the log is internal only)
- Annual expense installment upcoming/overdue notifications as separate event types (they are merged with monthly expense notifications)
- Custom notification sounds
