#!/usr/bin/env bash
#
# Build script for supertag CLI tools
# Compiles TypeScript to standalone binaries and symlinks to ~/bin
#
# Usage:
#   ./scripts/build.sh           # Build if source changed
#   ./scripts/build.sh --force   # Force rebuild
#   ./scripts/build.sh --check   # Check if rebuild needed (exit 1 if yes)
#
# Builds:
#   - supertag        Main CLI (query, create, sync, server)
#   - supertag-export Browser automation for exports (Playwright)
#   - supertag-mcp    MCP server for AI tool integration
#
# NOTE: Run this after implementing changes to ensure binaries are up to date

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_DIR/src"
BIN_DIR="$HOME/bin"

# Binary definitions
BINARY_NAMES=("supertag" "supertag-mcp" "supertag-export")
BINARY_ENTRIES=("src/index.ts" "src/mcp/index.ts" "export/index.ts")

# External flags for supertag-export (Playwright needs external linking)
EXPORT_EXTERNAL_FLAGS="--external playwright --external playwright-core --external electron --external chromium-bidi"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[build]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[build]${NC} $1"
}

log_error() {
    echo -e "${RED}[build]${NC} $1"
}

log_step() {
    echo -e "${BLUE}[build]${NC} $1"
}

# Check if any binary needs rebuilding
needs_rebuild() {
    for binary in "${BINARY_NAMES[@]}"; do
        local binary_path="$PROJECT_DIR/$binary"

        # If binary doesn't exist, rebuild
        if [[ ! -f "$binary_path" ]]; then
            return 0
        fi

        # Check if any source file is newer than binary
        local newer_files
        newer_files=$(find "$SRC_DIR" -name "*.ts" -newer "$binary_path" 2>/dev/null | head -1)
        if [[ -n "$newer_files" ]]; then
            return 0
        fi

        # Check export directory for supertag-export
        if [[ "$binary" == "supertag-export" ]]; then
            newer_files=$(find "$PROJECT_DIR/export" -name "*.ts" -newer "$binary_path" 2>/dev/null | head -1)
            if [[ -n "$newer_files" ]]; then
                return 0
            fi
        fi

        # Check if package.json is newer
        if [[ "$PROJECT_DIR/package.json" -nt "$binary_path" ]]; then
            return 0
        fi
    done

    return 1
}

# Build a single binary
build_binary() {
    local name="$1"
    local entry="$2"
    local output="$PROJECT_DIR/$name"

    log_step "Compiling $name..."

    cd "$PROJECT_DIR"

    if [[ "$name" == "supertag-export" ]]; then
        # supertag-export needs external flags for Playwright
        bun build "$entry" --compile $EXPORT_EXTERNAL_FLAGS --outfile="$name"
    else
        bun build "$entry" --compile --outfile="$name"
    fi

    local size
    size=$(ls -lh "$output" | awk '{print $5}')
    log_info "  Built $name ($size)"
}

# Create symlinks in ~/bin
create_symlinks() {
    log_step "Creating symlinks in $BIN_DIR..."

    # Ensure ~/bin exists
    mkdir -p "$BIN_DIR"

    for binary in "${BINARY_NAMES[@]}"; do
        local source="$PROJECT_DIR/$binary"
        local target="$BIN_DIR/$binary"

        if [[ -f "$source" ]]; then
            # Remove existing symlink or file
            if [[ -L "$target" ]] || [[ -f "$target" ]]; then
                rm -f "$target"
            fi

            ln -s "$source" "$target"
            log_info "  Linked $binary -> $target"
        else
            log_warn "  Skipped $binary (binary not found)"
        fi
    done
}

# Build all binaries
do_build() {
    log_info "Building supertag CLI tools..."
    cd "$PROJECT_DIR"

    # Run tests first (skip slow tests for faster builds)
    log_step "Running tests..."
    if ! bun test ./tests/*.test.ts ./src/**/*.test.ts --timeout 120000 2>&1; then
        log_error "Tests failed! Aborting build."
        exit 1
    fi

    # Build each binary
    echo ""
    for i in "${!BINARY_NAMES[@]}"; do
        build_binary "${BINARY_NAMES[$i]}" "${BINARY_ENTRIES[$i]}"
    done

    # Create symlinks
    echo ""
    create_symlinks

    echo ""
    log_info "Build complete!"
    echo ""
    log_info "Binaries:"
    for binary in "${BINARY_NAMES[@]}"; do
        local path="$PROJECT_DIR/$binary"
        if [[ -f "$path" ]]; then
            local size
            size=$(ls -lh "$path" | awk '{print $5}')
            echo "  $binary: $size"
        fi
    done
}

# Main
main() {
    local force=false
    local check_only=false

    for arg in "$@"; do
        case $arg in
            --force|-f)
                force=true
                ;;
            --check|-c)
                check_only=true
                ;;
            --help|-h)
                echo "Usage: $0 [--force] [--check]"
                echo "  --force, -f   Force rebuild even if binaries are up to date"
                echo "  --check, -c   Check if rebuild needed (exit 1 if yes)"
                echo ""
                echo "Builds: supertag, supertag-export, supertag-mcp"
                echo "Symlinks to: ~/bin/"
                exit 0
                ;;
        esac
    done

    if $check_only; then
        if needs_rebuild; then
            log_warn "Rebuild needed"
            exit 1
        else
            log_info "Binaries are up to date"
            exit 0
        fi
    fi

    if $force; then
        log_info "Force rebuild requested"
        do_build
    elif needs_rebuild; then
        log_warn "Source files changed, rebuilding..."
        do_build
    else
        log_info "Binaries are up to date, skipping build"
        log_info "Use --force to rebuild anyway"
    fi
}

main "$@"
