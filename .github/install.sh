#!/bin/bash

# macOS Home Assistant Agent - Remote Installation Script
# Downloads and installs the latest release from GitHub

set -e

REPO="__GITHUB_REPOSITORY__"  # Will be replaced during release
INSTALL_DIR="$HOME/.local/bin"
SERVICE_NAME="com.homeassistant.agent"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_DIR/$SERVICE_NAME.plist"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🏠 macOS Home Assistant Agent Installer${NC}"
echo ""

# Function to print colored output
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    log_error "This agent only supports macOS"
    exit 1
fi

# Check for required tools
if ! command -v curl &> /dev/null; then
    log_error "curl is required but not installed"
    exit 1
fi

if ! command -v tar &> /dev/null; then
    log_error "tar is required but not installed"
    exit 1
fi

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
    x86_64)
        ARCH_SUFFIX="-x64"
        ARCH_NAME="Intel (x64)"
        ;;
    arm64)
        ARCH_SUFFIX="-arm64"
        ARCH_NAME="Apple Silicon (ARM64)"
        ;;
    *)
        log_info "Unknown architecture: $ARCH, using universal binary"
        ARCH_SUFFIX=""
        ARCH_NAME="Universal"
        ;;
esac

log_info "Detected architecture: $ARCH_NAME"

# Get latest release info
log_info "Fetching latest release information..."
LATEST_RELEASE=$(curl -s "https://api.github.com/repos/$REPO/releases/latest")

if [[ $? -ne 0 ]]; then
    log_error "Failed to fetch release information"
    exit 1
fi

# Extract version and download URL
VERSION=$(echo "$LATEST_RELEASE" | grep '"tag_name"' | sed -E 's/.*"tag_name": "([^"]+)".*/\1/')

# Try architecture-specific download first, fall back to universal
DOWNLOAD_URL=""
if [[ -n "$ARCH_SUFFIX" ]]; then
    DOWNLOAD_URL=$(echo "$LATEST_RELEASE" | grep "browser_download_url.*macos${ARCH_SUFFIX}.tar.gz" | sed -E 's/.*"browser_download_url": "([^"]+)".*/\1/')
fi

# Fall back to universal binary if architecture-specific not found
if [[ -z "$DOWNLOAD_URL" ]]; then
    DOWNLOAD_URL=$(echo "$LATEST_RELEASE" | grep "browser_download_url.*macos.tar.gz" | grep -v "macos-arm64\|macos-x64" | sed -E 's/.*"browser_download_url": "([^"]+)".*/\1/')
    ARCH_NAME="Universal"
fi

if [[ -z "$VERSION" || -z "$DOWNLOAD_URL" ]]; then
    log_error "Could not parse release information"
    exit 1
fi

log_info "Latest version: $VERSION ($ARCH_NAME)"

# Create install directory
mkdir -p "$INSTALL_DIR"

# Stop existing service if running
if launchctl list 2>/dev/null | grep -q "$SERVICE_NAME"; then
    log_info "Stopping existing service..."
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# Download and extract
log_info "Downloading $VERSION..."
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

curl -L -o "hass-agent.tar.gz" "$DOWNLOAD_URL"

if [[ $? -ne 0 ]]; then
    log_error "Failed to download release"
    rm -rf "$TEMP_DIR"
    exit 1
fi

log_info "Extracting archive..."
tar -xzf "hass-agent.tar.gz"

# Install executable
log_info "Installing executable to $INSTALL_DIR..."
cp hass-agent "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/hass-agent"

# Create config directory
CONFIG_DIR="$HOME/.config/hass-agent"
mkdir -p "$CONFIG_DIR"

# Copy example config if it doesn't exist
if [[ ! -f "$CONFIG_DIR/.env" && -f ".env.example" ]]; then
    log_info "Creating default configuration..."
    cp .env.example "$CONFIG_DIR/.env"
    log_warning "Please edit $CONFIG_DIR/.env with your MQTT settings"
fi

# Create LaunchAgent plist
log_info "Creating launch agent..."
mkdir -p "$LAUNCH_AGENTS_DIR"

cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$SERVICE_NAME</string>
    <key>ProgramArguments</key>
    <array>
        <string>$INSTALL_DIR/hass-agent</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/hass-agent.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/hass-agent.error.log</string>
    <key>WorkingDirectory</key>
    <string>$CONFIG_DIR</string>
</dict>
</plist>
EOF

# Load the service
log_info "Starting service..."
launchctl load "$PLIST_PATH"

# Cleanup
rm -rf "$TEMP_DIR"

log_success "Installation complete!"
echo ""
log_info "Configuration:"
echo "   📁 Config directory: $CONFIG_DIR"
echo "   ⚙️  Edit settings: $CONFIG_DIR/.env"
echo "   📋 Service plist: $PLIST_PATH"
echo ""
log_info "Logs:"
echo "   📄 Output: /tmp/hass-agent.log"
echo "   🐛 Errors: /tmp/hass-agent.error.log"
echo ""
log_info "Service management:"
echo "   🛑 Stop:    launchctl unload '$PLIST_PATH'"
echo "   ▶️  Start:   launchctl load '$PLIST_PATH'"
echo "   🔄 Restart: launchctl unload '$PLIST_PATH' && launchctl load '$PLIST_PATH'"
echo "   📊 Status:  launchctl list | grep $SERVICE_NAME"
echo ""

# Check if service is running
sleep 2
if launchctl list 2>/dev/null | grep -q "$SERVICE_NAME"; then
    log_success "Service is running!"
else
    log_warning "Service may not have started properly. Check logs for details."
fi

echo ""
log_info "Next steps:"
echo "   1. Edit $CONFIG_DIR/.env with your MQTT broker settings"
echo "   2. Restart the service if you made configuration changes"
echo "   3. Check Home Assistant for new device entities"
