# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
### Changed
### Deprecated
### Removed
### Fixed
### Security

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
