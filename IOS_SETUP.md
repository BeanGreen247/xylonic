# Xylonic — iOS Install Guide

← [Back to README](README.md)

Xylonic builds iOS IPAs automatically on every push via GitHub Actions. Since the build runs on a macOS CI runner you never need a Mac locally. This guide covers how to get those builds onto your iPhone.

---

## Quick Summary

| Step | Where | Time |
|---|---|---|
| Build triggers automatically | GitHub Actions (macOS runner) | ~10 min |
| Download IPA | `scripts/download-ios-ipa.sh` or Actions tab | ~1 min |
| Sign + install | Sideloadly on Linux | ~2 min |
| Trust developer cert | iPhone Settings | ~30 sec |
| Re-sign (every 7 days) | Sideloadly, phone plugged in | ~1 min |

---

## Prerequisites

- **Free Apple ID** — no paid developer account needed
- **Sideloadly** (Windows or macOS) — download from [sideloadly.io](https://sideloadly.io). There is no Linux version; signing must be done from a Windows or macOS machine.
- **`gh` CLI** (optional, Linux or Windows) — only needed for the download script; install via `sudo apt install gh` or from [cli.github.com](https://cli.github.com)
- **USB cable** — iPhone must be plugged in to the Windows machine for signing

---

## Downloading the IPA

### Option A — Download script (Linux or Windows/WSL)

```bash
bash scripts/download-ios-ipa.sh
```

This uses the `gh` CLI to find the latest successful iOS build, download the IPA artifact, and print the file path. See [`scripts/download-ios-ipa.sh`](scripts/download-ios-ipa.sh) for what it does.

By default it saves to `./ios-artifact/`. Pass a custom path as the first argument:

```bash
bash scripts/download-ios-ipa.sh ~/Downloads/xylonic-ios
```

Once downloaded on Linux, transfer the `.ipa` to your Windows machine (USB drive, shared folder, or just re-download it in the browser on Windows) before the Sideloadly step.

### Option B — Directly in browser on Windows (simplest)

1. Go to your repo → **Actions** tab
2. Click the latest **iOS Build** run
3. Scroll to **Artifacts** → download `Xylonic-iOS-debug-unsigned-<sha>`
4. Unzip — you get `Xylonic-debug-unsigned.ipa`

---

## Installing on Your iPhone

> **Sideloadly is Windows/macOS only.** Do the signing step from your Windows machine, not Linux.

### First-time setup (one-off)

1. **Install Sideloadly** on Windows:
   - Download the installer from [sideloadly.io](https://sideloadly.io) and run it

2. **Trust your computer on the iPhone:**
   - Plug iPhone in via USB
   - Tap **Trust** on the iPhone prompt

### Installing the IPA

Do this from your **Windows machine**:

1. Get the `.ipa` onto Windows — either download it directly from the Actions tab in your browser, or copy it over from Linux
2. Open Sideloadly
3. Plug iPhone in via USB — it should appear in the device dropdown
4. Drag the `.ipa` into Sideloadly (or click the app icon area to browse)
5. Enter your Apple ID email and click **Start**
6. Sideloadly will prompt for your Apple ID password — it goes directly to Apple, not stored by Sideloadly
7. Wait for "Done" — Xylonic appears on your home screen

8. **Trust the certificate on iPhone:**
   Settings → General → VPN & Device Management → your Apple ID → **Trust**

### Re-signing every 7 days

Free Apple ID certificates expire after 7 days. To refresh from Windows:

1. Plug iPhone in via USB
2. Open Sideloadly — Xylonic should still be listed
3. Click **Start** again with the same IPA
4. Done — no reinstall, data is preserved

> To avoid doing this manually, set up **SideStore** (see [Upgrading to SideStore](#upgrading-to-sidestore) below).

---

## Upgrading to SideStore

SideStore is an on-device app manager that refreshes certificates automatically over Wi-Fi — no cable, no desktop app needed after setup.

**Install SideStore via Sideloadly** (one-time):

1. Download the SideStore IPA from [sidestore.io](https://sidestore.io)
2. Install it the same way as Xylonic above
3. Open SideStore on iPhone and follow the setup (it needs an anisette server URL — the SideStore docs have a public one)

Once SideStore is running, you can install and refresh Xylonic directly from SideStore without touching your Linux machine.

---

## What the CI produces

The iOS workflow (`ios.yml`) runs on every push to `main` and on manual dispatch:

- Scaffolds `ios/` via `npx cap add ios` if not yet committed to the repo
- Syncs the React bundle into the Xcode project (`npx cap sync ios`)
- Archives for real device (`-sdk iphoneos`, arm64)
- Packages into an **unsigned IPA** (the `.app` bundle zipped into `Payload/`)
- Uploads the IPA as a GitHub Actions artifact (retained 14 days)

The IPA is unsigned because Apple does not allow CI runners to hold valid distribution certificates for free accounts. Sideloadly or SideStore handle the signing step locally using your Apple ID.

### Triggering a build manually

Go to **Actions → iOS Build → Run workflow** — choose `debug` (default) or `release`.

### First-time scaffold

On the very first run, `ios/` doesn't exist in the repo yet. The CI scaffolds it and uploads it as an artifact called `ios-project-scaffold`. Download that, unzip it into the repo root, and commit it:

```bash
git add ios/
git commit -m "feat: add Capacitor iOS scaffold"
git push
```

After that, future runs skip the scaffold step.

---

## Native Plugin Status

The web layer (React/TypeScript) runs on iOS immediately. These features need native Swift plugins that are planned but not yet written:

| Feature | Android plugin | iOS status |
|---|---|---|
| Lock-screen controls | `MediaControlPlugin.java` | Planned — `MPNowPlayingInfoCenter` |
| Background audio | `MusicService.java` | Planned — `AVAudioSession` + Info.plist |
| Background downloads | `NativeDownloaderPlugin.java` | Planned — `URLSession` background tasks |
| Download notifications | `DownloadNotificationPlugin.java` | Planned — `UNUserNotificationCenter` |
| LAN remote discovery | `RemoteDiscoveryPlugin.java` | Planned — `Network.framework` |

Until those are ported, Xylonic runs as a full-featured web app inside WKWebView. Playback, library browsing, offline downloads, search, and most UI features work. Background audio and lock-screen controls require the native plugins.

---

## Distribution Options

| Method | Cost | Certificate expires | Notes |
|---|---|---|---|
| **Sideloadly** | Free | 7 days | Manual refresh via USB |
| **SideStore** | Free | 7 days | Auto-refresh over Wi-Fi |
| **TestFlight** | $99/yr | 90 days | Up to 10,000 testers |
| **App Store** | $99/yr | Never | Public distribution |

---

## npm Scripts Reference

```bash
npm run ios:setup          # scaffold ios/ if missing + sync
npm run ios:sync           # build React + cap sync ios
npm run ios:open           # open Xcode project (requires macOS)
npm run ios:build          # sync + build
npm run ios:build:release  # sync + archive (release)
```
