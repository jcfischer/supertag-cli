#!/bin/bash

##
# Install Supertag LaunchAgent
#
# Usage:
#   ./scripts/install-launchd.sh          # Interactive menu
#   ./scripts/install-launchd.sh server   # Install webhook server (auto-start)
#   ./scripts/install-launchd.sh daily    # Install daily export/sync (scheduled)
#
# Environment variables:
#   SYNC_HOURS    Comma-separated hours for sync schedule (default: 0,6,12,18)
#                 Example: SYNC_HOURS="6,18" ./install-launchd.sh daily
##

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    BOLD=''
    NC=''
fi

# Show interactive menu if no service specified
show_menu() {
    echo ""
    echo -e "${BOLD}Supertag Background Services${NC}"
    echo ""
    echo "  Available services:"
    echo ""
    echo "    1) Webhook Server - Receives notifications from Tana (runs at login)"
    echo "    2) Scheduled Sync - Automatically syncs your Tana data"
    echo "    3) Both services"
    echo "    4) Cancel"
    echo ""
    read -p "  Choice [4]: " choice </dev/tty
    choice="${choice:-4}"

    case "$choice" in
        1)
            SERVICE="server"
            ;;
        2)
            SERVICE="daily"
            # Ask for schedule
            echo ""
            echo "  When should the sync run?"
            echo ""
            echo "    1) Every 6 hours (midnight, 6 AM, noon, 6 PM) (Recommended)"
            echo "    2) Every 4 hours"
            echo "    3) Twice daily (6 AM and 6 PM)"
            echo "    4) Once daily (6 AM)"
            echo "    5) Custom times"
            echo ""
            read -p "      Choice [1]: " schedule_choice </dev/tty
            schedule_choice="${schedule_choice:-1}"

            case "$schedule_choice" in
                1) SYNC_HOURS="0,6,12,18" ;;
                2) SYNC_HOURS="0,4,8,12,16,20" ;;
                3) SYNC_HOURS="6,18" ;;
                4) SYNC_HOURS="6" ;;
                5)
                    echo ""
                    echo "  Enter hours (0-23) separated by commas."
                    echo "  Example: 6,12,18 for 6 AM, noon, and 6 PM"
                    echo ""
                    read -p "      Hours: " custom_hours </dev/tty
                    SYNC_HOURS="${custom_hours:-6}"
                    ;;
                *)
                    SYNC_HOURS="0,6,12,18"
                    ;;
            esac
            ;;
        3)
            # Install both - server first, then daily with schedule prompt
            "$0" server
            echo ""
            echo "  Now configuring scheduled sync..."
            "$0" daily
            exit 0
            ;;
        *)
            echo ""
            echo "  Cancelled."
            exit 0
            ;;
    esac
}

# Generate StartCalendarInterval XML from SYNC_HOURS
generate_schedule_xml() {
    local hours="$1"
    local xml="<array>"

    IFS=',' read -ra HOUR_ARRAY <<< "$hours"
    for hour in "${HOUR_ARRAY[@]}"; do
        # Trim whitespace and validate
        hour=$(echo "$hour" | tr -d ' ')
        if [[ "$hour" =~ ^[0-9]+$ ]] && [[ "$hour" -ge 0 ]] && [[ "$hour" -le 23 ]]; then
            xml+="
        <dict>
            <key>Hour</key>
            <integer>$hour</integer>
            <key>Minute</key>
            <integer>0</integer>
        </dict>"
        fi
    done

    xml+="
    </array>"
    echo "$xml"
}

# Determine which service to install
SERVICE="${1:-}"

# Show menu if no service specified
if [[ -z "$SERVICE" ]]; then
    show_menu
fi

case "$SERVICE" in
    server)
        PLIST_NAME="ch.invisible.supertag-server"
        DESCRIPTION="Supertag Webhook Server"
        ;;
    daily)
        PLIST_NAME="ch.invisible.supertag-daily"
        DESCRIPTION="Supertag Daily Export/Sync"
        # Default schedule if not set
        SYNC_HOURS="${SYNC_HOURS:-0,6,12,18}"
        ;;
    *)
        echo -e "${RED}❌ Unknown service: $SERVICE${NC}"
        echo "   Usage: $0 [server|daily]"
        exit 1
        ;;
esac

PLIST_SOURCE="$PROJECT_DIR/launchd/${PLIST_NAME}.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"
LOG_DIR="$HOME/.local/state/supertag/logs"

echo ""
echo -e "${GREEN}🚀 Installing $DESCRIPTION as launchd service${NC}"
echo ""

# Check if plist file exists
if [ ! -f "$PLIST_SOURCE" ]; then
    echo -e "${RED}❌ Error: ${PLIST_NAME}.plist not found in launchd/${NC}"
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

if [[ "$SERVICE" == "daily" ]]; then
    # Generate custom schedule and inject into plist
    SCHEDULE_XML=$(generate_schedule_xml "$SYNC_HOURS")

    # Read template, replace paths and schedule
    sed -e "s|/Users/YOUR_USERNAME|$HOME|g" \
        -e "s|/usr/local/bin/supertag-cli|$PROJECT_DIR|g" \
        -e "s|/usr/local/bin/supertag|$PROJECT_DIR/supertag|g" \
        "$PLIST_SOURCE" | \
    python3 -c "
import sys
import re

content = sys.stdin.read()
schedule_xml = '''$SCHEDULE_XML'''

# Replace the existing StartCalendarInterval array
pattern = r'<key>StartCalendarInterval</key>\s*<array>.*?</array>'
replacement = '<key>StartCalendarInterval</key>\n    ' + schedule_xml
result = re.sub(pattern, replacement, content, flags=re.DOTALL)
print(result)
" > "$PLIST_DEST"
else
    # Server - just replace paths
    sed -e "s|/Users/YOUR_USERNAME|$HOME|g" \
        -e "s|/usr/local/bin/supertag-cli|$PROJECT_DIR|g" \
        -e "s|/usr/local/bin/supertag|$PROJECT_DIR/supertag|g" \
        "$PLIST_SOURCE" > "$PLIST_DEST"
fi

# Validate plist
if ! plutil -lint "$PLIST_DEST" > /dev/null 2>&1; then
    echo -e "${RED}❌ Invalid plist syntax${NC}"
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
    echo -e "${GREEN}✅ $DESCRIPTION installed successfully!${NC}"
    echo ""
    echo "📊 Service Status:"
    launchctl list | grep "$PLIST_NAME" || echo "   Listed"
    echo ""

    if [ "$SERVICE" = "server" ]; then
        echo "🔗 Server Address: http://localhost:3100"
        echo ""
        echo "🧪 Test: curl http://localhost:3100/health"
    else
        # Show the configured schedule
        echo "📅 Schedule: Sync at hours: $SYNC_HOURS"
    fi

    echo ""
    echo "📝 Logs:"
    echo "   $LOG_DIR/supertag-${SERVICE}.log"
    echo "   $LOG_DIR/supertag-${SERVICE}.error.log"
    echo ""
    echo "🛠️  Commands:"
    echo "   Status:    launchctl list | grep supertag"
    echo "   Logs:      tail -f $LOG_DIR/supertag-${SERVICE}.log"
    echo "   Uninstall: $SCRIPT_DIR/uninstall-launchd.sh $SERVICE"
else
    echo ""
    echo -e "${YELLOW}⚠️  Service installed but may not be running. Check logs:${NC}"
    echo "   tail $LOG_DIR/supertag-${SERVICE}.error.log"
    exit 1
fi
