# Building locally

## macOS local build policy

This repository does not currently have an Apple Developer Program account. CI must not publish macOS `.dmg`/`.app` artifacts as public release downloads because they cannot be Developer ID signed and notarized.

Tauri is configured with the ad-hoc macOS signing identity `-`, which is suitable for local development builds. It is not a substitute for Developer ID signing and notarization for public distribution.

### Prerequisites

1. macOS 12 or newer.
2. Xcode Command Line Tools: `xcode-select --install`.
3. Rust stable: <https://rustup.rs/>.
4. Node.js 24 or newer with npm 11 or newer: <https://nodejs.org/>.

### Build

```sh
npm install
npm run build:mac:local
open "$HOME/.cache/scidekick-desktop-target/release/bundle/macos/Scidekick Desktop.app"
```

The `build:mac:local` script sets `CARGO_TARGET_DIR=$HOME/.cache/scidekick-desktop-target` so codesigning is not blocked by macOS File Provider extended attributes (`com.apple.FinderInfo`) that get auto-attached to files inside iCloud-synced `~/Documents` folders. If you keep this repository outside iCloud Drive, you can unset `CARGO_TARGET_DIR` and use the default `src-tauri/target/`.

If another user receives a zipped local build and macOS quarantine blocks launch, they can remove quarantine after deciding they trust the source:

```sh
xattr -dr com.apple.quarantine "Scidekick Desktop.app"
```

That is a local trust workaround, not a release distribution strategy.

### Future signed macOS release

When an Apple Developer Program account exists, add these secrets and switch the release workflow to upload notarized macOS artifacts:

- `APPLE_ID`
- `APPLE_PASSWORD` or App Store Connect API credentials
- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `KEYCHAIN_PASSWORD`

Then remove the no-upload macOS release guard and use Tauri's documented Developer ID signing/notarization flow.

## Linux local build

### Ubuntu/Debian prerequisites

```sh
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf build-essential curl wget file libssl-dev
```

### Build

```sh
npm install
npm run build:linux
```

Expected artifacts are under `$HOME/.cache/scidekick-desktop-target/release/bundle/` (Linux build script sets the same target dir for parity).

## Windows

Windows packaging is intentionally deferred. Keep APIs and types platform-neutral, but do not add Windows release gates until macOS and Linux are reliable.
