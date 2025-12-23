#!/bin/bash

##
# Deploy and reload Supertag LaunchAgent after changes
#
# Usage:
#   ./scripts/deploy-launchd.sh server  # Reload webhook server
#   ./scripts/deploy-launchd.sh daily   # Reload daily export/sync
##

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Determine which service to deploy
SERVICE="${1:-server}"

case "$SERVICE" in
    server|daily)
        PLIST_NAME="ch.invisible.supertag-${SERVICE}"
        ;;
    *)
        echo "❌ Unknown service: $SERVICE"
        echo "   Usage: $0 [server|daily]"
        exit 1
        ;;
esac

PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

echo "🔄 Deploying supertag-${SERVICE}..."
echo ""

# Check if installed
if [ ! -f "$PLIST_PATH" ]; then
    echo "❌ Service not installed. Run first:"
    echo "   ./scripts/install-launchd.sh $SERVICE"
    exit 1
fi

# Unload
echo "⏹️  Unloading..."
launchctl unload "$PLIST_PATH" 2>/dev/null || true

# Re-run install to update plist
echo "📋 Updating plist..."
"$SCRIPT_DIR/install-launchd.sh" "$SERVICE"

echo ""
echo "✨ Deployment complete!"
