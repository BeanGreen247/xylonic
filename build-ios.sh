#!/usr/bin/env bash
# build-ios.sh — build Xylonic for iOS (macOS only)
# Usage:
#   bash build-ios.sh                  # sync + simulator build (debug)
#   bash build-ios.sh release          # sync + archive for device (release)
#   bash build-ios.sh --sync-only      # only build React + cap sync, no xcodebuild
#   Short forms: -s = --sync-only

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

# ── Parse arguments ───────────────────────────────────────────────────────────
SYNC_ONLY=false
BUILD_TYPE="debug"

for arg in "$@"; do
    case "$arg" in
        --sync-only|-s) SYNC_ONLY=true ;;
        debug)          BUILD_TYPE="debug" ;;
        release)        BUILD_TYPE="release" ;;
        *) err "Unknown argument: '$arg'
       Usage: bash build-ios.sh [debug|release] [--sync-only|-s]" ;;
    esac
done

echo ""
echo "=================================================="
_banner="  Xylonic — build-ios.sh  [$BUILD_TYPE]"
$SYNC_ONLY && _banner="$_banner (sync-only)"
echo "$_banner"
echo "=================================================="
echo ""

# ── macOS check ───────────────────────────────────────────────────────────────
if [ "$(uname -s)" != "Darwin" ]; then
    err "iOS builds require macOS with Xcode.
       On Linux, use GitHub Actions instead:
         git push origin main   (triggers ios.yml workflow automatically)
       Or run the workflow manually in the Actions tab on GitHub.
       See IOS_SETUP.md for full instructions."
fi
ok "Running on macOS"

# ── Check Xcode ───────────────────────────────────────────────────────────────
if ! command -v xcodebuild &>/dev/null; then
    err "Xcode command-line tools not found.
       Install with: xcode-select --install
       Then install Xcode from the Mac App Store."
fi
XCODE_VER=$(xcodebuild -version 2>/dev/null | head -1)
ok "Xcode: $XCODE_VER"

# ── Check CocoaPods ───────────────────────────────────────────────────────────
if ! command -v pod &>/dev/null; then
    warn "CocoaPods not found — installing..."
    sudo gem install cocoapods
fi
ok "CocoaPods: $(pod --version)"

# ── Install npm dependencies ──────────────────────────────────────────────────
echo ""
info "Installing npm dependencies..."
npm install --legacy-peer-deps --silent
ok "Dependencies ready"

# ── Build React bundle ────────────────────────────────────────────────────────
echo ""
info "Building React production bundle ($BUILD_TYPE)..."
node scripts/write-build-info.js "$BUILD_TYPE" 2>/dev/null || true
VITE_BUILD_TYPE="$BUILD_TYPE" npm run build
ok "React build complete"

# ── Scaffold ios/ if missing ──────────────────────────────────────────────────
if [ ! -d "ios" ]; then
    echo ""
    warn "ios/ directory not found — running 'npx cap add ios' (first time setup)..."
    npx cap add ios
    ok "iOS project scaffolded"
    echo ""
    warn "ACTION NEEDED: Commit the ios/ directory to your repo:"
    warn "  git add ios/ && git commit -m 'feat: add Capacitor iOS project scaffold'"
fi

# ── Capacitor sync ────────────────────────────────────────────────────────────
echo ""
info "Syncing web assets into iOS project..."
npx cap sync ios
ok "Capacitor sync complete"

if $SYNC_ONLY; then
    echo ""
    ok "Sync complete. Skipping xcodebuild (--sync-only)."
    echo ""
    echo "  Open in Xcode with:  npx cap open ios"
    echo "=================================================="
    echo ""
    exit 0
fi

WORKSPACE="ios/App/App.xcworkspace"
if [ ! -d "$WORKSPACE" ]; then
    err "Xcode workspace not found at $WORKSPACE
       Run 'npx cap open ios' and let Xcode resolve the CocoaPods dependencies first."
fi

# ── Build ─────────────────────────────────────────────────────────────────────
if [ "$BUILD_TYPE" = "debug" ]; then
    echo ""
    info "Building for iOS Simulator (no signing required)..."
    xcodebuild \
        -workspace "$WORKSPACE" \
        -scheme App \
        -sdk iphonesimulator \
        -configuration Debug \
        build \
        CODE_SIGNING_ALLOWED=NO \
        | grep -E "error:|warning:|Build succeeded|BUILD FAILED" || true

    ok "Simulator build complete"
    echo ""
    info "Launch in Xcode Simulator:"
    echo "  npx cap open ios"
    echo "  Then press ▶ in Xcode"

else
    ARCHIVE_PATH="./Xylonic.xcarchive"
    echo ""
    info "Archiving for iOS device (release)..."
    warn "Note: you need a valid code signing identity configured in Xcode first."
    warn "      Open Xcode → Signing & Capabilities and set your team before archiving."
    echo ""

    xcodebuild archive \
        -workspace "$WORKSPACE" \
        -scheme App \
        -sdk iphoneos \
        -configuration Release \
        -archivePath "$ARCHIVE_PATH" \
        | grep -E "error:|warning:|BUILD FAILED|Archive Succeeded" || true

    if [ -d "$ARCHIVE_PATH" ]; then
        ok "Archive created: $ARCHIVE_PATH"
        echo ""
        info "Export .ipa:"
        echo "  If you have ExportOptions.plist:"
        echo "    xcodebuild -exportArchive -archivePath $ARCHIVE_PATH \\"
        echo "      -exportPath ./Xylonic-ipa -exportOptionsPlist ios/ExportOptions.plist"
        echo ""
        echo "  Or open Xcode → Window → Organizer to export and distribute."
        echo ""
        info "Install on iPhone via AltStore:"
        echo "  Open AltStore → + → select the .ipa file"
        echo "  See IOS_SETUP.md for full AltStore setup instructions."
    else
        warn "Archive may have failed — check xcodebuild output above."
        warn "Common fix: open Xcode and configure code signing first."
    fi
fi

echo ""
echo "=================================================="
ok "iOS build finished"
echo ""
echo "Build finished at: $(date)"
