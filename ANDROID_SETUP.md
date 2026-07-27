# Android Development Setup

This guide covers everything needed to build Xylonic as an Android APK from scratch on a fresh machine.

**App package ID:** `xylonic.beangreen247xyz.musicplayer`

---

## Requirements

| Tool | Minimum version | Purpose |
|---|---|---|
| JDK | 17 | Gradle build system |
| Android Studio | 2023.x or newer | SDK manager, emulator, IDE |
| Android SDK | API 22 (Android 5.1) | Minimum device target |
| Android Build Tools | 34.x | APK compilation |
| Node.js | 20+ | React build + Capacitor CLI |

---

## Step 1 — Install JDK 17

### Ubuntu / Debian
```bash
sudo apt update
sudo apt install openjdk-17-jdk
```

### Fedora / RHEL
```bash
sudo dnf install java-17-openjdk-devel
```

### Windows
Download and install from https://adoptium.net (Temurin 17 LTS).

### macOS
```bash
brew install openjdk@17
```

Verify:
```bash
java -version
# should print: openjdk version "17.x.x" ...
```

---

## Step 2 — Install Android Studio

Download from: **https://developer.android.com/studio**

### Linux (tar.gz)
```bash
tar -xzf android-studio-*.tar.gz -C ~/
~/android-studio/bin/studio.sh
```

### Linux (snap)
```bash
sudo snap install android-studio --classic
android-studio
```

### Windows
Run the downloaded `.exe` installer and follow the wizard.

### macOS
Open the downloaded `.dmg`, drag Android Studio to Applications.

---

## Step 3 — First-run SDK setup (Android Studio wizard)

When Android Studio opens for the first time it runs a setup wizard:

1. Click **Next** on the welcome screen
2. Choose **Standard** install type
3. Click **Next** through the remaining screens
4. Click **Finish** — Android Studio downloads:
   - Android SDK
   - Android SDK Platform (API 34)
   - Android Emulator
   - Android SDK Build-Tools

This takes a few minutes depending on your connection. Wait for the progress bar to complete before closing.

---

## Step 4 — Set ANDROID_HOME environment variable

Android Studio installs the SDK to a default location. You need to point the `ANDROID_HOME` variable at it so Gradle and Capacitor can find it.

### Linux / macOS

Add to `~/.bashrc` or `~/.zshrc`:

```bash
export ANDROID_HOME=$HOME/Android/Sdk          # Linux default
# export ANDROID_HOME=$HOME/Library/Android/sdk  # macOS default

export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin
export PATH=$PATH:$ANDROID_HOME/build-tools/34.0.0
```

Apply immediately:
```bash
source ~/.bashrc
```

### Windows

Open **System Properties → Environment Variables** and add:

| Variable | Value (typical) |
|---|---|
| `ANDROID_HOME` | `C:\Users\YourName\AppData\Local\Android\Sdk` |

Then add to **Path**:
```
%ANDROID_HOME%\platform-tools
%ANDROID_HOME%\cmdline-tools\latest\bin
%ANDROID_HOME%\build-tools\34.0.0
```

### Verify
```bash
echo $ANDROID_HOME
# /home/yourname/Android/Sdk

adb version
# Android Debug Bridge version 1.0.41 ...
```

---

## Step 5 — Install additional SDK components (if needed)

Open Android Studio → **SDK Manager** (wrench icon or Tools menu):

Under **SDK Platforms** tab, make sure these are checked:
- Android 14 (API 34) — for building
- Android 5.1 (API 22) — minimum target (optional, for testing)

Under **SDK Tools** tab, make sure these are checked:
- Android SDK Build-Tools 34
- Android SDK Platform-Tools
- Android Emulator (if you want to test without a physical device)

Click **Apply** and let it download.

---

## Step 6 — Create an emulator (optional, for testing without a phone)

In Android Studio → **Device Manager** (phone icon in the right toolbar):

1. Click **Create Virtual Device**
2. Choose a device (e.g. Pixel 7)
3. Choose a system image — download **API 34 (Android 14)** if not already present
4. Click **Finish**

Start it with the play button ▶ next to the device name.

---

## Step 7 — Enable USB debugging on a physical device

If you prefer a real phone over an emulator:

1. On the phone: **Settings → About phone**
2. Tap **Build number** 7 times until "Developer mode enabled" appears
3. Go to **Settings → Developer options**
4. Enable **USB debugging**
5. Connect the phone via USB
6. Accept the "Allow USB debugging?" prompt on the phone

Verify the device is visible:
```bash
adb devices
# List of devices attached
# XXXXXXXXXX    device
```

---

## Building Xylonic for Android

Once the environment is ready, from the Xylonic project root:

### Debug APK (sideload / testing)
```bash
npm run android:sync           # build React + push to android/
cd android
./gradlew assembleDebug        # Linux / macOS
gradlew.bat assembleDebug      # Windows
cd ..
```

Output: `android/app/build/outputs/apk/debug/app-debug.apk`

### Release APK (distribution)

See the **Signing a Release APK** section in `README.md`.

### Via Android Studio (any platform)
```bash
npm run android:sync
npm run android:open
```

In Android Studio:
- **Debug run on device:** click **Run ▶**
- **Build APK:** Build → Build Bundle(s) / APK(s) → Build APK(s)
- **Signed release APK:** Build → Generate Signed Bundle / APK → APK

---

## Installing the APK on a device

### Via ADB
```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

### Manual sideload
1. Copy the `.apk` to the phone (USB, Google Drive, etc.)
2. On the phone: **Settings → Apps → Special app access → Install unknown apps**
3. Enable it for your file manager
4. Tap the `.apk` to install

---

## Troubleshooting

**Gradle sync fails with "SDK not found"**
- Check that `ANDROID_HOME` is set and points to the correct path
- Open Android Studio → SDK Manager and confirm the SDK is installed

**`./gradlew` permission denied**
```bash
chmod +x android/gradlew
```

**Build fails with "Minimum supported Gradle version is X"**
- Open Android Studio and let it update the Gradle plugin when prompted

**`adb devices` shows "unauthorized"**
- Unplug and replug the USB cable
- Accept the "Allow USB debugging?" dialog on the phone again

**App installs but shows blank screen**
- Run `npm run android:sync` again — the web assets may be stale
- Check the Android Studio Logcat tab for errors

**"INSTALL_FAILED_UPDATE_INCOMPATIBLE" when reinstalling**
- Uninstall the previous version first: `adb uninstall xylonic.beangreen247xyz.musicplayer`

---

## Quick reference

| Command | What it does |
|---|---|
| `npm run android:sync` | Build React + copy assets into `android/` |
| `npm run android:open` | Open `android/` in Android Studio |
| `npm run android:run` | Sync + deploy to connected device/emulator |
| `npm run android:build:debug` | Sync + Gradle debug APK (Linux/macOS) |
| `npm run android:build:release` | Sync + Gradle release APK (Linux/macOS) |
| `adb devices` | List connected devices |
| `adb install app.apk` | Install APK on connected device |
| `adb uninstall xylonic.beangreen247xyz.musicplayer` | Uninstall from device |
