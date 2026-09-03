# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Home Assistant **Automatic Upgrades** configuration switch that shows the
  effective per-device setting and safely persists ON/OFF changes.
- Home Assistant **Upgrade Check Interval** configuration number that controls
  each device's schedule from 15 minutes through 168 hours and applies changes
  without restarting the agent.
- Home Assistant MQTT button for Lock Screen using macOS's native
  `login.framework`, without AppleScript or Accessibility permission.
- Home Assistant MQTT button for Sleep Display, backed by a device-scoped
  allowlisted command handler.
- Last Command diagnostic sensor with success/error details.

### Changed

- Replaced the Bun runtime with a pinned Node.js 26.7.0 Single Executable
  Application while preserving the native `SACLockScreenImmediate` lock call
  through Node's built-in FFI.
- Migrated development and tests from Bun to npm and Vitest.
- Lock Screen now terminates every verified same-user League of Legends game
  process before attempting the macOS lock, without requiring the game to be
  frontmost, waiting for Finder to fail, or depending on Game Client API
  telemetry. Riot Client and League Client UX remain untouched.

### Deprecated

### Removed

- Start Screen Saver Home Assistant command.

### Fixed

- Activate Finder and confirm that the owning application relinquishes an
  exclusive macOS display capture before invoking Lock Screen, preventing
  fullscreen games from blocking the login window while the native lock API
  reports success.
- When League of Legends retains exclusive display capture after Finder is
  activated, identify one foreground in-game process through its Riot bundle,
  owner UID, executable path, start time, and a fresh Game Client API probe;
  signal only that PID, revalidate it before any `SIGKILL`, verify capture
  release, and then lock while leaving Riot and League client UX running.
- Explicitly ad-hoc sign and verify macOS release executables before
  publishing, preventing `OS_REASON_CODESIGNING` launch failures.
- Load the existing `.env` configuration with Node's native dotenv parser,
  restoring installed agents that previously relied on Bun's implicit loading.

### Security

- Automatic-upgrade control accepts only exact MQTT `ON`/`OFF` payloads and
  atomically stores the managed setting with user-only file permissions.

## [1.0.0] - 2025-01-31

### Added

- Initial release
- Battery monitoring for macOS systems
- Power source detection (AC power, battery, UPS)
- Home Assistant MQTT auto-discovery integration
- Real-time updates with configurable intervals
- Single file executable compilation
- Graceful shutdown handling
- macOS LaunchAgent service support
- Environment variable configuration with Zod validation

### Features

- Monitors battery level, charging status, and time remaining
- Detects power source changes
- Automatic device registration in Home Assistant
- Uses native macOS commands (`pmset`, `system_profiler`)
- Compiled single binary for easy distribution
- Service management for background operation

[unreleased]: https://github.com/joeflateau/hass-agent/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/joeflateau/hass-agent/releases/tag/v1.0.0
