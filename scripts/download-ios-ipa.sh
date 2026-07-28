#!/usr/bin/env bash
# Download the latest unsigned iOS IPA from GitHub Actions.
# Requires: gh CLI authenticated (run `gh auth login` once if not already done)
# Usage: bash scripts/download-ios-ipa.sh [output-dir]
#
# NOTE: signing and installing requires Sideloadly on Windows or macOS.
# Transfer the downloaded .ipa to your Windows machine, then use Sideloadly there.
# See IOS_SETUP.md for the full install process.

set -euo pipefail

WORKFLOW="ios.yml"
OUTDIR="${1:-./ios-artifact}"

if ! command -v gh &>/dev/null; then
  echo "Error: gh CLI not found."
  echo "Install it with:  sudo apt install gh"
  echo "Or from:          https://cli.github.com"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "Error: gh CLI is not authenticated."
  echo "Run:  gh auth login"
  exit 1
fi

echo "Looking for the latest successful iOS build..."

RUN_ID=$(gh run list \
  --workflow "$WORKFLOW" \
  --status success \
  --limit 1 \
  --json databaseId \
  --jq '.[0].databaseId' 2>/dev/null || echo "")

if [ -z "$RUN_ID" ]; then
  echo ""
  echo "No successful iOS build found."
  echo "Trigger one at: Actions → iOS Build → Run workflow"
  echo "Or push a commit to main — it builds automatically."
  exit 1
fi

echo "Found run: $RUN_ID"

ARTIFACT_NAME=$(gh api \
  "repos/:owner/:repo/actions/runs/$RUN_ID/artifacts" \
  --jq '.artifacts[] | select(.name | startswith("Xylonic-iOS")) | .name' \
  | head -1)

if [ -z "$ARTIFACT_NAME" ]; then
  echo "No iOS IPA artifact found in run $RUN_ID."
  echo "The build may have failed before the upload step."
  exit 1
fi

echo "Artifact: $ARTIFACT_NAME"
echo "Downloading to $OUTDIR/ ..."

mkdir -p "$OUTDIR"
gh run download "$RUN_ID" \
  --name "$ARTIFACT_NAME" \
  --dir "$OUTDIR"

IPA=$(find "$OUTDIR" -name "*.ipa" | head -1)

if [ -z "$IPA" ]; then
  echo "Downloaded artifact but no .ipa file found inside it."
  exit 1
fi

echo ""
echo "IPA ready: $IPA"
echo ""
echo "Next steps:"
echo "  1. Transfer the IPA to your Windows machine"
echo "     (copy to USB drive, shared folder, or just re-download from the browser on Windows)"
echo "  2. Open Sideloadly on Windows"
echo "  3. Plug iPhone in via USB"
echo "  4. Drag the IPA into Sideloadly:"
echo "       $IPA"
echo "  5. Enter your Apple ID and click Start"
echo "  6. On iPhone: Settings → General → VPN & Device Management → trust your Apple ID"
echo ""
echo "Note: Sideloadly is Windows/macOS only — signing cannot be done on Linux."
echo "See IOS_SETUP.md for full instructions and the 7-day refresh process."
