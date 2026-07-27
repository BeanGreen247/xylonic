#!/usr/bin/env bash
# build-android.sh — build Xylonic for Android
# Usage:
#   bash build-android.sh                        # full build + install — debug APK (default)
#   bash build-android.sh release                # full build + install — release APK
#   bash build-android.sh both                   # full build + install — debug + release
#   bash build-android.sh --install-only         # install existing debug APK, skip build
#   bash build-android.sh --install-only release # install existing release APK, skip build
#   bash build-android.sh release --install-only # same as above (flag order doesn't matter)
#   bash build-android.sh --build-only           # build debug APK, skip ADB install
#   bash build-android.sh release --build-only   # build release APK, skip ADB install
#   Short forms: -i = --install-only   -b = --build-only

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}[OK]${RESET}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${RESET} $*"; }
err()  { echo -e "${RED}[ERR]${RESET}  $*"; exit 1; }
info() { echo -e "${CYAN}[INFO]${RESET} $*"; }

# Patch Capacitor/npm Gradle files to silence Gradle 8 deprecation warnings.
# These files are regenerated (by cap sync or npm install) on every run, so
# we patch them after each regeneration step.
_patch_one_gradle() {
    python3 - "$1" <<'PYEOF'
import re, sys
path = sys.argv[1]
with open(path) as fh:
    c = fh.read()
# Remove flatDir{...} repository block (capacitor-cordova file only)
c = re.sub(r'\n[ \t]*flatDir\{[^}]*\}', '', c)
# Fix deprecated lintOptions -> lint
c = c.replace('lintOptions {', 'lint {')
# Fix property assignments missing '=' (Gradle 8 deprecation)
c = c.replace('versionCode 1', 'versionCode = 1')
c = c.replace('versionName "1.0"', 'versionName = "1.0"')
c = c.replace('minifyEnabled false', 'minifyEnabled = false')
with open(path, 'w') as fh:
    fh.write(c)
PYEOF
}

# Run gradlew, filtering informational-only lines that aren't errors.
# Preserves gradlew's exit code so build failures still abort the script.
_GRADLE_NOISE='^\[Incubating\]|^To honour the JVM|^Daemon will be stopped|^Deprecated Gradle features|^You can use.*warning-mode|^For more on this.*docs\.gradle|^[[:space:]]*$'
_GRADLE_QUIET='^> Task :|^Note: |^w: |^BUILD SUCCESSFUL|^[0-9]+ actionable tasks:'
run_gradle() {
    local filter="$_GRADLE_NOISE"
    $VERBOSE || filter="$filter|$_GRADLE_QUIET"
    local _rc
    set +e
    (cd android && ./gradlew "$@" --no-daemon) 2>&1 | grep -vE "$filter"
    _rc=${PIPESTATUS[0]}
    set -e
    return $_rc
}

patch_gradle_files() {
    local files=(
        "android/capacitor-cordova-android-plugins/build.gradle"
        "node_modules/@capacitor/android/capacitor/build.gradle"
        "node_modules/@capacitor/filesystem/android/build.gradle"
        "node_modules/@capacitor/preferences/android/build.gradle"
    )
    for f in "${files[@]}"; do
        [ -f "$f" ] && _patch_one_gradle "$f"
    done
}

# ── Parse arguments (flag can appear in any position) ────────────────────────
INSTALL_ONLY=false
BUILD_ONLY=false
VERBOSE=false
BUILD_TYPE="debug"

for arg in "$@"; do
    case "$arg" in
        --install-only|-i) INSTALL_ONLY=true ;;
        --build-only|-b)   BUILD_ONLY=true ;;
        --verbose|-v)      VERBOSE=true ;;
        debug|release|both) BUILD_TYPE="$arg" ;;
        *) err "Unknown argument: '$arg'
       Usage: bash build-android.sh [debug|release|both] [--install-only|-i] [--build-only|-b] [--verbose|-v]" ;;
    esac
done

if $INSTALL_ONLY && $BUILD_ONLY; then
    err "--install-only and --build-only are mutually exclusive."
fi

echo ""
echo "=================================================="
_banner="  Xylonic — build-android.sh  [$BUILD_TYPE]"
$INSTALL_ONLY && _banner="$_banner (install-only)"
$BUILD_ONLY   && _banner="$_banner (build-only)"
$VERBOSE      && _banner="$_banner (verbose)"
echo "$_banner"
echo "=================================================="
echo ""

# ── Detect OS and set ANDROID_HOME if not already set ────────────────────────
if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
    case "$(uname -s)" in
        Linux*)
            export ANDROID_HOME="$HOME/Android/Sdk"
            ;;
        Darwin*)
            export ANDROID_HOME="$HOME/Library/Android/sdk"
            ;;
        *)
            err "Unsupported OS: $(uname -s). Set ANDROID_HOME manually and re-run."
            ;;
    esac
    info "ANDROID_HOME set to: $ANDROID_HOME"
else
    ANDROID_HOME="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
    ok "ANDROID_HOME already set: $ANDROID_HOME"
fi

# ── Verify SDK directory exists ───────────────────────────────────────────────
if [ ! -d "$ANDROID_HOME" ]; then
    err "Android SDK not found at $ANDROID_HOME
       Install Android Studio first, then re-run.
       See ANDROID_SETUP.md for instructions."
fi

# ── Export PATH additions ─────────────────────────────────────────────────────
export PATH="$PATH:$ANDROID_HOME/platform-tools"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin"
export PATH="$PATH:$ANDROID_HOME/build-tools/34.0.0"

ok "PATH updated with Android SDK tools"

if ! $INSTALL_ONLY; then
    # ── Verify Java ───────────────────────────────────────────────────────────
    info "Checking Java..."
    if ! command -v java &>/dev/null; then
        err "Java not found. Install JDK 17+:
       Ubuntu/Debian: sudo apt install openjdk-17-jdk
       See ANDROID_SETUP.md for other platforms."
    fi
    ok "Java: $(java -version 2>&1 | head -1)"

    # ── Verify Gradle wrapper is executable ───────────────────────────────────
    GRADLEW="android/gradlew"
    if [ ! -f "$GRADLEW" ]; then
        err "Gradle wrapper not found at $GRADLEW
       Run 'npx cap add android' first."
    fi
    chmod +x "$GRADLEW"
    ok "Gradle wrapper ready"

    # ── Install dependencies once ─────────────────────────────────────────────
    echo ""
    info "Installing dependencies..."
    NODE_ENV=development npm install --legacy-peer-deps --silent
    ok "Dependencies up to date"
    patch_gradle_files

    # ── Step 3: Gradle clean ─────────────────────────────────────────────────
    echo ""
    info "Running Gradle clean..."
    run_gradle clean
    ok "Gradle clean complete"

    # ── Helpers: React bundle + Gradle variant ────────────────────────────────

    # build_react_bundle <debug|release>
    # Writes build-info.json, runs npm build, and syncs assets into Android.
    build_react_bundle() {
        local btype="$1"
        echo ""
        node scripts/write-build-info.js "$btype"
        info "Building React production bundle ($btype)..."
        VITE_BUILD_TYPE="$btype" npm run build
        ok "React build complete"
        echo ""
        info "Copying web assets into Android project..."
        cp -r dist/. android/app/src/main/assets/public/
        ok "Web assets copied"
        echo ""
        info "Syncing Capacitor plugins into Android project..."
        npx cap sync android || warn "cap sync had issues — web assets already copied above, continuing..."
        patch_gradle_files
        ok "Capacitor sync complete"
    }

    build_debug() {
        echo ""
        info "Building debug APK..."
        run_gradle assembleDebug
        APK="android/app/build/outputs/apk/debug/app-debug.apk"
        if [ -f "$APK" ]; then
            SIZE=$(du -sh "$APK" | cut -f1)
            ok "Debug APK built: $APK ($SIZE)"
        else
            err "Debug APK not found after build — check Gradle output above"
        fi
    }

    build_release() {
        echo ""
        info "Building release APK..."
        LOCAL_PROPS="android/local.properties"
        if ! grep -q "KEYSTORE_FILE" "$LOCAL_PROPS" 2>/dev/null; then
            warn "No keystore credentials found in $LOCAL_PROPS"
            warn "The release APK will be unsigned. Add KEYSTORE_FILE / KEYSTORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD."
        fi
        run_gradle assembleRelease
        APK="android/app/build/outputs/apk/release/app-release.apk"
        UNSIGNED="android/app/build/outputs/apk/release/app-release-unsigned.apk"
        if [ -f "$APK" ]; then
            SIZE=$(du -sh "$APK" | cut -f1)
            ok "Release APK built: $APK ($SIZE)"
        elif [ -f "$UNSIGNED" ]; then
            SIZE=$(du -sh "$UNSIGNED" | cut -f1)
            ok "Release APK built (unsigned): $UNSIGNED ($SIZE)"
            warn "Sign with: jarsigner -keystore xylonic-release.jks $UNSIGNED xylonic"
        else
            err "Release APK not found after build — check Gradle output above"
        fi
    }

    case "$BUILD_TYPE" in
        debug)
            build_react_bundle debug
            build_debug
            ;;
        release)
            build_react_bundle release
            build_release
            ;;
        both)
            build_react_bundle debug
            build_debug
            echo ""
            build_react_bundle release
            build_release
            ;;
    esac
else
    # ── Install-only: just verify the APK exists before proceeding ────────────
    info "Skipping build — using existing APK(s)"
    DEBUG_APK="android/app/build/outputs/apk/debug/app-debug.apk"
    RELEASE_APK="android/app/build/outputs/apk/release/app-release.apk"
    RELEASE_UNSIGNED="android/app/build/outputs/apk/release/app-release-unsigned.apk"

    case "$BUILD_TYPE" in
        debug)
            [ -f "$DEBUG_APK" ] || err "No debug APK found at $DEBUG_APK
       Run without --install-only to build it first."
            SIZE=$(du -sh "$DEBUG_APK" | cut -f1)
            ok "Found debug APK: $DEBUG_APK ($SIZE)"
            ;;
        release)
            if [ -f "$RELEASE_APK" ]; then
                SIZE=$(du -sh "$RELEASE_APK" | cut -f1)
                ok "Found release APK: $RELEASE_APK ($SIZE)"
            elif [ -f "$RELEASE_UNSIGNED" ]; then
                SIZE=$(du -sh "$RELEASE_UNSIGNED" | cut -f1)
                ok "Found release APK (unsigned): $RELEASE_UNSIGNED ($SIZE)"
            else
                err "No release APK found at $RELEASE_APK or $RELEASE_UNSIGNED
       Run without --install-only to build it first."
            fi
            ;;
        both)
            [ -f "$DEBUG_APK" ] || err "No debug APK found at $DEBUG_APK
       Run without --install-only to build it first."
            { [ -f "$RELEASE_APK" ] || [ -f "$RELEASE_UNSIGNED" ]; } || err "No release APK found.
       Run without --install-only to build it first."
            SIZE=$(du -sh "$DEBUG_APK" | cut -f1)
            ok "Found debug APK: $DEBUG_APK ($SIZE)"
            ;;
    esac
fi

# ── Step 4: Install on connected device via ADB ───────────────────────────────
if $BUILD_ONLY; then
    echo ""
    ok "Build complete. Skipping ADB install (--build-only)."
    echo ""
    echo "=================================================="
    ok "Android build finished"
    echo ""
    exit 0
fi

echo ""
info "Checking for connected ADB device..."

# Resolve adb binary: prefer SDK's own copy, fall back to system PATH
ADB_CMD="$ANDROID_HOME/platform-tools/adb"
if [ ! -x "$ADB_CMD" ]; then
    ADB_CMD="$(command -v adb 2>/dev/null || true)"
fi

if [ -z "$ADB_CMD" ]; then
    warn "adb binary not found. Add Android SDK platform-tools to PATH and retry."
else
    # awk picks only lines that have a tab then the word "device" — filters out the header
    # and any "unauthorized" / "offline" entries
    DEVICES=$("$ADB_CMD" devices 2>/dev/null | awk -F'\t' '$2=="device"{print $1}')

    install_apk() {
        local apk="$1"
        if [ ! -f "$apk" ]; then
            warn "APK not found at $apk — skipping install."
            return
        fi
        info "Installing $(basename "$apk")..."

        local out rc
        out=$("$ADB_CMD" install -r "$apk" 2>&1); rc=$?
        echo "$out"

        # adb reports success/failure in the output text regardless of exit code
        if [ $rc -eq 0 ] && echo "$out" | grep -qi "^Success"; then
            ok "Installed successfully."
            return
        fi

        # Signature or version mismatch — uninstall the old copy and retry
        if echo "$out" | grep -qiE "INSTALL_FAILED_UPDATE_INCOMPATIBLE|INSTALL_FAILED_VERSION_DOWNGRADE|signatures do not match"; then
            warn "Signature/version conflict detected — uninstalling old build and retrying..."
            "$ADB_CMD" uninstall "$APP_ID" 2>/dev/null || true
            local out2 rc2
            out2=$("$ADB_CMD" install "$apk" 2>&1); rc2=$?
            echo "$out2"
            if [ $rc2 -eq 0 ] && echo "$out2" | grep -qi "^Success"; then
                ok "Installed successfully (after removing old build)."
                return
            fi
            warn "Fresh install also failed — check the output above."
        else
            warn "Install failed — check the output above."
        fi
        warn "Manual install command:  $ADB_CMD install -r $apk"
    }

    resolve_release_apk() {
        local signed="android/app/build/outputs/apk/release/app-release.apk"
        local unsigned="android/app/build/outputs/apk/release/app-release-unsigned.apk"
        if [ -f "$signed" ]; then
            echo "$signed"
        else
            echo "$unsigned"
        fi
    }

    APP_ID="xylonic.beangreen247xyz.musicplayer"
    APP_ACTIVITY=".MainActivity"

    if [ -z "$DEVICES" ]; then
        warn "No ADB device detected. Enable USB debugging on your phone, connect it, then run:"
        case "$BUILD_TYPE" in
            release) warn "  $ADB_CMD install -r $(resolve_release_apk)" ;;
            *)       warn "  $ADB_CMD install -r android/app/build/outputs/apk/debug/app-debug.apk" ;;
        esac
    else
        DEVICE_COUNT=$(echo "$DEVICES" | wc -l)
        [ "$DEVICE_COUNT" -gt 1 ] && warn "Multiple devices detected ($DEVICE_COUNT) — installing on all."

        info "Force-stopping any running instance of $APP_ID..."
        "$ADB_CMD" shell am force-stop "$APP_ID" 2>/dev/null || true
        ok "App stopped"

        case "$BUILD_TYPE" in
            debug)
                install_apk "android/app/build/outputs/apk/debug/app-debug.apk"
                ;;
            release)
                install_apk "$(resolve_release_apk)"
                ;;
            both)
                install_apk "android/app/build/outputs/apk/debug/app-debug.apk"
                install_apk "$(resolve_release_apk)"
                ;;
        esac

        info "Launching $APP_ID..."
        "$ADB_CMD" shell am start -n "$APP_ID/$APP_ACTIVITY" 2>/dev/null && ok "App launched" || warn "Could not auto-launch — open the app manually."
    fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "=================================================="
ok "Android build finished"
echo ""
echo "Build finished at: $(date)"
