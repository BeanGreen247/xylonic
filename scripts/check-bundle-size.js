#!/usr/bin/env node
'use strict';

/**
 * Bundle-size gate (WS-PERF). Run after `npm run build`. Prints the size of the
 * app's main chunks and fails if any exceeds its ceiling — so a careless import
 * that balloons the bundle can't merge unnoticed.
 *
 * Ceilings are ~10–15% above the 2026-09-07 post-FA-trim baseline (see
 * docs/PERF_LEDGER.md). Raise them deliberately, with a ledger entry, when a
 * feature genuinely needs the room — never just to make CI green.
 */

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'dist', 'assets');

// glob-ish prefix -> { label, maxKB }  (raw bytes, not gzip)
const LIMITS = [
  { prefix: 'index-',            suffix: '.js',  label: 'modern app JS',  maxKB: 680 },
  { prefix: 'index-legacy-',     suffix: '.js',  label: 'legacy app JS',  maxKB: 1100 },
  { prefix: 'polyfills-legacy-', suffix: '.js',  label: 'legacy polyfills', maxKB: 180 },
  { prefix: 'index-',            suffix: '.css', label: 'app CSS',        maxKB: 265 },
];

if (!fs.existsSync(ASSETS)) {
  console.error(`[bundle-size] ${ASSETS} not found — run \`npm run build\` first.`);
  process.exit(1);
}

const files = fs.readdirSync(ASSETS);
let failed = false;

for (const { prefix, suffix, label, maxKB } of LIMITS) {
  const match = files.find(f => f.startsWith(prefix) && f.endsWith(suffix));
  if (!match) {
    console.error(`[bundle-size] FAIL  ${label.padEnd(18)} — no file matching ${prefix}*${suffix}`);
    failed = true;
    continue;
  }
  const kb = fs.statSync(path.join(ASSETS, match)).size / 1024;
  const over = kb > maxKB;
  const status = over ? 'FAIL' : 'ok  ';
  console.log(`[bundle-size] ${status}  ${label.padEnd(18)} ${kb.toFixed(1).padStart(8)} kB  (limit ${maxKB} kB)  ${match}`);
  if (over) failed = true;
}

if (failed) {
  console.error('\n[bundle-size] A chunk is over budget. Trim it, or raise the limit in scripts/check-bundle-size.js with a docs/PERF_LEDGER.md entry.');
  process.exit(1);
}
console.log('[bundle-size] all chunks within budget');
