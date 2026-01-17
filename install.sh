#!/bin/bash
# =============================================================================
# supertag-cli Installer
#
# Installs supertag-cli and all dependencies (Bun, Playwright, Chromium)
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/jcfischer/supertag-cli/main/install.sh | bash
#   ./install.sh --version 0.16.0
#   ./install.sh --no-mcp
#
# =============================================================================

set -euo pipefail

# =============================================================================
# Configuration
# =============================================================================

VERSION="${SUPERTAG_VERSION:-latest}"
INSTALL_DIR="${SUPERTAG_INSTALL_DIR:-$HOME/Tools/supertag-cli}"
SKIP_MCP="${SKIP_MCP:-false}"
SKIP_LAUNCHD="${SKIP_LAUNCHD:-false}"
GITHUB_REPO="jcfischer/supertag-cli"

# =============================================================================
# Colors & Formatting
# =============================================================================

if [[ -t 1 ]] && [[ "${TERM:-}" != "dumb" ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m' # No Color
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    BOLD=''
    NC=''
fi

# =============================================================================
# Utility Functions
# =============================================================================

info() {
    echo -e "      ${BLUE}→${NC} $1"
}

success() {
    echo -e "      ${GREEN}✓${NC} $1"
}

warn() {
    echo -e "      ${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "      ${RED}✗${NC} $1" >&2
}

fatal() {
    error "$1"
    exit 1
}

step() {
    echo ""
    echo -e "${BOLD}[$1]${NC} $2"
}

confirm() {
    local prompt="$1"
    local default="${2:-y}"
    local yn

    if [[ "$default" == "y" ]]; then
        read -p "      $prompt [Y/n]: " yn </dev/tty
        yn="${yn:-y}"
    else
        read -p "      $prompt [y/N]: " yn </dev/tty
        yn="${yn:-n}"
    fi

    [[ "$yn" =~ ^[Yy] ]]
}

# =============================================================================
# Detection Functions
# =============================================================================

detect_platform() {
    local os
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    local arch
    arch=$(uname -m)

    case "$os" in
        darwin)
            case "$arch" in
                arm64) echo "macos-arm64" ;;
                x86_64) echo "macos-x64" ;;
                *) fatal "Unsupported architecture: $arch (expected arm64 or x86_64)" ;;
            esac
            ;;
        linux)
            case "$arch" in
                x86_64) echo "linux-x64" ;;
                aarch64) echo "linux-arm64" ;;
                *) fatal "Unsupported architecture: $arch (expected x86_64 or aarch64)" ;;
            esac
            ;;
        *) fatal "Unsupported OS: $os (expected darwin or linux)" ;;
    esac
}

detect_shell() {
    basename "${SHELL:-/bin/bash}"
}

is_bun_installed() {
    command -v bun &>/dev/null
}

is_playwright_installed() {
    if is_bun_installed; then
        bun pm ls -g 2>/dev/null | grep -q "playwright" 2>/dev/null
    else
        return 1
    fi
}

is_chromium_installed() {
    local cache_dir
    case "$(uname -s)" in
        Darwin) cache_dir="$HOME/Library/Caches/ms-playwright" ;;
        *) cache_dir="$HOME/.cache/ms-playwright" ;;
    esac

    [[ -d "$cache_dir" ]] && [[ -n "$(ls -A "$cache_dir" 2>/dev/null)" ]]
}

get_installed_version() {
    if [[ -x "$INSTALL_DIR/supertag" ]]; then
        "$INSTALL_DIR/supertag" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo ""
    else
        echo ""
    fi
}

resolve_version() {
    local requested="$1"

    if [[ "$requested" == "latest" ]]; then
        local latest
        latest=$(curl -fsSL "https://api.github.com/repos/$GITHUB_REPO/releases/latest" 2>/dev/null \
            | grep '"tag_name"' \
            | sed -E 's/.*"v?([^"]+)".*/\1/' || echo "")

        if [[ -z "$latest" ]]; then
            fatal "Could not fetch latest version from GitHub. Check your network connection."
        fi
        echo "$latest"
    else
        # Strip leading 'v' if present
        echo "${requested#v}"
    fi
}

# =============================================================================
# Installation Functions
# =============================================================================

install_bun() {
    if is_bun_installed; then
        local version
        version=$(bun --version 2>/dev/null || echo "unknown")
        success "Bun v$version already installed (skipping)"
        return 0
    fi

    info "Downloading Bun installer..."
    if ! curl -fsSL https://bun.sh/install | bash; then
        fatal "Failed to install Bun. Visit https://bun.sh/docs/installation for manual installation."
    fi

    # Source the new PATH
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"

    if ! is_bun_installed; then
        fatal "Bun installation completed but 'bun' command not found. Please restart your terminal."
    fi

    success "Bun v$(bun --version) installed"
}

install_playwright() {
    if is_playwright_installed; then
        success "Playwright already installed (skipping)"
        return 0
    fi

    info "Installing Playwright globally..."
    if ! bun add -g playwright; then
        fatal "Failed to install Playwright. Try: bun add -g playwright"
    fi

    success "Playwright installed"
}

install_chromium() {
    if is_chromium_installed; then
        success "Chromium already installed (skipping)"
        return 0
    fi

    info "Installing Chromium browser (this may take a minute)..."
    if ! bunx playwright install chromium; then
        fatal "Failed to install Chromium. Try: bunx playwright install chromium"
    fi

    success "Chromium installed"
}

download_supertag() {
    local version="$1"
    local platform="$2"

    local installed_version
    installed_version=$(get_installed_version)

    # Only skip download if version matches AND scripts directory already exists
    # (scripts were added in v1.9.7, older installs need to re-download to get them)
    if [[ "$installed_version" == "$version" ]] && [[ -d "$INSTALL_DIR/scripts" ]]; then
        success "supertag-cli v$version already installed (skipping)"
        return 0
    fi

    if [[ "$installed_version" == "$version" ]]; then
        info "Re-downloading v$version to get scripts and launchd templates..."
    elif [[ -n "$installed_version" ]]; then
        info "Updating from v$installed_version to v$version"
    fi

    local download_url="https://github.com/$GITHUB_REPO/releases/download/v${version}/supertag-cli-v${version}-${platform}.zip"
    local temp_dir
    temp_dir=$(mktemp -d)
    local zip_file="$temp_dir/supertag-cli.zip"

    info "Downloading supertag-cli v$version for $platform..."
    if ! curl -fsSL -o "$zip_file" "$download_url"; then
        rm -rf "$temp_dir"
        fatal "Failed to download from $download_url"
    fi

    info "Extracting to $INSTALL_DIR..."
    mkdir -p "$INSTALL_DIR"

    if ! unzip -o -q "$zip_file" -d "$temp_dir"; then
        rm -rf "$temp_dir"
        fatal "Failed to extract archive"
    fi

    # Find the extracted directory (may be nested)
    local extracted_dir
    extracted_dir=$(find "$temp_dir" -maxdepth 1 -type d -name "supertag-cli*" | head -1)

    if [[ -z "$extracted_dir" ]]; then
        # Files might be directly in temp_dir
        extracted_dir="$temp_dir"
    fi

    # Copy binaries
    cp -f "$extracted_dir/supertag" "$INSTALL_DIR/" 2>/dev/null || \
    cp -f "$temp_dir/supertag" "$INSTALL_DIR/" 2>/dev/null || \
    fatal "Could not find supertag binary in archive"

    cp -f "$extracted_dir/supertag-export" "$INSTALL_DIR/" 2>/dev/null || \
    cp -f "$temp_dir/supertag-export" "$INSTALL_DIR/" 2>/dev/null || true

    cp -f "$extracted_dir/supertag-mcp" "$INSTALL_DIR/" 2>/dev/null || \
    cp -f "$temp_dir/supertag-mcp" "$INSTALL_DIR/" 2>/dev/null || true

    # Copy scripts, launchd templates, and docs
    if [[ -d "$extracted_dir/scripts" ]]; then
        cp -rf "$extracted_dir/scripts" "$INSTALL_DIR/"
        chmod +x "$INSTALL_DIR/scripts/"*.sh 2>/dev/null || true
    fi

    if [[ -d "$extracted_dir/launchd" ]]; then
        cp -rf "$extracted_dir/launchd" "$INSTALL_DIR/"
    fi

    if [[ -d "$extracted_dir/docs" ]]; then
        cp -rf "$extracted_dir/docs" "$INSTALL_DIR/"
    fi

    # Make binaries executable
    chmod +x "$INSTALL_DIR/supertag"*

    # Remove quarantine on macOS
    if [[ "$(uname -s)" == "Darwin" ]]; then
        xattr -d com.apple.quarantine "$INSTALL_DIR/supertag"* 2>/dev/null || true
    fi

    rm -rf "$temp_dir"
    success "supertag-cli v$version installed to $INSTALL_DIR"
}

configure_path() {
    local bin_dir=""
    local needs_shell_config=false

    # Step 1: Check if user already has a local bin in PATH
    local existing_local_bin=""
    for dir in "$HOME/bin" "$HOME/.local/bin"; do
        if [[ ":$PATH:" == *":$dir:"* ]]; then
            existing_local_bin="$dir"
            break
        fi
    done

    if [[ -n "$existing_local_bin" ]]; then
        info "Found $existing_local_bin in your PATH"
        if confirm "Install symlinks there?"; then
            bin_dir="$existing_local_bin"
        fi
    fi

    # Step 2: If no local bin found or user declined, offer choice
    if [[ -z "$bin_dir" ]]; then
        echo ""
        echo "      Where should I install the commands?"
        echo ""
        echo "        1) /usr/local/bin (requires sudo, no shell config changes)"
        echo "        2) ~/.local/bin (no sudo, adds to shell config)"
        echo ""
        read -p "      Choice [1]: " choice </dev/tty
        choice="${choice:-1}"

        case "$choice" in
            1)
                bin_dir="/usr/local/bin"
                needs_shell_config=false
                ;;
            2)
                bin_dir="$HOME/.local/bin"
                needs_shell_config=true
                mkdir -p "$bin_dir"
                ;;
            *)
                warn "Invalid choice, using /usr/local/bin"
                bin_dir="/usr/local/bin"
                needs_shell_config=false
                ;;
        esac
    fi

    # Step 3: Check if symlinks already exist and point to correct location
    local needs_symlinks=false
    for cmd in supertag supertag-export supertag-mcp; do
        if [[ -f "$INSTALL_DIR/$cmd" ]]; then
            local existing_link="$bin_dir/$cmd"
            if [[ -L "$existing_link" ]]; then
                local target
                target=$(readlink "$existing_link" 2>/dev/null || echo "")
                if [[ "$target" != "$INSTALL_DIR/$cmd" ]]; then
                    needs_symlinks=true
                    break
                fi
            elif [[ ! -e "$existing_link" ]]; then
                needs_symlinks=true
                break
            fi
        fi
    done

    if [[ "$needs_symlinks" == false ]] && [[ -L "$bin_dir/supertag" ]]; then
        success "Symlinks already configured (skipping)"
    else
        info "Creating symlinks in $bin_dir"

        if [[ "$bin_dir" == "/usr/local/bin" ]]; then
            sudo ln -sf "$INSTALL_DIR/supertag" "$bin_dir/supertag"
            [[ -f "$INSTALL_DIR/supertag-export" ]] && sudo ln -sf "$INSTALL_DIR/supertag-export" "$bin_dir/supertag-export"
            [[ -f "$INSTALL_DIR/supertag-mcp" ]] && sudo ln -sf "$INSTALL_DIR/supertag-mcp" "$bin_dir/supertag-mcp"
        else
            ln -sf "$INSTALL_DIR/supertag" "$bin_dir/supertag"
            [[ -f "$INSTALL_DIR/supertag-export" ]] && ln -sf "$INSTALL_DIR/supertag-export" "$bin_dir/supertag-export"
            [[ -f "$INSTALL_DIR/supertag-mcp" ]] && ln -sf "$INSTALL_DIR/supertag-mcp" "$bin_dir/supertag-mcp"
        fi

        success "Symlinks created in $bin_dir"
    fi

    # Step 4: Update shell config if needed
    if [[ "$needs_shell_config" == true ]]; then
        configure_shell_path "$bin_dir"
    fi

    # Configure NODE_PATH for Playwright
    configure_node_path
}

configure_shell_path() {
    local bin_dir="$1"
    local shell_config=""
    local path_line="export PATH=\"\$PATH:$bin_dir\""

    # Detect shell config file
    local shell_name
    shell_name=$(detect_shell)

    case "$shell_name" in
        zsh)  shell_config="$HOME/.zshrc" ;;
        bash)
            if [[ -f "$HOME/.bash_profile" ]]; then
                shell_config="$HOME/.bash_profile"
            else
                shell_config="$HOME/.bashrc"
            fi
            ;;
        fish)
            shell_config="$HOME/.config/fish/config.fish"
            path_line="set -gx PATH \$PATH $bin_dir"
            mkdir -p "$(dirname "$shell_config")"
            ;;
        *)
            warn "Unknown shell: $shell_name"
            warn "Add this to your shell config manually:"
            echo "      $path_line"
            return
            ;;
    esac

    # Check if already configured
    if grep -q "$bin_dir" "$shell_config" 2>/dev/null; then
        info "PATH already configured in $shell_config"
        return
    fi

    # Add to shell config
    {
        echo ""
        echo "# Added by supertag-cli installer"
        echo "$path_line"
    } >> "$shell_config"

    success "Added $bin_dir to PATH in $shell_config"
    warn "Run 'source $shell_config' or open a new terminal"
}

configure_node_path() {
    local shell_name
    shell_name=$(detect_shell)
    local shell_config=""
    local node_path_line=""

    # Determine NODE_PATH value
    local bun_global_dir="$HOME/.bun/install/global/node_modules"

    # Export immediately for current session (critical for supertag-export to work)
    # Use ${NODE_PATH:-} to handle case where NODE_PATH is not set (set -u safe)
    export NODE_PATH="$bun_global_dir${NODE_PATH:+:$NODE_PATH}"

    case "$shell_name" in
        zsh)
            shell_config="$HOME/.zshrc"
            node_path_line="export NODE_PATH=\"$bun_global_dir:\$NODE_PATH\""
            ;;
        bash)
            if [[ -f "$HOME/.bash_profile" ]]; then
                shell_config="$HOME/.bash_profile"
            else
                shell_config="$HOME/.bashrc"
            fi
            node_path_line="export NODE_PATH=\"$bun_global_dir:\$NODE_PATH\""
            ;;
        fish)
            shell_config="$HOME/.config/fish/config.fish"
            node_path_line="set -gx NODE_PATH $bun_global_dir \$NODE_PATH"
            ;;
        *)
            return
            ;;
    esac

    # Check if already configured in shell config
    if grep -q "NODE_PATH.*bun" "$shell_config" 2>/dev/null; then
        return
    fi

    # Add to shell config for future sessions
    {
        echo ""
        echo "# NODE_PATH for Playwright (added by supertag-cli installer)"
        echo "$node_path_line"
    } >> "$shell_config"

    success "NODE_PATH configured in $shell_config"
}

# =============================================================================
# MCP Configuration
# =============================================================================

configure_mcp() {
    local mcp_path="$INSTALL_DIR/supertag-mcp"
    local configured=()

    # Claude Desktop (macOS)
    if [[ "$(uname -s)" == "Darwin" ]]; then
        local claude_config="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
        if [[ -d "$(dirname "$claude_config")" ]]; then
            if configure_mcp_client "$claude_config" "$mcp_path"; then
                configured+=("Claude Desktop")
            fi
        fi

        # Cursor (macOS)
        local cursor_config="$HOME/Library/Application Support/Cursor/User/globalStorage/cursor-mcp/config.json"
        if [[ -d "$(dirname "$cursor_config")" ]]; then
            if configure_mcp_client "$cursor_config" "$mcp_path"; then
                configured+=("Cursor")
            fi
        fi
    fi

    # Claude Code (cross-platform)
    local claude_code_config="$HOME/.claude.json"
    if [[ -f "$claude_code_config" ]]; then
        if configure_mcp_client "$claude_code_config" "$mcp_path"; then
            configured+=("Claude Code")
        fi
    fi

    if [[ ${#configured[@]} -eq 0 ]]; then
        info "No MCP clients found. You can configure manually later."
    else
        success "MCP configured for: ${configured[*]}"
    fi
}

configure_mcp_client() {
    local config_file="$1"
    local mcp_path="$2"

    # Create backup if file exists
    if [[ -f "$config_file" ]]; then
        cp "$config_file" "${config_file}.backup.$(date +%Y%m%d%H%M%S)"
    fi

    # Use Python for JSON manipulation (most reliable, usually available)
    if command -v python3 &>/dev/null; then
        local result
        result=$(python3 - "$config_file" "$mcp_path" <<'PYTHON'
import json
import sys
import os

config_file, mcp_path = sys.argv[1], sys.argv[2]

try:
    if os.path.exists(config_file):
        with open(config_file) as f:
            config = json.load(f)
    else:
        config = {}
except (json.JSONDecodeError, IOError):
    config = {}

if "mcpServers" not in config:
    config["mcpServers"] = {}

if "supertag" not in config["mcpServers"]:
    config["mcpServers"]["supertag"] = {"command": mcp_path}

    # Ensure directory exists
    os.makedirs(os.path.dirname(config_file) or '.', exist_ok=True)

    with open(config_file, 'w') as f:
        json.dump(config, f, indent=2)
    print("added")
else:
    # Update path if different
    if config["mcpServers"]["supertag"].get("command") != mcp_path:
        config["mcpServers"]["supertag"]["command"] = mcp_path
        with open(config_file, 'w') as f:
            json.dump(config, f, indent=2)
        print("updated")
    else:
        print("exists")
PYTHON
        )

        case "$result" in
            added|updated) return 0 ;;
            exists)
                info "supertag already configured in $(basename "$config_file")"
                return 0
                ;;
            *) return 1 ;;
        esac
    else
        # Fallback: Create simple config if file doesn't exist
        if [[ ! -f "$config_file" ]]; then
            mkdir -p "$(dirname "$config_file")"
            cat > "$config_file" <<EOF
{
  "mcpServers": {
    "supertag": {
      "command": "$mcp_path"
    }
  }
}
EOF
            return 0
        else
            warn "python3 not found - cannot safely update existing config"
            warn "Add supertag-mcp manually to: $config_file"
            return 1
        fi
    fi
}

# =============================================================================
# Verification
# =============================================================================

verify_installation() {
    echo ""
    info "Verifying installation..."

    local all_good=true

    # Check supertag binary
    if [[ -x "$INSTALL_DIR/supertag" ]]; then
        local version
        version=$("$INSTALL_DIR/supertag" --version 2>/dev/null | head -1 || echo "unknown")
        success "supertag: $version"
    else
        error "supertag binary not found"
        all_good=false
    fi

    # Check supertag-export
    if [[ -x "$INSTALL_DIR/supertag-export" ]]; then
        success "supertag-export: ready"
    else
        warn "supertag-export not found (optional)"
    fi

    # Check supertag-mcp
    if [[ -x "$INSTALL_DIR/supertag-mcp" ]]; then
        success "supertag-mcp: ready"
    else
        warn "supertag-mcp not found (optional)"
    fi

    # Check if commands are in PATH
    if command -v supertag &>/dev/null; then
        success "supertag in PATH"
    else
        warn "supertag not in PATH yet (open a new terminal)"
    fi

    if [[ "$all_good" == false ]]; then
        fatal "Installation verification failed"
    fi
}

# =============================================================================
# Output
# =============================================================================

print_banner() {
    echo ""
    echo -e "${BOLD}Installing supertag-cli${NC}"
    echo ""
}

# =============================================================================
# Launchd Configuration (macOS only)
# =============================================================================

configure_launchd() {
    # Only available on macOS
    if [[ "$(uname -s)" != "Darwin" ]]; then
        info "Launchd services are only available on macOS"
        return 0
    fi

    echo ""
    echo -e "${BOLD}Background Services (Optional)${NC}"
    echo ""
    echo "  supertag can run background services on macOS:"
    echo "    • Webhook Server - Receives notifications from Tana"
    echo "    • Scheduled Sync - Automatically syncs your Tana data"
    echo ""

    local install_server=false
    local install_sync=false
    local sync_schedule=""

    # Ask about webhook server
    if confirm "Install the webhook server? (starts on login)"; then
        install_server=true
    fi

    # Ask about scheduled sync
    if confirm "Install scheduled auto-sync?"; then
        install_sync=true

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
            1) sync_schedule="0,6,12,18" ;;
            2) sync_schedule="0,4,8,12,16,20" ;;
            3) sync_schedule="6,18" ;;
            4) sync_schedule="6" ;;
            5)
                echo ""
                echo "  Enter hours (0-23) separated by commas."
                echo "  Example: 6,12,18 for 6 AM, noon, and 6 PM"
                echo ""
                read -p "      Hours: " custom_hours </dev/tty
                if [[ -n "$custom_hours" ]]; then
                    sync_schedule="$custom_hours"
                else
                    sync_schedule="6"  # Default to 6 AM if empty
                fi
                ;;
            *)
                sync_schedule="0,6,12,18"  # Default to every 6 hours
                ;;
        esac
    fi

    # Install selected services
    local scripts_dir="$INSTALL_DIR/scripts"

    if [[ "$install_server" == "true" ]]; then
        echo ""
        info "Installing webhook server..."
        if [[ -f "$scripts_dir/install-launchd.sh" ]]; then
            bash "$scripts_dir/install-launchd.sh" server 2>/dev/null || warn "Server installation had issues - check logs"
        else
            warn "install-launchd.sh not found. Run manually after installation."
        fi
    fi

    if [[ "$install_sync" == "true" ]]; then
        echo ""
        info "Installing scheduled sync (schedule: $sync_schedule)..."
        if [[ -f "$scripts_dir/install-launchd.sh" ]]; then
            SYNC_HOURS="$sync_schedule" bash "$scripts_dir/install-launchd.sh" daily 2>/dev/null || warn "Sync installation had issues - check logs"
        else
            warn "install-launchd.sh not found. Run manually after installation."
        fi
    fi

    if [[ "$install_server" == "false" && "$install_sync" == "false" ]]; then
        info "Skipping background services. You can set them up later with:"
        echo "      $scripts_dir/install-launchd.sh"
    fi
}

print_success() {
    echo ""
    echo -e "${GREEN}${BOLD}Installation complete!${NC}"
    echo ""
    echo "  Commands installed:"
    echo "    supertag        - Query your Tana graph"
    echo "    supertag-export - Export Tana data"
    echo "    supertag-mcp    - MCP server for AI tools"
    echo ""
    echo -e "  ${YELLOW}${BOLD}IMPORTANT: Open a new terminal window before continuing!${NC}"
    echo ""
    echo "  Next steps (in the NEW terminal):"
    echo "    1. Run: supertag-export login"
    echo "    2. Run: supertag-export discover"
    echo ""
    echo "  Manage background services (macOS):"
    echo "    $INSTALL_DIR/scripts/install-launchd.sh"
    echo ""
    echo -e "  Documentation: ${BLUE}https://github.com/$GITHUB_REPO${NC}"
    echo ""
}

print_help() {
    echo "supertag-cli installer"
    echo ""
    echo "Usage: install.sh [options]"
    echo ""
    echo "Options:"
    echo "  --version VERSION  Install specific version (default: latest)"
    echo "  --no-mcp           Skip MCP auto-configuration"
    echo "  --no-launchd       Skip launchd service setup (macOS)"
    echo "  --help             Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  SUPERTAG_VERSION      Override version to install"
    echo "  SUPERTAG_INSTALL_DIR  Override installation directory"
    echo "  SKIP_MCP              Set to 'true' to skip MCP configuration"
    echo "  SKIP_LAUNCHD          Set to 'true' to skip launchd setup"
    echo ""
    echo "Examples:"
    echo "  curl -fsSL https://raw.githubusercontent.com/$GITHUB_REPO/main/install.sh | bash"
    echo "  ./install.sh --version 0.16.0"
    echo "  SKIP_MCP=true ./install.sh"
    echo ""
}

# =============================================================================
# Argument Parsing
# =============================================================================

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --version)
                VERSION="$2"
                shift 2
                ;;
            --no-mcp)
                SKIP_MCP="true"
                shift
                ;;
            --no-launchd)
                SKIP_LAUNCHD="true"
                shift
                ;;
            --help|-h)
                print_help
                exit 0
                ;;
            *)
                warn "Unknown option: $1"
                shift
                ;;
        esac
    done
}

# =============================================================================
# Main
# =============================================================================

main() {
    parse_args "$@"
    print_banner

    local platform
    platform=$(detect_platform)
    info "Detected platform: $platform"

    local version
    version=$(resolve_version "$VERSION")
    info "Target version: v$version"

    step "1/7" "Installing Bun"
    install_bun

    step "2/7" "Installing Playwright"
    install_playwright

    step "3/7" "Installing Chromium"
    install_chromium

    step "4/7" "Downloading supertag-cli"
    download_supertag "$version" "$platform"

    step "5/7" "Configuring PATH"
    configure_path

    if [[ "$SKIP_MCP" != "true" ]]; then
        step "6/7" "Configuring MCP"
        configure_mcp
    fi

    if [[ "$SKIP_LAUNCHD" != "true" ]]; then
        step "7/7" "Background Services"
        configure_launchd
    fi

    verify_installation
    print_success
}

main "$@"
