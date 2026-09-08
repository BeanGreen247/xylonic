#!/usr/bin/env bash
# ios-autoload.sh — download the latest CI iOS build, sign it with zsign, and
# install it onto a USB-connected iPhone via pymobiledevice3. One command.
#
#   bash scripts/ios-autoload.sh [work-dir]
#
# Prereqs (one-time):
#   - gh CLI authenticated                (download step)
#   - zsign on PATH                       (sign step;  https://github.com/zhlynn/zsign)
#   - pymobiledevice3 on PATH             (install step)
#   - a running RSD tunnel:  sudo pymobiledevice3 remote tunneld   (iOS 17+)
#   - signing assets in  $XYLONIC_SIGN_DIR  (default ~/.xylonic-sign/):
#         cert.p12              Apple signing certificate (PKCS#12)
#         app.mobileprovision  provisioning profile whose device list
#                              includes this iPhone's UDID
#         p12.pass             (optional) the .p12 password, one line, chmod 600
#                              — or set $XYLONIC_P12_PASS, or you'll be prompted
#
# Free Apple ID certs/profiles expire after 7 days — re-export the two files
# (e.g. from an AltStore/Sideloadly install, or `zsign -x` on a signed ipa) and
# re-run. Installing over an existing copy updates in place; app data is kept.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SIGN_DIR="${XYLONIC_SIGN_DIR:-$HOME/.xylonic-sign}"
P12="$SIGN_DIR/cert.p12"
PROV="$SIGN_DIR/app.mobileprovision"
PASS_FILE="$SIGN_DIR/p12.pass"
WORK="${1:-$(mktemp -d -t xylonic-ios-XXXXXX)}"
TUNNELD_URL="${PYMOBILEDEVICE3_TUNNELD_URL:-http://127.0.0.1:49151}"

die() { printf '\033[0;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
info() { printf '\033[0;36m==>\033[0m %s\n' "$*"; }

# ── preflight ────────────────────────────────────────────────────────────────
command -v gh              >/dev/null || die "gh CLI not found"
command -v zsign           >/dev/null || die "zsign not found on PATH (build from https://github.com/zhlynn/zsign)"
command -v pymobiledevice3 >/dev/null || die "pymobiledevice3 not found on PATH"
gh auth status >/dev/null 2>&1        || die "gh not authenticated — run: gh auth login"
[ -f "$P12" ]  || die "missing signing cert: $P12"
[ -f "$PROV" ] || die "missing provisioning profile: $PROV"

DEV_COUNT="$(pymobiledevice3 usbmux list --no-color 2>/dev/null | grep -c '"UniqueDeviceID"' || true)"
[ "${DEV_COUNT:-0}" -ge 1 ] || die "no iPhone visible over USB (pymobiledevice3 usbmux list)"

if ! curl -sf "$TUNNELD_URL" >/dev/null 2>&1; then
  die "RSD tunnel not reachable at $TUNNELD_URL — start it with: sudo pymobiledevice3 remote tunneld"
fi

# password: file → env → prompt
if [ -f "$PASS_FILE" ]; then
  P12_PASS="$(<"$PASS_FILE")"
elif [ -n "${XYLONIC_P12_PASS:-}" ]; then
  P12_PASS="$XYLONIC_P12_PASS"
else
  read -rsp "Password for $P12 (blank if none): " P12_PASS; echo
fi

mkdir -p "$WORK"

# ── 1. download latest unsigned IPA from CI ──────────────────────────────────
info "downloading latest iOS build from GitHub Actions"
bash "$SCRIPT_DIR/download-ios-ipa.sh" "$WORK" >/dev/null
UNSIGNED="$(find "$WORK" -maxdepth 2 -name '*.ipa' ! -name '*signed*' | head -1)"
[ -n "$UNSIGNED" ] || die "download step produced no .ipa"
info "unsigned: $UNSIGNED ($(du -h "$UNSIGNED" | cut -f1))"

# ── 2. sign ─────────────────────────────────────────────────────────────────
SIGNED="$WORK/Xylonic-signed.ipa"
info "signing with zsign"
zsign -z 9 -k "$P12" -p "$P12_PASS" -m "$PROV" -o "$SIGNED" "$UNSIGNED"
[ -f "$SIGNED" ] || die "zsign produced no output"
info "signed: $SIGNED ($(du -h "$SIGNED" | cut -f1))"

# ── 3. install over the tunnel ──────────────────────────────────────────────
info "installing on device"
pymobiledevice3 apps install "$SIGNED"

info "done — Xylonic updated on device (app data preserved)"
[ "${1:-}" ] || info "work dir: $WORK  (delete when done)"
