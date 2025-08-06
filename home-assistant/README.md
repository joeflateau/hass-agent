# Home Assistant Integration

This directory contains Home Assistant components and configurations for the hass-agent macOS system monitor.

## Directory Structure

```
home-assistant/
├── README.md                       # This file
├── sample-lovelace-config.yaml     # Example dashboard configurations
└── custom-cards/                   # Custom Lovelace cards
    ├── README.md                   # Custom card documentation
    └── lol-status-card.js          # League of Legends status card
```

## Quick Start

1. **Agent Setup**: Make sure the hass-agent is running on your macOS system and publishing to your MQTT broker
2. **Custom Cards**: Copy cards from `custom-cards/` to your Home Assistant `config/www/` directory
3. **Configuration**: Use examples from `sample-lovelace-config.yaml` to set up your dashboard

## Available Components

### Custom Cards

- **LoL Status Card** (`custom-cards/lol-status-card.js`) - Real-time League of Legends game monitoring

### Sensors Provided by hass-agent

The agent publishes the following sensors to Home Assistant via MQTT discovery:

#### Battery Sensors

- `sensor.{device_id}_battery_level` - Battery percentage
- `binary_sensor.{device_id}_battery_charging` - Charging status
- `binary_sensor.{device_id}_ac_power` - AC power connection
- `sensor.{device_id}_time_remaining_to_empty` - Time until battery empty
- `sensor.{device_id}_time_remaining_to_full` - Time until battery full

#### System Sensors

- `sensor.{device_id}_uptime` - System uptime in minutes
- `sensor.{device_id}_display_status` - Display status summary
- `sensor.{device_id}_external_display_count` - Number of external displays
- `binary_sensor.{device_id}_builtin_display_online` - Built-in display status
- `sensor.{device_id}_display_info` - Detailed display information

#### League of Legends Sensors

- `binary_sensor.{device_id}_lol_in_game` - Currently in a LoL game
- `sensor.{device_id}_lol_game_mode` - Current game mode
- `sensor.{device_id}_lol_game_time` - Game time in seconds
- `sensor.{device_id}_lol_champion` - Current champion name
- `sensor.{device_id}_lol_level` - Champion level
- `sensor.{device_id}_lol_gold` - Current gold amount
- `sensor.{device_id}_lol_kills` - Kill count
- `sensor.{device_id}_lol_deaths` - Death count
- `sensor.{device_id}_lol_assists` - Assist count
- `sensor.{device_id}_lol_game_info` - Combined LoL data (used by custom card)

## Installation

1. **Install hass-agent**: Build and run the agent on your macOS system
2. **Configure MQTT**: Ensure your Home Assistant MQTT integration is set up
3. **Add Custom Cards**: Copy any desired custom cards to your `config/www/` directory
4. **Configure Lovelace**: Add resource references and card configurations

## Automation Ideas

- Get notified when your Mac's battery is low
- Track gaming sessions and time played
- Monitor system health and uptime
- Alert when external displays are connected/disconnected
- Create gaming mode automations based on LoL game status

## Support

For issues with:

- **Agent functionality**: Check the main project README and logs
- **Custom cards**: See individual card documentation in `custom-cards/`
- **Home Assistant integration**: Verify MQTT broker connection and entity states
