# design-sync notes — capital-tracker

This repo is **not** a design-system package — `frontend/` is a private,
unpublished SPA (`vite build`, no `main`/`module`/`exports` in `package.json`,
no TypeScript anywhere). The user explicitly opted to sync
`frontend/src/components/ui/` (the app's small internal primitive library —
Badge, Button, Card, Checkbox, CollapsibleSection, KpiBlock, KpiStrip, Modal,
Toast) as a stand-in design system anyway. Several defaults had to be
overridden as a result:

## No Node.js on this machine

The host has no `node`/`npm`/`nvm` anywhere. The user chose to run the
converter (npm installs, esbuild, ts-morph, playwright/chromium) inside a
Docker container with the repo mounted, rather than installing Node on the
host. Every re-sync needs the same Docker-based build — see `buildCmd`-adjacent
instructions in the runbook below (no `cfg.buildCmd` is set since there's no
in-repo build script; the Docker invocation itself is the build step).

## No TypeScript — hand-written `dtsPropsFor`

Zero `.d.ts`/`.tsx` in the repo. Prop contracts for all 9 synced components
were hand-written into `cfg.dtsPropsFor` by reading each component's source
directly (they're all small, so this was tractable). If a component's props
change, `dtsPropsFor` must be updated by hand — it will NOT auto-detect drift.

## Custom entry file: `frontend/.design-sync-entry.mjs`

Every `ui/` component is a **default export only** (`export default function
Button() {...}`, no named export). `export * from './Button.jsx'` (what the
converter's synth-entry mode writes automatically) never re-exports a
`default` binding — the resulting bundle would have had an empty
`window.CapitalTrackerUI`. Worked around by hand-writing
`frontend/.design-sync-entry.mjs` with explicit `export { default as X }`
lines, and passing it via `cfg.entry`/`--entry`. This file is committed
(needed for every re-sync) but is NOT part of the real app — it's never
imported by anything under `src/`.

`componentSrcMap` also had to explicitly pin all 9 components (non-null) since,
with an explicit `--entry` override, `resolvePackage` never runs its
synth-entry fallback discovery (`deriveComponentsFromSrc`) — that fallback
only fires when no entry override is given. Excluded `UpdateBanner` (`null`)
— it's PWA/service-worker infra tightly coupled to `virtual:pwa-register` (a
Vite-only virtual module, unresolvable by esbuild outside a Vite build), not
a reusable design-system primitive.

## Icon library registration

`Checkbox.jsx` references an icon by string name (`icon="check"`), which only
resolves if `@fortawesome/fontawesome-svg-core`'s `library.add(...)` has run
first. The real app does this as a side effect via `src/icons.js` (imported
once in `main.jsx`). `.design-sync-entry.mjs` imports `./src/icons.js` for its
side effect too, so the bundle self-registers before any preview renders.

## Font: Inter via Google Fonts `<link>`, not shipped

The real app loads Inter from `https://fonts.googleapis.com/...` via an HTML
`<link>` tag in `index.html` — there's no local `@font-face`/woff2 to harvest,
and the package-shape converter has no remote-`@import` scraping path (that
only exists for the storybook shape, from `storybook-static`). Set
`cfg.runtimeFontPrefixes: ["Inter"]` to suppress `[FONT_MISSING]` rather than
self-hosting a copy of the font — this is what the real app does too (fetch
from Google's CDN at page load), so it's not a fidelity compromise, just
means Inter won't render inside claude.ai/design previews themselves (system
sans-serif fallback there) unless the app hosting Claude Design's iframe also
loads it.

## `cssEntry`

Set to the real `frontend/src/index.css` verbatim (2300+ lines: CSS custom
properties for theming + the utility classes the `ui/` components use, e.g.
`.btn-primary`, `.card`, `.badge-success`). No wrapper file needed — index.css
has zero `@import`s of its own, so a straight file copy is faithful. Dark mode
exists via a `[data-theme="dark"]` attribute selector (documented in
`conventions.md`) but isn't required for base rendering — `:root` light-theme
values are the default.

## Checkbox's `label` prop is a real (unused, buggy) dead end

While authoring previews, two labeled `Checkbox`es rendered visually
overlapping/garbled. Root cause verified in `frontend/src/index.css`:
`.checkbox-custom` is a fixed `20px x 20px` box with `justify-content: center`;
the icon + `label` span are flex children with no `flex-shrink:0`/`overflow`
constraint, so any `label` wider than the box centers as a group and overflows
in **both** directions — the left portion of the caption clips off-box and the
checkmark ends up visually mid-word. Confirmed via `grep` that **`label` is
never passed anywhere in the real app** (only appears in the component's own
JSDoc usage comment) — every real call site renders the caption as a separate
sibling element instead (e.g. `DossierSettingsTab.jsx`). The authored preview
(`Checkbox.tsx`) follows the real, working sibling-span convention and does
NOT demonstrate `label`; a caveat comment was added to `cfg.dtsPropsFor.Checkbox`
so the emitted `.d.ts`/`.prompt.md` steers the design agent away from it too.
This is a real, pre-existing app bug (not something introduced by the sync) —
worth a small upstream fix (`flex-shrink: 0` on the icon + a min-width or
overflow rule) if the `label` prop is ever meant to be used for real.

## Modal's preview card is graded `needs-work` — harness limitation, not a defect

`Modal`'s two authored cells (`EditFieldModal`, `NoFooter`) render with the
title bar/close button missing (pushed off-canvas above y=0). Root-caused via
the raw per-story captures (`ds-bundle/_screenshots/review/raw/`): the
preview harness wraps every single-mode/`?story=` render in a `.ds-single`
div with `transform: translateZ(0)` (`lib/emit.mjs`, off-limits to fork —
it's shared output-contract code). A `transform` on an ancestor becomes the
containing block for `position:fixed` descendants — `Modal`'s
`.modal-overlay` (`position:fixed; inset:0`) then resolves its height against
`.ds-single`'s auto/shrink-to-fit height instead of the true viewport, so
`align-items:center` centers the modal card against a near-zero-height box —
pushing roughly its top half above the visible frame. `Toast` (`position:
fixed; bottom:32px; right:24px`, no `align-items:center`, only two of the four
inset properties set) doesn't hit this — its two cells render and grade
clean. This is a structural limitation of the design-sync tool's own preview
compositing (GPU-layer isolation via `transform`, presumably to contain
`[GRID_OVERFLOW]`/escape in grid mode — `.ds-cell` sets the same `transform`
**plus** `overflow:hidden`, which would be strictly worse for Modal, not
better) — it would recur for ANY React design system's full-viewport
`position:fixed` dialog synced through this tool, not something specific to
this repo. **Not fixable from the preview-authoring surface.** The component
itself is unaffected in the real app (Modal is never rendered inside a
transformed ancestor there) and ships fully functional/importable regardless
of preview-card quality — only the two card *previews* are graded
`needs-work`, with the reasoning captured in
`.design-sync/.cache/review/Modal.grade.json`. If design-sync ever adds a way
to opt a component's single-mode render out of the `.ds-single` transform
(or an escape-hatch equivalent), redo Modal's grade then.

## Re-sync risks (read before re-running)

- If `frontend/src/components/ui/` gains a new component, it must be added
  BOTH to `.design-sync-entry.mjs` (as a named re-export) AND to
  `componentSrcMap` AND given a hand-written `dtsPropsFor` entry — nothing
  auto-discovers new components in this setup.
- If a component's props change shape, `dtsPropsFor` silently goes stale —
  nothing diffs it against the source.
- `.design-sync-entry.mjs` is a build-time-only file with no real caller in
  the app; a future contributor unfamiliar with this sync could reasonably
  delete it as dead code. It's documented here and via its own file header.
- The Docker-based build isn't automated/scripted anywhere yet — re-run
  instructions live only in this NOTES.md and the conversation that produced
  it. Worth turning into a checked-in script if re-syncs become routine.
