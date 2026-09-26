const { db } = require('../db');

// Returns the ids in `ids` that don't name a row of `table` belonging to `dossierId`
// (optionally narrowed by `extraWhere`, e.g. "AND section = 'distribution'"). Selection
// endpoints use it to refuse ids from another dossier instead of storing links to them.
function idsNotInDossier(table, dossierId, ids, extraWhere = '') {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const ph = unique.map(() => '?').join(',');
  const found = new Set(
    db
      .prepare(`SELECT id FROM ${table} WHERE dossier_id = ? ${extraWhere} AND id IN (${ph})`)
      .all(dossierId, ...unique)
      .map((r) => r.id)
  );
  return unique.filter((id) => !found.has(id));
}

module.exports = { idsNotInDossier };
