#!/bin/bash

##
# Install Supertag LaunchAgent
#
# Usage:
#   ./scripts/install-launchd.sh server  # Install webhook server (auto-start)
#   ./scripts/install-launchd.sh daily   # Install daily export/sync (scheduled)
##

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Determine which service to install
SERVICE="${1:-server}"

case "$SERVICE" in
    server)
        PLIST_NAME="ch.invisible.supertag-server"
        DESCRIPTION="Supertag Webhook Server"
        ;;
    daily)
        PLIST_NAME="ch.invisible.supertag-daily"
        DESCRIPTION="Supertag Daily Export/Sync"
        ;;
    *)
        echo "❌ Unknown service: $SERVICE"
        echo "   Usage: $0 [server|daily]"
        exit 1
        ;;
esac

PLIST_SOURCE="$PROJECT_DIR/launchd/${PLIST_NAME}.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$HOME/.local/state/supertag/logs"

echo "🚀 Installing $DESCRIPTION as launchd service"
echo ""

# Check if plist file exists
if [ ! -f "$PLIST_SOURCE" ]; then
    echo "❌ Error: ${PLIST_NAME}.plist not found in launchd/"
    exit 1
fi

# Create directories
mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$LOG_DIR"

# Stop service if already running
if launchctl list 2>/dev/null | grep -q "$PLIST_NAME"; then
    echo "⏹️  Stopping existing service..."
    launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

# Copy and customize plist
echo "📋 Installing plist to ~/Library/LaunchAgents/"

# Replace placeholders with actual values
sed -e "s|/Users/YOUR_USERNAME|$HOME|g" \
    -e "s|/usr/local/bin/supertag-cli|$PROJECT_DIR|g" \
    -e "s|/usr/local/bin/supertag|$PROJECT_DIR/supertag|g" \
    "$PLIST_SOURCE" > "$PLIST_DEST"

# Validate plist
if ! plutil -lint "$PLIST_DEST" > /dev/null 2>&1; then
    echo "❌ Invalid plist syntax"
    plutil -lint "$PLIST_DEST"
    exit 1
fi

# Load the service
echo "▶️  Loading service..."
launchctl load "$PLIST_DEST"

# Wait for service to start
sleep 2

# Check if service is running
if launchctl list 2>/dev/null | grep -q "$PLIST_NAME"; then
    echo ""
    echo "✅ $DESCRIPTION installed successfully!"
    echo ""
    echo "📊 Service Status:"
    launchctl list | grep "$PLIST_NAME" || echo "   Listed"
    echo ""

    if [ "$SERVICE" = "server" ]; then
        echo "🔗 Server Address: http://localhost:3100"
        echo ""
        echo "🧪 Test: curl http://localhost:3100/health"
    else
        echo "📅 Schedule: Daily at 6:00 AM"
    fi

    echo ""
    echo "📝 Logs:"
    echo "   $LOG_DIR/supertag-${SERVICE}.log"
    echo "   $LOG_DIR/supertag-${SERVICE}.error.log"
    echo ""
    echo "🛠️  Commands:"
    echo "   Status:    launchctl list | grep supertag"
    echo "   Logs:      tail -f $LOG_DIR/supertag-${SERVICE}.log"
    echo "   Uninstall: ./scripts/uninstall-launchd.sh $SERVICE"
else
    echo ""
    echo "⚠️  Service installed but may not be running. Check logs:"
    echo "   tail $LOG_DIR/supertag-${SERVICE}.error.log"
    exit 1
fi
