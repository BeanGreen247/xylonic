#!/usr/bin/env node
'use strict';

/**
 * Full release build for all platforms.
 * Working dirs (cleared each run):
 *   dist/linux-final/   — AppImage, deb, tar.gz
 *   dist/windows-final/ — NSIS installer exe, portable exe
 *   dist/android-final/ — signed release APK
 *
 * After a successful build each platform dir is moved into:
 *   releases/<version>/linux-final/
 *   releases/<version>/windows-final/
 *   releases/<version>/android-final/
 *
 * Staging dir __eb_stage/ (root, temporary) keeps electron-builder output
 * outside dist/ so the "dist/**\/*" files pattern never bundles old installers.
 */

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');
const pkg  = require('../package.json');

const ROOT    = path.resolve(__dirname, '..');
const STAGE   = path.join(ROOT, '__eb_stage');
const LIN_OUT = path.join(ROOT, 'dist', 'linux-final');
const WIN_OUT = path.join(ROOT, 'dist', 'windows-final');
const AND_OUT = path.join(ROOT, 'dist', 'android-final');
const REL_DIR = path.join(ROOT, 'releases', pkg.version);

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
        console.error(`\n[build-release] ${err.message}`);
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

// Archive one platform dir into releases/<version>/<name>/ immediately after building it.
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
    console.log(`  archived -> releases/${pkg.version}/${name}/`);
}

// ── main ─────────────────────────────────────────────────────────────────────

const TOTAL = 6;

console.log('\n╔══════════════════════════════════════════════╗');
console.log(`║    XYLONIC v${pkg.version} — RELEASE BUILD`.padEnd(47) + '║');
console.log('╚══════════════════════════════════════════════╝');

step(1, TOTAL, 'Stamp release build info');
runFatal('node scripts/write-build-info.js release');

step(2, TOTAL, 'Web build (release mode)');
runFatal('npm run build', {
    env: { ...process.env, VITE_BUILD_TYPE: 'release' },
});

step(3, TOTAL, 'Linux desktop packages (AppImage · deb · tar.gz)');
cleanDir(STAGE);
cleanDir(LIN_OUT);
runFatal(`npx electron-builder --linux --config.directories.output=${STAGE}`);
const linCount = copyMatching(STAGE, /\.(AppImage|deb|tar\.gz)$/, LIN_OUT);
fs.rmSync(STAGE, { recursive: true, force: true });
console.log(`  ${linCount} artifact(s) -> dist/linux-final/`);
// Archive now — the Android vite build (step 5) will wipe dist/ via emptyOutDir:true.
archivePlatform('linux-final', LIN_OUT);

step(4, TOTAL, 'Windows desktop packages (NSIS · portable · zip)');
cleanDir(STAGE);
cleanDir(WIN_OUT);
tryBuild('Windows', () => {
    run(`npx electron-builder --win --config.directories.output=${STAGE}`);
    const winCount = copyMatching(STAGE, /\.(exe|zip)$/, WIN_OUT);
    console.log(`  ${winCount} artifact(s) -> dist/windows-final/`);
});
if (fs.existsSync(STAGE)) fs.rmSync(STAGE, { recursive: true, force: true });
// Archive now — same reason as Linux above.
archivePlatform('windows-final', WIN_OUT);

step(5, TOTAL, 'Android release APK');
const shResult = spawnSync('bash', ['build-android.sh', 'release', '--build-only'], {
    stdio: 'inherit',
    cwd: ROOT,
});
// Recreate AND_OUT after spawnSync — Vite's emptyOutDir:true wipes dist/ during the
// Android React bundle rebuild.
fs.mkdirSync(AND_OUT, { recursive: true });
if (shResult.status !== 0) {
    console.warn('  [warn] Android build failed — check build-android.sh output above');
} else {
    const apkSrc      = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
    const apkUnsigned = path.join(ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release-unsigned.apk');
    const resolvedSrc = fs.existsSync(apkSrc) ? apkSrc : fs.existsSync(apkUnsigned) ? apkUnsigned : null;
    const apkDest = path.join(AND_OUT, `Xylonic-${pkg.version}-release.apk`);
    if (resolvedSrc) {
        fs.copyFileSync(resolvedSrc, apkDest);
        console.log(`  -> Xylonic-${pkg.version}-release.apk`);
    } else {
        console.warn('  [warn] APK not found — signing config may be missing in android/local.properties');
    }
}
archivePlatform('android-final', AND_OUT);

step(6, TOTAL, `Summary — releases/${pkg.version}/`);
if (fs.existsSync(REL_DIR)) {
    for (const slot of ['linux-final', 'windows-final', 'android-final']) {
        const d = path.join(REL_DIR, slot);
        if (fs.existsSync(d)) {
            const files = fs.readdirSync(d);
            console.log(`  releases/${pkg.version}/${slot}/  (${files.length} file(s))`);
            for (const f of files) console.log(`    ${f}`);
        }
    }
} else {
    console.log('  (no artifacts — all platform builds failed)');
}

console.log('\n╔══════════════════════════════════════════════╗');
console.log('║              RELEASE BUILD DONE              ║');
console.log('╚══════════════════════════════════════════════╝');
console.log(`\nFinal artifacts: releases/${pkg.version}/\n`);
