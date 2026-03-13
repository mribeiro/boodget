'use strict';

const http = require('http');
const { execSync } = require('child_process');

const PORT = 3000;
const DOMAIN = process.env.PREVIEW_DOMAIN || '';
const CONTAINER_PREFIX = 'capital-tracker-preview-';

function getContainers() {
  try {
    const raw = execSync(
      'curl -sf --unix-socket /var/run/docker.sock http://localhost/v1.41/containers/json?all=true',
      { encoding: 'utf8' }
    );
    const containers = JSON.parse(raw);
    return containers.filter((c) =>
      c.Names && c.Names.some((n) => n.startsWith('/' + CONTAINER_PREFIX))
    );
  } catch (_) {
    return [];
  }
}

function slugFromContainer(container) {
  const name = container.Names.find((n) => n.startsWith('/' + CONTAINER_PREFIX));
  return name ? name.slice(1 + CONTAINER_PREFIX.length) : '?';
}

function relativeTime(unixTimestamp) {
  const diff = Math.floor(Date.now() / 1000) - unixTimestamp;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function stateBadge(state) {
  const color = state === 'running' ? '#2e7d32' : '#757575';
  return `<span style="background:${color};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px;">${state}</span>`;
}

function renderPage(containers) {
  const rows = containers.length === 0
    ? '<tr><td colspan="4" style="text-align:center;color:#888;padding:24px;">No preview environments running.</td></tr>'
    : containers.map((c) => {
        const slug = slugFromContainer(c);
        const url = DOMAIN ? `https://${slug}.preview.${DOMAIN}` : `(no domain set)`;
        const link = DOMAIN ? `<a href="${url}" target="_blank" rel="noopener">${url}</a>` : url;
        return `<tr>
          <td style="padding:10px 16px;font-family:monospace;">${slug}</td>
          <td style="padding:10px 16px;">${stateBadge(c.State)}</td>
          <td style="padding:10px 16px;color:#555;">${c.Status || ''}</td>
          <td style="padding:10px 16px;">${link}</td>
          <td style="padding:10px 16px;color:#888;font-size:13px;">${relativeTime(c.Created)}</td>
        </tr>`;
      }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="refresh" content="30">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Capital Tracker — Preview Environments</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 0; background: #f5f5f5; color: #222; }
    header { background: #1a237e; color: #fff; padding: 20px 32px; }
    header h1 { margin: 0; font-size: 22px; font-weight: 600; }
    header p { margin: 4px 0 0; font-size: 13px; opacity: 0.75; }
    main { padding: 32px; max-width: 1100px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,.1); overflow: hidden; }
    thead { background: #e8eaf6; }
    th { padding: 10px 16px; text-align: left; font-size: 13px; font-weight: 600; color: #444; text-transform: uppercase; letter-spacing: .04em; }
    tbody tr:not(:last-child) { border-bottom: 1px solid #f0f0f0; }
    tbody tr:hover { background: #fafafa; }
    a { color: #1a237e; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <header>
    <h1>Capital Tracker — Preview Environments</h1>
    <p>Auto-refreshes every 30 seconds &bull; ${containers.length} environment${containers.length !== 1 ? 's' : ''} found</p>
  </header>
  <main>
    <table>
      <thead>
        <tr>
          <th>Slug</th>
          <th>State</th>
          <th>Status</th>
          <th>URL</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </main>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  const containers = getContainers();
  const html = renderPage(containers);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, () => {
  console.log(`Preview index listening on port ${PORT}`);
});
