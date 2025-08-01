# macOS Home Assistant Agent

A TypeScript/Bun single file executable that monitors macOS power and battery status and integrates with Home Assistant via MQTT with automatic device discovery.

## Features

- 🔋 **Battery Monitoring**: Level, charging status, time remaining, cycle count, and condition
- ⚡ **Power Source Detection**: AC power, battery power, and UPS status
- 🏠 **Home Assistant Integration**: Automatic device discovery via MQTT
- 📊 **Real-time Updates**: Configurable update intervals
- 🖥️ **macOS Native**: Uses system commands (`pmset`, `system_profiler`)
- 📦 **Single Executable**: Compiled to a single binary file
- 🔄 **Graceful Shutdown**: Proper cleanup on termination signals

## Prerequisites

- macOS (required for system commands)
- [Bun](https://bun.sh) runtime
- MQTT broker (e.g., Mosquitto, Home Assistant built-in)
- Home Assistant with MQTT integration enabled

## Installation

### Option 1: Quick Install from GitHub Release (Recommended)

Download and install the latest release automatically:

```bash
curl -fsSL https://github.com/joeflateau/hass-agent/releases/latest/download/install.sh | bash
```

This will:

- Download the latest version
- Install to `~/.local/bin/hass-agent`
- Create a LaunchAgent for automatic startup
- Set up configuration directory at `~/.config/hass-agent`

### Option 2: Manual Installation from Release

1. **Download the latest release:**

   - Go to [Releases](https://github.com/joeflateau/hass-agent/releases)
   - Download `hass-agent-vX.X.X-macos.tar.gz`

2. **Extract and install:**
   ```bash
   tar -xzf hass-agent-vX.X.X-macos.tar.gz
   chmod +x hass-agent
   ./install.sh
   ```

### Option 3: Build from Source

1. **Clone and setup:**

   ```bash
   git clone <your-repo-url>
   cd hass-agent
   bun install
   ```

2. **Configure environment:**

   ```bash
   cp .env.example .env
   # Edit .env with your MQTT broker settings
   ```

3. **Build executable:**
   ```bash
   bun run build
   ```

## Configuration

Create a `.env` file with your MQTT broker settings:

```env
# MQTT Broker (required)
MQTT_BROKER=mqtt://homeassistant.local:1883
MQTT_USERNAME=your_username
MQTT_PASSWORD=your_password

# Device Settings (DEVICE_ID is required)
DEVICE_ID=macos-macbook-pro-001
DEVICE_NAME=My MacBook Pro
UPDATE_INTERVAL=30000  # 30 seconds
```

### Environment Variables

| Variable                 | Description                      | Required | Default                        |
| ------------------------ | -------------------------------- | -------- | ------------------------------ |
| `MQTT_BROKER`            | MQTT broker URL                  | No       | `mqtt://localhost:1883`        |
| `MQTT_USERNAME`          | MQTT username                    | No       | -                              |
| `MQTT_PASSWORD`          | MQTT password                    | No       | -                              |
| `DEVICE_ID`              | **Unique device identifier**     | **Yes**  | -                              |
| `DEVICE_NAME`            | Device name in Home Assistant    | No       | System hostname                |
| `UPDATE_INTERVAL`        | Update interval in milliseconds  | No       | `30000`                        |
| `AUTO_UPGRADE`           | Enable automatic upgrades        | No       | `true`                         |
| `UPGRADE_CHECK_INTERVAL` | Auto-upgrade check interval (ms) | No       | `10800000` (3 hours)           |
| `INSTALL_SCRIPT_URL`     | URL to install script            | No       | GitHub releases install script |

> **Important**: `DEVICE_ID` must be unique across all your Home Assistant MQTT devices. Use a format like `macos-hostname-001` or similar.

## Auto-Upgrade

The agent includes built-in auto-upgrade functionality:

- **Automatic Checks**: Periodically checks for new releases (default: every 3 hours)
- **Smart Upgrades**: Uses a dedicated upgrade script that compares versions
- **Zero-Downtime Updates**: Handles service stopping and restarting automatically
- **Configurable**: Can be disabled or customized via environment variables

### Auto-Upgrade Configuration

```env
# Enable auto-upgrade (default: true)
AUTO_UPGRADE=true

# Check for updates every 12 hours instead of default 3 hours
UPGRADE_CHECK_INTERVAL=43200000

# Use a custom install script URL (advanced)
INSTALL_SCRIPT_URL=https://github.com/joeflateau/hass-agent/releases/latest/download/install.sh
```

### Manual Upgrade

You can also manually upgrade by running the install script:

```bash
curl -fsSL https://github.com/joeflateau/hass-agent/releases/latest/download/install.sh | bash
```

### Disabling Auto-Upgrade

To disable automatic upgrades:

```env
AUTO_UPGRADE=false
```

Or remove the environment variable entirely (defaults to enabled).

## Usage

### Development

```bash
bun run dev
```

### Production (after building)

```bash
./hass-agent
```

### Run as Service (macOS LaunchAgent)

Create `~/Library/LaunchAgents/com.homeassistant.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.homeassistant.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>/path/to/your/hass-agent</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/hass-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/hass-agent.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>MQTT_BROKER</key>
        <string>mqtt://homeassistant.local:1883</string>
        <!-- Add other environment variables here -->
    </dict>
</dict>
</plist>
```

### Service Management

Once the service is installed, you can manage it with these commands:

```bash
# Stop the service
launchctl unload ~/Library/LaunchAgents/com.homeassistant.agent.plist

# Start the service
launchctl load ~/Library/LaunchAgents/com.homeassistant.agent.plist

# Restart the service
launchctl unload ~/Library/LaunchAgents/com.homeassistant.agent.plist && launchctl load ~/Library/LaunchAgents/com.homeassistant.agent.plist

# Check service status
launchctl list | grep com.homeassistant.agent
```

## Updating

### Auto-installed version (recommended method)

Simply run the install script again to update to the latest version:

```bash
curl -fsSL https://github.com/joeflateau/hass-agent/releases/latest/download/install.sh | bash
```

### Manual update

1. Stop the current service:

   ```bash
   launchctl unload ~/Library/LaunchAgents/com.homeassistant.agent.plist
   ```

2. Download and install the new version (see Installation section)

3. Start the service:
   ```bash
   launchctl load ~/Library/LaunchAgents/com.homeassistant.agent.plist
   ```

## Home Assistant Integration

The agent automatically registers the following entities in Home Assistant:

### Sensors

- **Battery Level** (`sensor.macos_system_battery_level`)
  - Unit: `%`
  - Device Class: `battery`
- **Battery Time Remaining** (`sensor.macos_system_battery_time_remaining`)
  - Unit: `min`

### Binary Sensors

- **Battery Charging** (`binary_sensor.macos_system_battery_charging`)
  - Device Class: `battery_charging`
- **AC Power** (`binary_sensor.macos_system_ac_power`)
  - Device Class: `plug`

## System Commands Used

The agent uses these macOS system commands:

- `pmset -g batt` - Battery status and power source
- `pmset -g ps` - Power source details
- `system_profiler SPPowerDataType` - Battery health information

## Troubleshooting

### No Battery Detected

Desktop Macs without batteries will only show power source information. This is normal behavior.

### MQTT Connection Issues

1. Verify broker URL and credentials
2. Check network connectivity
3. Ensure MQTT broker is running
4. Check firewall settings

### Permission Issues

The agent needs permission to execute system commands. Run with appropriate user permissions.

### High CPU Usage

Increase the `UPDATE_INTERVAL` to reduce system command frequency.

## Development

### Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/joeflateau/hass-agent.git
   cd hass-agent
   ```

2. **Install dependencies:**

   ```bash
   bun install
   ```

3. **Run in development mode:**
   ```bash
   bun run dev
   ```

### Testing

The project includes comprehensive tests for the core functionality:

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run tests with coverage
bun test --coverage
```

**Test Coverage:**

- ✅ **Battery parsing logic** - Tests parsing of `pmset -g rawlog` output
- ✅ **Environment validation** - Tests configuration validation
- ✅ **Uptime calculation** - Tests system uptime parsing
- ✅ **MQTT discovery configuration** - Tests Home Assistant device configs
- ✅ **Data formatting** - Tests sensor data formatting

### Scripts

- `bun run dev` - Run in development mode
- `bun run build` - Build single file executable
- `bun run start` - Run built executable
- `bun test` - Run test suite
- `bun test --watch` - Run tests in watch mode

### Project Structure

```
hass-agent/
├── index.ts              # Main application code
├── package.json          # Project configuration
├── tsconfig.json         # TypeScript configuration
├── .env.example          # Environment variables template
├── .github/
│   └── copilot-instructions.md
└── README.md
```

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test on macOS
5. Submit a pull request

## Support

For issues and questions:

1. Check the troubleshooting section
2. Review Home Assistant logs
3. Check MQTT broker logs
4. Open an issue with system detailso install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.19. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
