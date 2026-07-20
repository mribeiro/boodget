# boodget — Backend Logging Specification

## 0. Instructions for Claude Code

- This specification documents the logging conventions for the backend.
- All new backend routes that perform mutations **must** include a log statement following these conventions.
- Do **not** log read (GET) operations — only mutations and security-relevant auth events.

---

## 1. Overview

The backend logs significant events to stdout using `console.log` with structured `[category] message` prefixes. This makes logs easy to filter in any container logging stack (Docker, systemd, etc.) without a logging library dependency.

---

## 2. Format

```
[category] Description of event, resource identifiers, acting user
```

Examples:
```
[auth] User logged in: alice (3f2e1d...)
[auth] Failed login attempt for username: bob
[dossiers] Created dossier "My Finances" (7a8b9c...) by user alice
[cycles] Closed cycle 2026/3 (4d5e6f...) in dossier 7a8b9c... by user alice
[db] Running migration: 020_your_description
```

Rules:
- Always include the acting user's **username** (not just ID) for user-triggered events.
- Include the resource **ID** when it exists (UUID or similar).
- For resource names, include them in quotes: `"name"`.
- Keep messages concise — one line per event.

---

## 3. Categories

| Category | File | Events |
|---|---|---|
| `[db]` | `db/index.js` | DB open (path), each migration applied, expired session cleanup |
| `[auth]` | `routes/auth.js` | Login success, login failure (username only — never log passwords), logout, password change, OIDC user auto-creation, login rate limit exceeded (username, IP) |
| `[users]` | `routes/users.js` | User created, user deleted |
| `[dossiers]` | `routes/dossiers.js` | Dossier created, imported, exported, deleted; access granted, access revoked |
| `[accounts]` | `routes/accounts.js` | Account created, account archived |
| `[months]` | `routes/months.js` | Month created, month submitted (filled), month reset |
| `[cycles]` | `routes/expenses.js` | Cycle created, cycle closed, cycle reopened, cycle deleted |
| `[settings]` | `routes/expenses.js` | Settings updated (include the list of changed field names) |
| `[goals]` | `routes/goals.js` | Goal created, goal deleted |
| `[loans]` | `routes/loans.js` | Loan created, updated, deleted |
| `[emergency-fund]` | `routes/emergency-fund.js` | Account selection updated |
| `[security]` | `middleware/rate-limit.js` | Global API rate limit exceeded (method, path, IP) |

---

## 4. What NOT to Log

- GET / read operations (too noisy, no operational value)
- Individual cycle item updates (paid/spent/done toggles — too granular)
- Template item edits (too granular)
- Workbench snapshot saves (ephemeral/frequent)
- Request payloads or response bodies
- Passwords, tokens, or any secret values

---

## 5. Security Considerations

- **Never log passwords** — not even failed ones.
- **Never log the Paperless token** or any stored credential.
- For failed login attempts, log only the username to help identify brute-force patterns without leaking sensitive data.
- For OIDC, log username and new user creation but not token details.

---

## 6. Adding Logs to New Routes

When adding a new mutation route, add a `console.log` immediately before or after the successful DB write, following this template:

```js
console.log(`[category] Action "resource name" (${id}) in dossier ${req.params.id} by user ${req.user.username}`);
```

For routes without a dossier context:
```js
console.log(`[category] Action: target (${id}) by ${req.user.username}`);
```

For error/security events (these use `console.log`, not `console.error`, as they are expected events):
```js
console.log(`[auth] Failed login attempt for username: ${username}`);
```

Use `console.error` only for unexpected infrastructure failures (OIDC init failure, unhandled exceptions).
