#!/usr/bin/env bash
# ios-debug.sh — bring up live WebView debugging for Xylonic on a USB iPhone,
# with no Mac / no Safari. Wraps: RSD tunnel + `pymobiledevice3 webinspector cdp`
# + a small CDP client (ios-cdp.py).
#
#   bash scripts/ios-debug.sh                 ensure tunnel + CDP server, print status
#   bash scripts/ios-debug.sh eval '<js>'     run one JS expression in the WebView
#   bash scripts/ios-debug.sh listen [secs]   stream console + exceptions (default 120)
#   bash scripts/ios-debug.sh net    [secs]   stream console + network
#   bash scripts/ios-debug.sh verify          canned Xylonic health check
#   bash scripts/ios-debug.sh stop            stop the CDP server (tunnel stays)
#
# One-time on the phone: Settings → Apps → Safari → Advanced → Web Inspector ON
# and Remote Automation ON, then open Xylonic and keep it foregrounded.
#
# Env: XYLONIC_CDP_PORT (default 9222)
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PORT="${XYLONIC_CDP_PORT:-9222}"
CDP_JSON="http://127.0.0.1:${PORT}/json"
CDP_LOG="${XYLONIC_CDP_LOG:-/tmp/xylonic-cdp.log}"
PMD3="$(command -v pymobiledevice3 || true)"

info() { printf '\033[0;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33mwarn:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[0;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ -n "$PMD3" ] || die "pymobiledevice3 not on PATH"

if [ "${1:-}" = "stop" ]; then
  pkill -f "pymobiledevice3 webinspector cdp" && echo "CDP server stopped" || echo "no CDP server running"
  exit 0
fi

# 1. tunnel
bash "$SCRIPT_DIR/ios-tunnel.sh"

# 2. CDP server
if ! curl -sf "$CDP_JSON" >/dev/null 2>&1; then
  info "starting webinspector CDP server on 127.0.0.1:${PORT}"
  nohup "$PMD3" webinspector cdp --host 127.0.0.1 --port "$PORT" >"$CDP_LOG" 2>&1 &
  for _ in $(seq 1 20); do
    curl -sf "$CDP_JSON" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -sf "$CDP_JSON" >/dev/null 2>&1 || die "CDP server did not start — see $CDP_LOG"
fi

# 3. Xylonic WebView target
TARGET="$(curl -s "$CDP_JSON" | grep -o 'capacitor://localhost' | head -1 || true)"
if [ -z "$TARGET" ]; then
  warn "no 'capacitor://localhost' target yet."
  warn "  - is Xylonic open and foregrounded on the phone?"
  warn "  - Settings → Apps → Safari → Advanced → Web Inspector + Remote Automation ON?"
  curl -s "$CDP_JSON" | python3 -m json.tool 2>/dev/null | grep -E '"(title|url)"' || true
fi

CMD="${1:-status}"
case "$CMD" in
  status)
    info "tunnel + CDP up. targets:"
    python3 "$SCRIPT_DIR/ios-cdp.py" targets
    echo
    echo "next: bash scripts/ios-debug.sh {eval '<js>' | listen [s] | net [s] | verify | stop}"
    ;;
  eval)     shift; exec python3 "$SCRIPT_DIR/ios-cdp.py" eval "$1" ;;
  listen)   shift; exec python3 "$SCRIPT_DIR/ios-cdp.py" listen "${1:-120}" ;;
  net)      shift; exec python3 "$SCRIPT_DIR/ios-cdp.py" listen-net "${1:-120}" ;;
  verify)
    info "Xylonic on-device health check — synchronous checks:"
    python3 "$SCRIPT_DIR/ios-cdp.py" eval "$(cat "$SCRIPT_DIR/ios-verify.js")"
    sleep 3
    echo
    info "cache integrity (index ↔ on-disk audio files):"
    python3 "$SCRIPT_DIR/ios-cdp.py" eval 'JSON.stringify(window.__xyv_cache||{status:"?"})'
    echo
    info "watching console for 6s (errors/exceptions only shown below)…"
    timeout 8 python3 "$SCRIPT_DIR/ios-cdp.py" listen 6 | grep -iE 'error|exception|fail|\[net x\]' || echo "  (no errors in window)"
    ;;
  *) die "unknown command: $CMD" ;;
esac
