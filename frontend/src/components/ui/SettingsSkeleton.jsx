/**
 * Placeholder shown while a settings section's data is still loading.
 *
 * Sections used to seed state with hardcoded defaults (25/7/22/25, 6/6, 1) and render
 * them immediately, so a slow — or failed — load presented confident wrong numbers
 * that were indistinguishable from saved values. A skeleton is the honest alternative.
 *
 * Usage:
 *   if (!settings) return <SettingsSkeleton rows={2} />;
 */
export default function SettingsSkeleton({ rows = 2 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="settings-skeleton-row" />
      ))}
    </div>
  );
}
