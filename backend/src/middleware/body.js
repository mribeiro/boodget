const express = require('express');

// Dossier imports carry a whole dossier's history (years of cycles, Workbench snapshots), so
// they get a much higher limit than every other endpoint.
const IMPORT_BODY_LIMIT = '25mb';
// Raised above the default 100kb so a base64-encoded profile picture (resized client-side, but
// still ~33% larger encoded than raw) fits comfortably under the 2MB decoded-size cap enforced
// in routes/auth.js.
const DEFAULT_BODY_LIMIT = '4mb';
// Requests made before anyone has signed in (login, first-user setup) only ever carry a
// username and a password.
const PRE_AUTH_BODY_LIMIT = '16kb';

// JSON is parsed per router, *after* the rate limiter and — everywhere but setup and login —
// after requireAuth, so an anonymous client can no longer make the server parse up to 25MB
// before it knows who's asking or how often (#371). Compressed bodies are refused outright
// (`inflate: false` → 415): the frontend never sends them, and a few KB of gzip could inflate
// to the full limit.
const parser = (limit) => express.json({ limit, inflate: false });
const preAuthJson = parser(PRE_AUTH_BODY_LIMIT);
const defaultJson = parser(DEFAULT_BODY_LIMIT);
const importJson = parser(IMPORT_BODY_LIMIT);

// /api/auth mixes the anonymous login with signed-in requests (avatar upload, password change):
// only a request carrying a signed-in session gets the full limit.
function authRouteJson(req, res, next) {
  return (req.session?.userId ? defaultJson : preAuthJson)(req, res, next);
}

// Mounted under /api/dossiers, behind requireAuth: only the import gets the raised limit.
function dossierJson(req, res, next) {
  return (req.method === 'POST' && req.path === '/import' ? importJson : defaultJson)(req, res, next);
}

function formatLimit(bytes) {
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))}MB` : `${Math.round(bytes / 1024)}KB`;
}

// Turns body-parser failures into the API's usual { error } JSON instead of Express's default
// HTML error page (which the frontend could only show as "Payload Too Large").
function jsonBodyErrorHandler(err, req, res, next) {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: `Request is too large (limit ${formatLimit(err.limit)})` });
  }
  if (err && err.type === 'encoding.unsupported') {
    return res.status(415).json({ error: 'Compressed request bodies are not accepted' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  return next(err);
}

module.exports = {
  preAuthJson,
  defaultJson,
  authRouteJson,
  dossierJson,
  jsonBodyErrorHandler,
  IMPORT_BODY_LIMIT,
  DEFAULT_BODY_LIMIT,
  PRE_AUTH_BODY_LIMIT,
};
