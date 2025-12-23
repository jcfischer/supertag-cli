#!/bin/bash

##
# Uninstall Supertag LaunchAgent
#
# Usage:
#   ./scripts/uninstall-launchd.sh server  # Uninstall webhook server
#   ./scripts/uninstall-launchd.sh daily   # Uninstall daily export/sync
#   ./scripts/uninstall-launchd.sh all     # Uninstall both
##

set -e

uninstall_service() {
    local SERVICE="$1"
    local PLIST_NAME="ch.invisible.supertag-${SERVICE}"
    local PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

    echo "🛑 Uninstalling supertag-${SERVICE}..."

    if [ ! -f "$PLIST_PATH" ]; then
        echo "   ⚠️  Not installed (plist not found)"
        return 0
    fi

    # Stop service
    if launchctl list 2>/dev/null | grep -q "$PLIST_NAME"; then
        echo "   ⏹️  Stopping service..."
        launchctl unload "$PLIST_PATH"
    fi

    # Remove plist
    rm "$PLIST_PATH"
    echo "   ✅ Uninstalled"
}

# Determine which service to uninstall
SERVICE="${1:-all}"

case "$SERVICE" in
    server|daily)
        uninstall_service "$SERVICE"
        ;;
    all)
        uninstall_service "server"
        uninstall_service "daily"
        ;;
    *)
        echo "❌ Unknown service: $SERVICE"
        echo "   Usage: $0 [server|daily|all]"
        exit 1
        ;;
esac

echo ""
echo "✅ Uninstall complete"
echo ""
echo "💡 Log files preserved in ~/.local/state/supertag/logs/"
echo "   To remove: rm -rf ~/.local/state/supertag/logs/"
