#!/usr/bin/env node
'use strict';

// Visual QA helper: logs into a running boodget frontend and saves a screenshot.
// See "Visual QA — Screenshot Every UI Change" in CLAUDE.md for the full workflow
// (throwaway backend/frontend setup, viewport sizes, seeded preview dossiers).
//
// Usage:
//   node scripts/screenshot.js <path> <outFile> [options]
//
// Options:
//   --width=390            viewport width  (default 1440)
//   --height=844            viewport height (default 900)
//   --selector=".foo"       crop to one element instead of the full page
//   --base=http://...       frontend origin (default http://localhost:5173)
//   --user=preview          login username (default: seeded preview user)
//   --pass=...              login password (default: seeded preview password)
//
// The frontend's /api proxy target is hardcoded in vite.config.js to
// http://localhost:3000 — Chromium refuses to let page.route() rewrite a
// request to a different origin (ERR_BLOCKED_BY_CLIENT), so the throwaway
// backend MUST run on port 3000 for this script's requests to reach it.

function resolvePlaywright() {
  try {
    return require('playwright');
  } catch {
    return require('/opt/node22/lib/node_modules/playwright');
  }
}

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      opts[key] = value ?? true;
    } else {
      positional.push(arg);
    }
  }
  return { positional, opts };
}

async function main() {
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [targetPath, outFile] = positional;
  if (!targetPath || !outFile) {
    console.error('Usage: node scripts/screenshot.js <path> <outFile> [options]');
    process.exit(1);
  }

  const width = Number(opts.width || 1440);
  const height = Number(opts.height || 900);
  const base = opts.base || 'http://localhost:5173';
  const username = opts.user || 'preview';
  const password = opts.pass || 'Preview@Capital2024!';

  const { chromium } = resolvePlaywright();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();

    await page.goto(base + '/login', { waitUntil: 'networkidle' });
    if (page.url().includes('/login')) {
      await page.fill('#username', username);
      await page.fill('#password', password);
      await page.click('button[type="submit"]');
      await page.waitForURL((u) => !u.pathname.includes('/login'));
    }

    await page.goto(base + targetPath, { waitUntil: 'networkidle' });

    if (opts.selector) {
      await page.locator(opts.selector).screenshot({ path: outFile });
    } else {
      await page.screenshot({ path: outFile, fullPage: true });
    }
    console.log(`Saved ${outFile} (${width}x${height})`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
