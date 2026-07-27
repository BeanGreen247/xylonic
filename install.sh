#!/usr/bin/env bash
# install.sh — development environment bootstrap for Xylonic
# Run once after cloning: bash install.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}[OK]${RESET}  $*"; }
warn() { echo -e "${YELLOW}[WARN]${RESET} $*"; }
err()  { echo -e "${RED}[ERR]${RESET}  $*"; }
info() { echo -e "${CYAN}[INFO]${RESET} $*"; }

echo ""
echo "=================================================="
echo "  Xylonic — install.sh"
echo "=================================================="
echo ""

# ── Node.js ──────────────────────────────────────────
info "Checking Node.js..."
if ! command -v node &>/dev/null; then
    err "Node.js not found. Install Node.js 20+ from https://nodejs.org and re-run this script."
    exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.version)")
NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 20 ]; then
    warn "Node.js $NODE_VER detected. Version 20+ is recommended."
else
    ok "Node.js $NODE_VER"
fi

# ── npm ──────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
    err "npm not found. It should come with Node.js."
    exit 1
fi
ok "npm $(npm --version)"

# ── Install dependencies ──────────────────────────────
echo ""
info "Installing npm dependencies..."
NODE_ENV=development npm install --legacy-peer-deps

ok "Dependencies installed"

# ── Electron check ───────────────────────────────────
echo ""
info "Checking Electron dev environment..."
if [ -f node_modules/.bin/electron ]; then
    ok "Electron binary present"
else
    warn "Electron binary not found in node_modules — Electron builds may fail"
fi

# ── Android (optional) ───────────────────────────────
echo ""
info "Checking Android build environment (optional)..."

ANDROID_OK=true

if ! command -v java &>/dev/null; then
    warn "Java not found — Android builds require JDK 17+"
    warn "       Ubuntu/Debian: sudo apt install openjdk-17-jdk"
    ANDROID_OK=false
else
    ok "Java: $(java -version 2>&1 | head -1)"
fi

if [ -z "$ANDROID_HOME" ] && [ -z "$ANDROID_SDK_ROOT" ]; then
    warn "ANDROID_HOME not set — Android builds will not work"
    warn "       See ANDROID_SETUP.md for installation instructions"
    ANDROID_OK=false
else
    SDK_PATH="${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
    ok "Android SDK: $SDK_PATH"
fi

if ! command -v adb &>/dev/null; then
    warn "adb not found in PATH — device installs via adb will not work"
    ANDROID_OK=false
else
    ok "adb: $(adb version | head -1)"
fi

if $ANDROID_OK; then
    ok "Android environment looks ready"
    echo ""
    info "Syncing Android project with current web build..."
    npm run android:sync
    ok "Android project synced — open it with: npm run android:open"
else
    echo ""
    warn "Android environment incomplete. See ANDROID_SETUP.md to finish setup."
    warn "Electron builds (Windows/Linux) are unaffected."
fi

# ── Done ─────────────────────────────────────────────
echo ""
echo "=================================================="
echo ""
ok "Setup complete. Quick start:"
echo ""
echo "  Electron dev server:    npm run electron:serve"
echo "  Build Windows portable: npm run electron:build:win-portable"
echo "  Build Linux tar.gz:     npm run electron:build:linux-tar"
echo "  Android sync + open:    npm run android:sync && npm run android:open"
echo ""
echo "  See README.md and ANDROID_SETUP.md for full details."
echo ""
