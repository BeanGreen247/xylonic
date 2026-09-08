#!/usr/bin/env bash
# ios-autoload.sh — one command: pull latest CI iOS build, sign it for THIS
# iPhone, install it. No Mac, no Windows, no Sideloadly.
#
#   bash scripts/ios-autoload.sh [work-dir]
#
# It:
#   1. refreshes signing assets in $XYLONIC_SIGN_DIR (~/.xylonic-sign/) from the
#      Secret Service keyring (private key, put there by iLoader) + the
#      provisioning profile pulled live off the device      → ios-extract-signing.py
#   2. downloads the latest unsigned IPA from GitHub Actions → download-ios-ipa.sh
#   3. signs it with zsign, rewriting the bundle id to the id the profile is for
#      (iLoader mangles it to <bundleid>.<teamid>)
#   4. installs it with `pymobiledevice3 apps install` over the RSD tunnel
#
# Prereqs (one-time):
#   - gh authenticated                       gh auth login
#   - zsign on PATH                          github.com/zhlynn/zsign
#   - pymobiledevice3 on PATH                pipx install pymobiledevice3
#   - python3-gi + gir1.2-secret-1           (keyring read)
#   - RSD tunnel running:                    sudo pymobiledevice3 remote tunneld
#   - iLoader used at least once in the last 7 days so a current dev cert +
#     provisioning profile exist (github.com/nab138/iloader). Re-run iLoader
#     whenever the profile is within a day of expiry (this script warns).
#
# Everything under $XYLONIC_SIGN_DIR and every *.ipa is git-ignored.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SIGN_DIR="${XYLONIC_SIGN_DIR:-$HOME/.xylonic-sign}"
WORK="${1:-$(mktemp -d -t xylonic-ios-XXXXXX)}"
TUNNELD_URL="${PYMOBILEDEVICE3_TUNNELD_URL:-http://127.0.0.1:49151}"
SKIP_EXTRACT="${XYLONIC_SKIP_EXTRACT:-0}"

die()  { printf '\033[0;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[0;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33mwarn:\033[0m %s\n' "$*" >&2; }

command -v gh              >/dev/null || die "gh not found"
command -v zsign           >/dev/null || die "zsign not found (github.com/zhlynn/zsign)"
command -v pymobiledevice3 >/dev/null || die "pymobiledevice3 not found"
gh auth status >/dev/null 2>&1        || die "gh not authenticated — gh auth login"
curl -sf "$TUNNELD_URL" >/dev/null 2>&1 || \
  die "RSD tunnel not up at $TUNNELD_URL — sudo pymobiledevice3 remote tunneld"

mkdir -p "$WORK"

# ── 1. refresh signing assets ───────────────────────────────────────────────
if [ "$SKIP_EXTRACT" != "1" ]; then
  info "refreshing signing assets in $SIGN_DIR"
  python3 "$SCRIPT_DIR/ios-extract-signing.py"
fi
P12="$SIGN_DIR/cert.p12"
PROV="$SIGN_DIR/app.mobileprovision"
[ -f "$P12" ] && [ -f "$PROV" ] || die "no signing assets in $SIGN_DIR — run ios-extract-signing.py"
P12_PASS="$(cat "$SIGN_DIR/p12.pass" 2>/dev/null || echo "${XYLONIC_P12_PASS:-}")"
BUNDLE_ID="$(cat "$SIGN_DIR/bundle_id" 2>/dev/null || true)"
[ -n "$BUNDLE_ID" ] || die "no bundle_id recorded in $SIGN_DIR (re-run ios-extract-signing.py)"
# (ios-extract-signing.py prints the profile's ExpirationDate; a stale profile
#  surfaces as 0xe8008018 at the install step below.)

# ── 2. download latest unsigned IPA ────────────────────────────────────────
info "downloading latest iOS build from GitHub Actions"
bash "$SCRIPT_DIR/download-ios-ipa.sh" "$WORK" >/dev/null
UNSIGNED="$(find "$WORK" -maxdepth 2 -name '*.ipa' ! -name 'Xylonic-signed.ipa' | head -1)"
[ -n "$UNSIGNED" ] || die "download produced no .ipa"
info "unsigned: $(basename "$UNSIGNED") ($(du -h "$UNSIGNED" | cut -f1))"

# ── 3. sign (rewrite bundle id to match the profile) ───────────────────────
SIGNED="$WORK/Xylonic-signed.ipa"
info "signing as $BUNDLE_ID"
zsign -z 9 -k "$P12" -p "$P12_PASS" -m "$PROV" -b "$BUNDLE_ID" -o "$SIGNED" "$UNSIGNED" \
  || die "zsign failed"
[ -f "$SIGNED" ] || die "zsign produced no output"
info "signed: $(du -h "$SIGNED" | cut -f1)"

# ── 4. install ────────────────────────────────────────────────────────────
info "installing on device"
pymobiledevice3 apps install "$SIGNED" \
  || die "install failed — if it's 0xe8008018 the profile has expired: run iLoader once, then retry"

info "done — Xylonic ($BUNDLE_ID) updated on device; app data preserved"
[ "${1:-}" ] || info "work dir: $WORK"
