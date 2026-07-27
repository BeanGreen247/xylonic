#!/usr/bin/env node
'use strict';

const pkg = require('../package.json');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const buildType = process.argv[2] || 'debug';
if (!['debug', 'release'].includes(buildType)) {
  console.error(`Invalid build type: "${buildType}". Use "debug" or "release".`);
  process.exit(1);
}

const buildNumber = buildType === 'debug' ? crypto.randomBytes(3).toString('hex') : null;

function stripRange(v) {
  return (v || '').replace(/^[\^~>=< ]+/, '');
}

function parseGradleInts(content) {
  const result = {};
  for (const [, key, val] of content.matchAll(/(\w+)\s*=\s*(\d+)/g)) result[key] = val;
  return result;
}

const gradlePath = path.join(__dirname, '..', 'android', 'variables.gradle');
const gradle = fs.existsSync(gradlePath)
  ? parseGradleInts(fs.readFileSync(gradlePath, 'utf8'))
  : {};

const { dependencies: dep = {}, devDependencies: dev = {} } = pkg;

const buildInfo = {
  version: pkg.version,
  buildType,
  buildNumber,
  builtAt: new Date().toISOString(),
  deps: {
    react:            stripRange(dep['react']),
    typescript:       stripRange(dev['typescript']),
    vite:             stripRange(dev['vite']),
    axios:            stripRange(dep['axios']),
    fontawesome:      stripRange(dep['@fortawesome/fontawesome-free']),
    electron:         stripRange(dev['electron']),
    electronBuilder:  stripRange(dev['electron-builder']),
    capacitor:        stripRange(dep['@capacitor/core']),
    androidMinSdk:    gradle.minSdkVersion    ?? null,
    androidTargetSdk: gradle.targetSdkVersion ?? null,
  },
};

const outPath = path.join(__dirname, '..', 'public', 'build-info.json');
fs.writeFileSync(outPath, JSON.stringify(buildInfo, null, 2) + '\n');

const label = buildType === 'debug' ? `debug #${buildNumber}` : 'release';
console.log(`[build-info] Written: v${pkg.version} (${label})`);

// ── Write licenses.json ───────────────────────────────────────────────────────
const root = path.join(__dirname, '..');
const nm   = path.join(root, 'node_modules');

function readLicenseFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').trimEnd(); } catch { return ''; }
}

function viteCoreOnly(text) {
  const cut = text.indexOf('\n# Licenses of bundled dependencies');
  return (cut > 0 ? text.slice(0, cut) : text).trimEnd();
}

const licenses = {
  xylonic:         { spdx: 'MIT',                          text: readLicenseFile(path.join(root, 'LICENSE')) },
  react:           { spdx: 'MIT',                          text: readLicenseFile(path.join(nm, 'react/LICENSE')) },
  typescript:      { spdx: 'Apache-2.0',                   text: readLicenseFile(path.join(nm, 'typescript/LICENSE.txt')) },
  vite:            { spdx: 'MIT',                          text: viteCoreOnly(readLicenseFile(path.join(nm, 'vite/LICENSE.md'))) },
  axios:           { spdx: 'MIT',                          text: readLicenseFile(path.join(nm, 'axios/LICENSE')) },
  fontawesome:     { spdx: 'CC-BY-4.0 AND OFL-1.1 AND MIT', text: readLicenseFile(path.join(nm, '@fortawesome/fontawesome-free/LICENSE.txt')) },
  electron:        { spdx: 'MIT',                          text: readLicenseFile(path.join(nm, 'electron/LICENSE')) },
  electronBuilder: { spdx: 'MIT',                          text: readLicenseFile(path.join(nm, 'electron-builder/LICENSE')) },
  capacitor:       { spdx: 'MIT',                          text: readLicenseFile(path.join(nm, '@capacitor/core/LICENSE')) },
};

const licensesPath = path.join(root, 'public', 'licenses.json');
fs.writeFileSync(licensesPath, JSON.stringify(licenses) + '\n');
console.log(`[build-info] Licenses written: ${Object.keys(licenses).length} entries`);
