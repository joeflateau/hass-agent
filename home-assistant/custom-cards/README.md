# League of Legends Status Card

A custom Home Assistant Lovelace card that displays real-time League of Legends game status from the hass-agent macOS monitor.

## Features

- 🎮 Shows if you're currently in a game
- 🏆 Displays champion name and level
- 💰 Shows current gold amount
- 📊 KDA (Kills/Deaths/Assists) statistics
- ⏱️ Game time counter
- 🗺️ Map and game mode information
- 🎨 Beautiful, responsive design that matches Home Assistant themes

## Installation

### Method 1: Manual Installation

1. Download the `lol-status-card.js` file
2. Copy it to your Home Assistant `config/www/` folder
3. Add the following to your `configuration.yaml`:

```yaml
lovelace:
  resources:
    - url: /local/lol-status-card.js
      type: module
```

4. Restart Home Assistant
5. Clear your browser cache

### Method 2: HACS (Home Assistant Community Store)

*Note: This card is not yet available in HACS. You can add it as a custom repository.*

1. Go to HACS in Home Assistant
2. Click on "Frontend"
3. Click the three dots in the top right
4. Select "Custom repositories"
5. Add this repository URL and select "Lovelace" as the category
6. Install the card
7. Add the resource to your Lovelace configuration

## Configuration

Add the card to your Lovelace dashboard:

### Basic Configuration

```yaml
type: custom:lol-status-card
entity: sensor.your_device_lol_game_info
```

### Full Configuration

```yaml
type: custom:lol-status-card
entity: sensor.your_device_lol_game_info
title: "My LoL Status"
```

### Configuration Variables

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `entity` | string | **Yes** | - | The entity ID of your LoL game info sensor |
| `title` | string | No | "League of Legends Status" | Custom title for the card |

## Entity Setup

Make sure you have the hass-agent running on your macOS system and that it's publishing LoL data to Home Assistant. The entity should be something like:

- `sensor.your_device_lol_game_info` (main entity with all attributes)
- `binary_sensor.your_device_lol_in_game` (shows if in game)

The card reads data from the `lol_game_info` sensor which contains all the game attributes.

## Card Appearance

### When Not Playing
- Shows offline status with a grey indicator
- Displays a message to start a game

### When In Game
- Green status indicator showing "In Game"
- Champion name and level (if available)
- Current gold amount with coin icon
- KDA statistics in colored boxes (green for kills, red for deaths, blue for assists)
- Game time in MM:SS format
- Game mode and map information

## Styling

The card automatically adapts to your Home Assistant theme and includes:

- Responsive design that works on mobile and desktop
- Color-coded elements (kills=green, deaths=red, assists=blue, gold=yellow)
- Clean, modern appearance with proper spacing
- Icons from Material Design Icons (mdi)

## Troubleshooting

### Card doesn't appear
1. Make sure you've added the resource to your Lovelace configuration
2. Clear your browser cache
3. Check the browser console for JavaScript errors
4. Verify the file is accessible at `/local/lol-status-card.js`

### No data showing
1. Verify your hass-agent is running and connected to Home Assistant
2. Check that the entity ID exists in Developer Tools > States
3. Make sure you're using the correct entity ID in the card configuration
4. Ensure League of Legends client is running (if testing in-game features)

### Entity not found error
1. Double-check the entity ID in your card configuration
2. Look for the entity in Developer Tools > States
3. Make sure the hass-agent device is online and publishing data

## Development

To modify the card:

1. Edit the `lol-status-card.js` file
2. Test your changes by refreshing the Lovelace page
3. Use browser developer tools to debug any issues

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is licensed under the MIT License.
