#!/bin/bash
#
# Supertag CLI Release Script
# ===========================
#
# This script automates the release process for Supertag CLI.
# Run from the project directory: ./release.sh
#
# Prerequisites:
# - Bun installed
# - Access to ~/work/web/invisible-store/
#
# What this script does:
# 1. Updates version in package.json (if provided)
# 2. Creates git tag
# 3. Pushes to GitHub (triggers GitHub Actions for binary builds)
# 4. Updates website guide
#
# NOTE: Binary builds are handled by GitHub Actions on tag push.
# See .github/workflows/release.yml
#
# Usage:
#   ./release.sh                    # Release with current version
#   ./release.sh 0.9.0              # Release with new version
#   ./release.sh --guide-only       # Only rebuild the website guide
#   ./release.sh --push             # Release and push both repos
#   ./release.sh 0.9.0 --push       # Release with new version and push
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Directories
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEBSITE_DIR="$HOME/work/web/invisible-store"

# Parse arguments
DO_PUSH=false
VERSION_ARG=""
for arg in "$@"; do
    case $arg in
        --push)
            DO_PUSH=true
            ;;
        --guide-only)
            # Handled separately below
            ;;
        *)
            VERSION_ARG="$arg"
            ;;
    esac
done

# Functions
log_step() {
    echo -e "\n${BLUE}==>${NC} ${1}"
}

log_success() {
    echo -e "${GREEN}✓${NC} ${1}"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} ${1}"
}

log_error() {
    echo -e "${RED}✗${NC} ${1}"
}

# Check if guide-only mode
if [ "$1" = "--guide-only" ]; then
    log_step "Rebuilding website guide only..."
    cd "$WEBSITE_DIR/supertag"
    bun run build-guide.ts
    log_success "Guide rebuilt: $WEBSITE_DIR/supertag/guide.html"
    exit 0
fi

# Get version
if [ -n "$VERSION_ARG" ]; then
    VERSION="$VERSION_ARG"
    log_step "Setting version to $VERSION..."
    # Update package.json version
    cd "$SCRIPT_DIR"
    sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" package.json
    sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" export/package.json
    log_success "Updated package.json to version $VERSION"
else
    VERSION=$(grep '"version"' "$SCRIPT_DIR/package.json" | sed 's/.*"version": "\([^"]*\)".*/\1/')
    log_step "Using current version: $VERSION"
fi

# Verify directories exist
log_step "Verifying directories..."
[ -d "$WEBSITE_DIR" ] || { log_error "Website directory not found: $WEBSITE_DIR"; exit 1; }
log_success "All directories found"

# Run tests before release
log_step "Running tests..."
cd "$SCRIPT_DIR"
bun run test:full
log_success "All tests passed"

# Update website guide
log_step "Updating website guide..."
cd "$WEBSITE_DIR/supertag"
bun run build-guide.ts
log_success "Guide rebuilt: $WEBSITE_DIR/supertag/guide.html"

# Build the website (Vite)
log_step "Building website with Vite..."
cd "$WEBSITE_DIR"
npm run build
log_success "Website built to dist/"

# Summary
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Release v${VERSION} prepared successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Handle git operations
if [ "$DO_PUSH" = true ]; then
    log_step "Committing and pushing changes..."

    # Commit supertag-cli changes
    cd "$SCRIPT_DIR"
    if [ -n "$(git status --porcelain package.json export/package.json CHANGELOG.md 2>/dev/null)" ]; then
        git add package.json export/package.json CHANGELOG.md
        git commit -m "release: v${VERSION}" || true
    fi
    git push
    log_success "Pushed supertag-cli repo"

    # Create and push tag (triggers GitHub Actions build)
    log_step "Creating git tag v${VERSION}..."
    git tag -a "v${VERSION}" -m "Release v${VERSION}"
    git push origin "v${VERSION}"
    log_success "Tag v${VERSION} pushed - GitHub Actions will build binaries"

    # Commit and push website changes
    cd "$WEBSITE_DIR"
    if [ -n "$(git status --porcelain supertag/ 2>/dev/null)" ]; then
        git add supertag/
        git commit -m "docs: update Supertag CLI guide for v${VERSION}"
    fi
    git push
    log_success "Pushed website repo"

    echo ""
    echo -e "${GREEN}All changes committed and pushed!${NC}"
    echo ""
    echo "GitHub Actions will now build binaries for all platforms."
    echo "Check progress at: https://github.com/jcfischer/supertag-cli/actions"
else
    # Git commands for manual execution
    echo -e "${YELLOW}Manual steps remaining:${NC}"
    echo ""
    echo "1. Review and commit supertag-cli changes:"
    echo "   cd $SCRIPT_DIR"
    echo "   git add package.json export/package.json CHANGELOG.md"
    echo "   git status"
    echo "   git commit -m \"release: v${VERSION}\""
    echo ""
    echo "2. Push and create tag (triggers GitHub Actions build):"
    echo "   git push"
    echo "   git tag -a v${VERSION} -m \"Release v${VERSION}\""
    echo "   git push origin v${VERSION}"
    echo ""
    echo "3. Review and commit website changes:"
    echo "   cd $WEBSITE_DIR"
    echo "   git add supertag/"
    echo "   git status"
    echo "   git commit -m \"docs: update Supertag CLI guide for v${VERSION}\""
    echo "   git push"
    echo ""
    echo "Or re-run with --push to do this automatically:"
    echo "   ./release.sh --push"
fi
echo ""
