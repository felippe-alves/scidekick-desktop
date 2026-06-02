# CI and release design

## CI goals

CI verifies that the project remains buildable on the supported first platforms without pretending we can distribute every platform artifact.

- Ubuntu verifies frontend build, TypeScript strictness, Rust checks, and Tauri Linux prerequisites.
- macOS verifies frontend build and Rust/Tauri checks.
- Windows is not in the required matrix yet.

## Release goals

Tag releases publish Linux artifacts and source code. macOS remains a local-build path until a Developer ID certificate and notarization credentials exist.

## Workflows

- `.github/workflows/ci.yml`: pull request and main branch verification.
- `.github/workflows/release.yml`: tag/manual release workflow for Linux artifacts plus a macOS smoke check that intentionally does not upload macOS bundles.

## Auto-update policy

Do not enable Tauri updater yet. Tauri requires signed updater artifacts; enabling updates before release ownership and signing keys are stable would create a key-management liability. Add updater support only after deciding release channels, signing-key custody, and rollback policy.
