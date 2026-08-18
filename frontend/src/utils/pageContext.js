// Module-level singleton (not React state) holding a small, serializable summary of whatever
// dossier page is currently on screen — a loan's full detail, a cycle's items, a list tab's rows,
// etc. — so the floating AI chat widget (mounted once in AppShell, far from any given page) can
// optionally attach it to a chat message. Only one page is ever "current", so this is simpler than
// aiAdvisorSession.js's per-dossier Map: a single slot, republished on every page mount/update and
// cleared on unmount.
let current = null; // { label: string, data: object } | null
const subs = new Set();

export function publishPageContext(ctx) {
  current = ctx;
  for (const cb of subs) cb(current);
}

export function clearPageContext() {
  current = null;
  for (const cb of subs) cb(current);
}

export function subscribePageContext(cb) {
  subs.add(cb);
  cb(current);
  return () => subs.delete(cb);
}

export function getPageContext() {
  return current;
}
