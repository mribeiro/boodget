const express = require('express');

// Dossier imports carry a whole dossier's history (years of cycles, Workbench snapshots), so
// they get a much higher limit than every other endpoint.
const IMPORT_BODY_LIMIT = '25mb';
// Raised above the default 100kb so a base64-encoded profile picture (resized client-side, but
// still ~33% larger encoded than raw) fits comfortably under the 2MB decoded-size cap enforced
// in routes/auth.js.
const DEFAULT_BODY_LIMIT = '4mb';

// Mounts the JSON body parsers. The import route's parser runs first; the general one then
// skips that request because its body has already been parsed.
function useJsonBodyParsers(app) {
  app.use('/api/dossiers/import', express.json({ limit: IMPORT_BODY_LIMIT }));
  app.use(express.json({ limit: DEFAULT_BODY_LIMIT }));
}

// Turns body-parser failures into the API's usual { error } JSON instead of Express's default
// HTML error page (which the frontend could only show as "Payload Too Large").
function jsonBodyErrorHandler(err, req, res, next) {
  if (err && err.type === 'entity.too.large') {
    const limit = req.originalUrl.startsWith('/api/dossiers/import') ? IMPORT_BODY_LIMIT : DEFAULT_BODY_LIMIT;
    return res.status(413).json({ error: `Request is too large (limit ${limit.toUpperCase()})` });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  return next(err);
}

module.exports = { useJsonBodyParsers, jsonBodyErrorHandler, IMPORT_BODY_LIMIT, DEFAULT_BODY_LIMIT };
