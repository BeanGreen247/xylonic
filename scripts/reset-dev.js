#!/usr/bin/env node

/**
 * Dev reset script — simulates a first-time install for testing login + first-setup flow.
 *
 * Clears:
 *   settings.cfg          — saved credentials / preferences
 *   color_settings/       — per-user theme configs
 *   Local Storage/        — Chromium localStorage (auth tokens, cache flags, etc.)
 *   IndexedDB/            — image cache + search index (XylonicImageCache, XylonicSearchCache)
 *   Cache/                — Chromium HTTP cache
 *   app.log               — log file
 *
 * Preserves by default:
 *   permanent_cache/      — downloaded offline audio (expensive to re-fetch)
 *
 * Pass --clear-audio to also wipe permanent_cache.
 *
 * Usage:
 *   node scripts/reset-dev.js
 *   node scripts/reset-dev.js --clear-audio
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const clearAudio = process.argv.includes('--clear-audio');

// ── Resolve userData path ──────────────────────────────────
function getUserDataPath() {
  const platform = os.platform();
  const home     = os.homedir();
  // Electron uses package.json `name` (lowercase) in dev, productName in production.
  // The productName is "Xylonic" but in dev the app runs as "xylonic".
  // Check both so the script works regardless.
  const candidates = [];

  if (platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(path.join(appData, 'xylonic'));
    candidates.push(path.join(appData, 'Xylonic'));
  } else if (platform === 'darwin') {
    candidates.push(path.join(home, 'Library', 'Application Support', 'xylonic'));
    candidates.push(path.join(home, 'Library', 'Application Support', 'Xylonic'));
  } else {
    candidates.push(path.join(home, '.config', 'xylonic'));
    candidates.push(path.join(home, '.config', 'Xylonic'));
  }

  const found = candidates.find(p => fs.existsSync(p));
  if (!found) {
    console.log(`No userData directory found. Checked:`);
    candidates.forEach(p => console.log(`  ${p}`));
    console.log('\nNothing to clean — run the app at least once first.');
    process.exit(0);
  }
  return found;
}

// ── Delete a single path (file or directory) ──────────────
function remove(target, label) {
  if (!fs.existsSync(target)) {
    console.log(`  skip  ${label} (not found)`);
    return false;
  }
  try {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      fs.rmSync(target, { recursive: true, force: true });
    } else {
      fs.unlinkSync(target);
    }
    console.log(`  ✓     ${label}`);
    return true;
  } catch (err) {
    console.warn(`  !     ${label} — could not remove: ${err.message}`);
    return false;
  }
}

// ── Main ───────────────────────────────────────────────────
const userData = getUserDataPath();

console.log('\n╔══════════════════════════════════════════════╗');
console.log('║           XYLONIC DEV RESET                  ║');
console.log('╚══════════════════════════════════════════════╝');
console.log(`\nuserData: ${userData}`);
if (clearAudio) {
  console.log('Mode: FULL reset (including offline audio cache)\n');
} else {
  console.log('Mode: standard reset  (offline audio preserved — use --clear-audio to wipe it too)\n');
}

// Items that always get cleared
const always = [
  ['settings.cfg',    'Settings file (credentials + preferences)'],
  ['color_settings',  'Color theme configs'],
  ['Local Storage',   'Chromium localStorage  (auth, cache flags, etc.)'],
  ['IndexedDB',       'IndexedDB              (image cache + search index)'],
  ['Cache',           'Chromium HTTP cache'],
  ['Code Cache',      'V8 code cache'],
  ['app.log',         'Log file'],
];

let removed = 0;
let skipped = 0;

for (const [name, label] of always) {
  const ok = remove(path.join(userData, name), label);
  ok ? removed++ : skipped++;
}

// Offline audio cache — only if --clear-audio
if (clearAudio) {
  const ok = remove(path.join(userData, 'permanent_cache'), 'Offline audio cache (permanent_cache)');
  ok ? removed++ : skipped++;
} else {
  console.log(`  kept  Offline audio cache (permanent_cache) — pass --clear-audio to wipe`);
  skipped++;
}

console.log(`\n──────────────────────────────────────────────`);
console.log(`  Removed: ${removed}   Skipped/not found: ${skipped}`);
console.log(`──────────────────────────────────────────────`);
console.log('\nDone. Launch the app — it will show the first-time login screen.\n');
