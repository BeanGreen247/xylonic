#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/build-timed.js <command> [args...]');
  process.exit(1);
}

const start = Date.now();

const result = spawnSync(args[0], args.slice(1), {
  stdio: 'inherit',
  shell: true,
});

const elapsedMs = Date.now() - start;
const totalSecs = Math.round(elapsedMs / 1000);
const mins = Math.floor(totalSecs / 60);
const secs = totalSecs % 60;
const fmt = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

if (result.status === 0) {
  console.log(`\n✓  Build finished in ${fmt}`);
} else {
  console.log(`\n✗  Build failed after ${fmt}`);
  process.exit(result.status ?? 1);
}
