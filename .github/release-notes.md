**Internal preview.** The installers aren't signed yet, so each system asks once whether to trust them:

- **macOS** (arm64 for Apple Silicon, x64 for Intel): move the app to Applications, then run `xattr -dr com.apple.quarantine "/Applications/CFEngine Policy Builder.app"` once. Without it macOS says the app is damaged.
- **Windows**: SmartScreen shows "Unknown publisher": choose More info › Run anyway.
- **Linux**: the AppImage runs as is (`chmod +x`); the .deb and .rpm install with the system's package tool.

Testing policies needs Docker running; creating projects needs git.
