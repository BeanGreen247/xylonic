#!/usr/bin/env node
'use strict';

/**
 * Stamp package.json `version` with today's date as `YY.MM.DD` (local time).
 *
 * This is the project's CalVer scheme: one version per calendar day. It runs at
 * the start of EVERY build — `npm run build`, every `electron:build:*`,
 * `build-android.sh`, `build-ios.sh`, `scripts/build-{debug,release}.js`, and the
 * Android/iOS/desktop CI workflows — so artifacts always carry the build date.
 * It is idempotent (no-op if package.json already holds today's date), so it
 * only ever dirties the working tree once per day; `git checkout package.json`
 * reverts it. The committed package.json version is the "last released" marker,
 * bumped by hand alongside the CHANGELOG.
 *
 *   node scripts/set-version-date.js          # 26.09.07
 *   node scripts/set-version-date.js --dry    # print, don't write
 *
 * Everything downstream (write-build-info.js -> the About screen, Electron window
 * titles, electron-builder artifact versions, android/app/build.gradle which
 * parses package.json for versionName/versionCode, and the iOS PlistBuddy step)
 * reads package.json, so this stays the single source of truth.
 */

const fs = require('fs');
const path = require('path');

const dry = process.argv.includes('--dry') || process.argv.includes('--dry-run');

const now = new Date();
const yy = String(now.getFullYear()).slice(-2);
const mm = String(now.getMonth() + 1).padStart(2, '0');
const dd = String(now.getDate()).padStart(2, '0');
const dateVersion = `${yy}.${mm}.${dd}`;

const pkgPath = path.join(__dirname, '..', 'package.json');
const raw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);
const current = pkg.version;

if (current === dateVersion) {
  console.log(`[version] package.json already at ${dateVersion} — nothing to do.`);
  console.log('[version] (the scheme is one version per day; rebuild again tomorrow or edit by hand for a same-day re-cut)');
  process.exit(0);
}

if (dry) {
  console.log(`[version] ${current} -> ${dateVersion}  (dry run, not written)`);
  process.exit(0);
}

// Preserve the file's existing indentation + trailing newline.
const indentMatch = raw.match(/^\{\n(\s+)"/);
const indent = indentMatch ? indentMatch[1].length : 2;
pkg.version = dateVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, indent) + '\n');

console.log(`[version] package.json ${current} -> ${dateVersion}`);
console.log('[version] next: retitle CHANGELOG.md "## [Unreleased]" to "## [' + dateVersion + ']" and commit.');
