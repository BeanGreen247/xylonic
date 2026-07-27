#!/usr/bin/env node
'use strict';

/**
 * Full debug build for all platforms.
 * Working dirs (cleared each run):
 *   dist/linux-debug/   — AppImage, deb, tar.gz (debug-stamped)
 *   dist/windows-debug/ — NSIS installer exe, portable exe (debug-stamped)
 *   dist/android-debug/ — debug APK (unsigned, directly installable via adb)
 *
 * After a successful build each platform dir is moved into:
 *   releases/<version>-debug/linux-debug/
 *   releases/<version>-debug/windows-debug/
 *   releases/<version>-debug/android-debug/
 */

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const pkg  = require('../package.json');

const ROOT    = path.resolve(__dirname, '..');
const STAGE   = path.join(ROOT, '__eb_stage');
const LIN_OUT = path.join(ROOT, 'dist', 'linux-debug');
const WIN_OUT = path.join(ROOT, 'dist', 'windows-debug');
const AND_OUT = path.join(ROOT, 'dist', 'android-debug');
const REL_DIR = path.join(ROOT, 'releases', `${pkg.version}-debug`);

// ── helpers ──────────────────────────────────────────────────────────────────

function step(n, total, label) {
    console.log(`\n[${n}/${total}] ${label}`);
}

function cleanDir(dir) {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
}

function run(cmd, opts = {}) {
    try {
        execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
    } catch (err) {
        const e = new Error(`command failed: ${cmd}`);
        e.status = err.status || 1;
        throw e;
    }
}

function runFatal(cmd, opts = {}) {
    try {
        run(cmd, opts);
    } catch (err) {
        console.error(`\n[build-debug] ${err.message}`);
        process.exit(err.status || 1);
    }
}

function copyMatching(srcDir, re, destDir) {
    const matched = fs.readdirSync(srcDir).filter(f => re.test(f));
    for (const f of matched) {
        fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
        console.log(`  -> ${f}`);
    }
    return matched.length;
}

function tryBuild(label, buildFn) {
    try {
        buildFn();
    } catch {
        console.warn(`  [skip] ${label} build failed (wine/cross-compile may be needed)`);
    }
}

// Copy a directory tree recursively (used as rename fallback across devices).
function cpDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        entry.isDirectory() ? cpDir(s, d) : fs.copyFileSync(s, d);
    }
}

// Move src → dest, crossing device boundaries if needed.
function moveDir(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
        fs.renameSync(src, dest);
    } catch {
        cpDir(src, dest);
        fs.rmSync(src, { recursive: true, force: true });
    }
}

// Archive one platform dir immediately after building it.
// Called inline so the Android vite build's emptyOutDir:true can't wipe already-built artifacts.
function archivePlatform(name, srcDir) {
    if (!fs.existsSync(srcDir) || fs.readdirSync(srcDir).length === 0) {
        console.log(`  [archive] ${name}: nothing to archive`);
        return;
    }
    fs.mkdirSync(REL_DIR, { recursive: true });
    const dest = path.join(REL_DIR, name);
    if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
    moveDir(srcDir, dest);
    console.log(`  archived -> releases/${pkg.version}-debug/${name}/`);
}

// ── main ─────────────────────────────────────────────────────────────────────

const TOTAL = 6;

console.log('\n╔══════════════════════════════════════════════╗');
console.log(`║    XYLONIC v${pkg.version} — DEBUG BUILD`.padEnd(47) + '║');
console.log('╚══════════════════════════════════════════════╝');

step(1, TOTAL, 'Stamp debug build info');
runFatal('node scripts/write-build-info.js debug');

step(2, TOTAL, 'Web build (debug mode)');
runFatal('npm run build', {
    env: { ...process.env, VITE_BUILD_TYPE: 'debug' },
});

step(3, TOTAL, 'Linux desktop packages (AppImage · deb · tar.gz)');
cleanDir(STAGE);
cleanDir(LIN_OUT);
runFatal(`npx electron-builder --linux --config.directories.output=${STAGE}`);
const linCount = copyMatching(STAGE, /\.(AppImage|deb|tar\.gz)$/, LIN_OUT);
fs.rmSync(STAGE, { recursive: true, force: true });
console.log(`  ${linCount} artifact(s) -> dist/linux-debug/`);
// Archive now — the Android vite build (step 5) will wipe dist/ via emptyOutDir:true.
archivePlatform('linux-debug', LIN_OUT);

step(4, TOTAL, 'Windows desktop packages (NSIS · portable · zip)');
cleanDir(STAGE);
cleanDir(WIN_OUT);
tryBuild('Windows', () => {
    run(`npx electron-builder --win --config.directories.output=${STAGE}`);
    const winCount = copyMatching(STAGE, /\.(exe|zip)$/, WIN_OUT);
    console.log(`  ${winCount} artifact(s) -> dist/windows-debug/`);
});
if (fs.existsSync(STAGE)) fs.rmSync(STAGE, { recursive: true, force: true });
// Archive now — same reason as Linux above.
archivePlatform('windows-debug', WIN_OUT);

step(5, TOTAL, 'Android debug APK');
const shResult = spawnSync('bash', ['build-android.sh', 'debug', '--build-only'], {
    stdio: 'inherit',
    cwd: ROOT,
});
// Recreate AND_OUT after spawnSync — Vite's emptyOutDir:true wipes dist/ during the
// Android React bundle rebuild.
fs.mkdirSync(AND_OUT, { recursive: true });
if (shResult.status !== 0) {
    console.warn('  [warn] Android build failed — check build-android.sh output above');
} else {
    const apkSrc  = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    const apkDest = path.join(AND_OUT, `Xylonic-${pkg.version}-debug.apk`);
    if (fs.existsSync(apkSrc)) {
        fs.copyFileSync(apkSrc, apkDest);
        console.log(`  -> Xylonic-${pkg.version}-debug.apk`);
    } else {
        console.warn('  [warn] debug APK not found');
    }
}
archivePlatform('android-debug', AND_OUT);

step(6, TOTAL, `Summary — releases/${pkg.version}-debug/`);
if (fs.existsSync(REL_DIR)) {
    for (const slot of ['linux-debug', 'windows-debug', 'android-debug']) {
        const d = path.join(REL_DIR, slot);
        if (fs.existsSync(d)) {
            const files = fs.readdirSync(d);
            console.log(`  releases/${pkg.version}-debug/${slot}/  (${files.length} file(s))`);
            for (const f of files) console.log(`    ${f}`);
        }
    }
} else {
    console.log('  (no artifacts — all platform builds failed)');
}

console.log('\n╔══════════════════════════════════════════════╗');
console.log('║               DEBUG BUILD DONE               ║');
console.log('╚══════════════════════════════════════════════╝');
console.log(`\nFinal artifacts: releases/${pkg.version}-debug/\n`);
