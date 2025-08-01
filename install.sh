#!/bin/bash

# macOS Home Assistant Agent Installation Script

set -e

echo "🏠 Installing macOS Home Assistant Agent..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXECUTABLE_PATH="$SCRIPT_DIR/hass-agent"
PLIST_PATH="$SCRIPT_DIR/com.homeassistant.agent.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
INSTALLED_PLIST="$LAUNCH_AGENTS_DIR/com.homeassistant.agent.plist"

# Check if executable exists
if [ ! -f "$EXECUTABLE_PATH" ]; then
    echo "❌ Error: hass-agent executable not found!"
    echo "   Please run 'bun run build' first."
    exit 1
fi

# Make sure executable is executable
chmod +x "$EXECUTABLE_PATH"

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$LAUNCH_AGENTS_DIR"

# Stop service if already running
if launchctl list | grep -q "com.homeassistant.agent"; then
    echo "🛑 Stopping existing service..."
    launchctl unload "$INSTALLED_PLIST" 2>/dev/null || true
fi

# Copy and update plist file
if [ -f "$PLIST_PATH" ]; then
    echo "📋 Installing launch agent..."
    
    # Replace the executable path in the plist
    sed "s|/Users/joeflateau/Projects/hass-agent/hass-agent|$EXECUTABLE_PATH|g" "$PLIST_PATH" > "$INSTALLED_PLIST"
    
    # Load the service
    launchctl load "$INSTALLED_PLIST"
    echo "✅ Service installed and started!"
    echo ""
    echo "📊 Service status:"
    launchctl list | grep "com.homeassistant.agent" || echo "   Service not found in process list (may still be starting...)"
else
    echo "⚠️  LaunchAgent plist not found. Manual installation required."
    echo "   Copy $EXECUTABLE_PATH to your desired location"
    echo "   Run it manually or create your own service configuration"
fi

echo ""
echo "📝 Configuration:"
echo "   - Edit .env file in $SCRIPT_DIR"
echo "   - Configure MQTT_BROKER, MQTT_USERNAME, MQTT_PASSWORD"
echo "   - Restart service: launchctl unload && launchctl load $INSTALLED_PLIST"
echo ""
echo "📋 Logs:"
echo "   - stdout: /tmp/hass-agent.log"
echo "   - stderr: /tmp/hass-agent.error.log"
echo ""
echo "🎉 Installation complete!"
