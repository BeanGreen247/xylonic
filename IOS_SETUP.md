# Xylonic — iOS Build Guide

← [Back to README](README.md)

This guide covers everything needed to build and install Xylonic on an iPhone or iPad.

---

## Quick Summary

| Step | Where | Time |
|---|---|---|
| Install `@capacitor/ios` | Linux (already done) | ~1 min |
| First scaffold (`npx cap add ios`) | macOS or GitHub Actions | ~5 min |
| Subsequent builds | GitHub Actions (automatic) | ~10 min |
| Install on device | AltStore (free) | ~2 min |

---

## Prerequisites

### What you need

**A free Apple ID** — you almost certainly have one. This gets you personal sideloading with no cost.

**Xcode 16+** — only runs on macOS. Free from the Mac App Store. Required to compile iOS apps. Since you're on Linux, GitHub Actions provides this for free (see [Building with GitHub Actions](#building-with-github-actions)).

**CocoaPods** — Ruby gem required by Capacitor iOS. Pre-installed on GitHub Actions macOS runners.

**Apple Developer Program ($99/year)** — only needed if you want to distribute on the App Store or use TestFlight to share with others. Not required for personal use or AltStore sideloading.

---

## Installing on Your iPhone — AltStore (Recommended, Free)

[AltStore](https://altstore.io) is the cleanest free sideloading method. It re-signs your `.ipa` automatically every 7 days over WiFi, so you don't have to manually re-install.

### Setup (one-time)

1. **Install AltServer** on your computer:
   - **Linux:** [AltServer-Linux](https://github.com/NyaMisty/AltServer-Linux) (community port, works well)
   - **Windows/Mac:** [altstore.io](https://altstore.io) → Download AltServer

2. **Install AltStore on your iPhone:**
   - Connect iPhone to computer via USB
   - Open AltServer → "Install AltStore" → select your iPhone
   - On iPhone: Settings → General → VPN & Device Management → trust your Apple ID

3. **Install Xylonic:**
   - Download the `.ipa` file from [GitHub Actions artifacts](https://github.com/BeanGreen247/xylonic/actions) (see [Building with GitHub Actions](#building-with-github-actions))
   - Open AltStore on iPhone → `+` button → select the `.ipa`
   - Done — Xylonic appears on your home screen

### Auto-refresh (keep the app alive beyond 7 days)

AltStore can auto-refresh apps when your iPhone and computer are on the same WiFi:
- AltStore → Settings → enable "Background Refresh"
- AltServer must be running on your computer (or set it to start at login)

---

## Building with GitHub Actions

Since building iOS requires macOS, the easiest path from Linux is to let GitHub Actions do it for free.

### How it works

1. Push to `main` → GitHub spins up a macOS runner
2. Runner builds the React bundle, installs Capacitor, compiles the Xcode project
3. Artifact (`.xcarchive` / `.ipa`) appears under the workflow run in the Actions tab
4. Download and install via AltStore

### First-time setup

The `ios/` directory (the Xcode project) is created automatically on the first CI run if it doesn't exist. After the first successful run:

1. Go to **Actions → iOS Build** on GitHub
2. Download the `ios-project` artifact
3. Extract and commit the `ios/` folder to the repo:
   ```bash
   # The CI uploads ios/ as an artifact on first run
   # Unzip it into your repo root then commit
   git add ios/
   git commit -m "feat: add Capacitor iOS project scaffold"
   git push
   ```

After that, subsequent CI runs skip the scaffold step and just sync + build.

### Triggering a build

- **Automatic:** every push to `main` triggers an iOS build
- **Manual:** go to Actions → iOS Build → "Run workflow" button

### Downloading the `.ipa`

1. Go to your repo on GitHub → **Actions** tab
2. Click the latest **iOS Build** run
3. Scroll to **Artifacts** at the bottom → download `Xylonic-iOS`
4. Unzip → you get either `Xylonic.ipa` (if signed) or `Xylonic.xcarchive`

> **Unsigned build note:** The free CI build is unsigned. To install via AltStore, AltStore re-signs it with your Apple ID automatically. Just hand the `.ipa` to AltStore.

---

## Building Locally (requires macOS)

If you get access to a Mac:

```bash
# Prerequisites (run once on the Mac)
xcode-select --install
sudo gem install cocoapods

# Clone the repo and install deps
git clone https://github.com/BeanGreen247/xylonic.git
cd xylonic
npm install

# Scaffold iOS project (run once if ios/ doesn't exist)
npm run ios:setup

# Open in Xcode for signing + first run
npm run ios:open

# Or build from command line
npm run ios:build          # simulator build (no signing needed)
npm run ios:build:release  # device build (requires signing in Xcode first)
```

### Manual `xcodebuild` commands

```bash
# Build for iOS Simulator (no signing, instant)
xcodebuild -workspace ios/App/App.xcworkspace \
  -scheme App \
  -sdk iphonesimulator \
  -configuration Debug \
  build \
  CODE_SIGNING_ALLOWED=NO

# Archive for real device
xcodebuild archive \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -sdk iphoneos \
  -configuration Release \
  -archivePath ./Xylonic.xcarchive

# Export .ipa from archive
xcodebuild -exportArchive \
  -archivePath ./Xylonic.xcarchive \
  -exportPath ./Xylonic-ipa \
  -exportOptionsPlist ios/ExportOptions.plist
```

---

## Native Plugin Status

The web layer (React/TypeScript) works on iOS out of the box. Native functionality requires Swift plugins equivalent to the Android Java ones:

| Feature | Android Plugin | iOS Status |
|---|---|---|
| Lock-screen controls (play/pause, skip) | `MediaControlPlugin.java` | 🔲 Planned — `MPNowPlayingInfoCenter` |
| Background audio | `MusicService.java` | 🔲 Planned — `AVAudioSession` + Info.plist |
| Background downloads | `NativeDownloaderPlugin.java` | 🔲 Planned — `URLSession` background tasks |
| Download notification | `DownloadNotificationPlugin.java` | 🔲 Planned — `UNUserNotificationCenter` |
| LAN remote discovery | `RemoteDiscoveryPlugin.java` | 🔲 Planned — `Network.framework` |

> Until native plugins are ported, the app runs as a full-featured web app inside WKWebView. Playback, library browsing, downloading, themes, search, and most UI features work immediately. Background audio and lock-screen controls require the native plugins.

---

## Distribution Options

| Method | Cost | Who can install | Re-sign needed |
|---|---|---|---|
| **AltStore** (sideload) | Free | You + people you share `.ipa` with | Every 7 days (auto) |
| **Sideloadly** | Free | Same as AltStore | Every 7 days (manual) |
| **TestFlight** | $99/yr Apple Dev | Up to 10,000 testers | Never |
| **App Store** | $99/yr Apple Dev | Everyone | Never |

---

## Capacitor Config (iOS section)

The `capacitor.config.ts` already includes the iOS section:

```typescript
ios: {
    scheme: 'Xylonic',
    contentInset: 'always',
},
```

The `Info.plist` background modes (`audio`, `fetch`) are set during the Xcode project setup to enable background audio and background downloads.

---

## npm Scripts Reference

```bash
npm run ios:setup         # scaffold ios/ if missing + sync web assets
npm run ios:sync          # build React + cap sync ios (use after code changes)
npm run ios:open          # open ios/App/App.xcworkspace in Xcode
npm run ios:build         # sync + build for simulator (no signing needed)
npm run ios:build:release # sync + archive for real device
```
