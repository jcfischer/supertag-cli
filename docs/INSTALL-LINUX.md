# Linux Installation Guide

This guide covers installing Supertag CLI on Linux (x64).

## Prerequisites

- Linux x64 (Ubuntu 20.04+, Debian 11+, Fedora 35+, or similar)
- curl or wget
- unzip
- sudo access (for some steps)

---

## Step 1: Download and Extract

```bash
# Download latest release (replace X.Y.Z with actual version)
curl -LO https://github.com/jcfischer/supertag-cli/releases/download/vX.Y.Z/supertag-cli-vX.Y.Z-linux-x64.zip

# Or use wget
wget https://github.com/jcfischer/supertag-cli/releases/download/vX.Y.Z/supertag-cli-vX.Y.Z-linux-x64.zip

# Extract
unzip supertag-cli-v*.zip
```

### Installation Locations

| Option | Path | When to use |
|--------|------|-------------|
| **User install** | `~/.local/bin/` | Single user, no sudo needed |
| **System install** | `/usr/local/bin/` | All users, requires sudo |
| **Portable** | `/opt/supertag-cli/` | Self-contained directory |

---

## Step 2: Install Binaries

### Option A: User Install (Recommended)

```bash
# Create local bin directory if needed
mkdir -p ~/.local/bin

# Copy binaries
cp supertag-cli-linux-x64/supertag ~/.local/bin/
cp supertag-cli-linux-x64/supertag-export ~/.local/bin/
cp supertag-cli-linux-x64/supertag-mcp ~/.local/bin/

# Make executable
chmod +x ~/.local/bin/supertag*

# Add to PATH (if not already)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### Option B: System-wide Install

```bash
sudo cp supertag-cli-linux-x64/supertag /usr/local/bin/
sudo cp supertag-cli-linux-x64/supertag-export /usr/local/bin/
sudo cp supertag-cli-linux-x64/supertag-mcp /usr/local/bin/
sudo chmod +x /usr/local/bin/supertag*
```

### Option C: Portable Install

```bash
sudo mkdir -p /opt/supertag-cli
sudo cp -r supertag-cli-linux-x64/* /opt/supertag-cli/
sudo chmod +x /opt/supertag-cli/supertag*

# Create symlinks
sudo ln -s /opt/supertag-cli/supertag /usr/local/bin/supertag
sudo ln -s /opt/supertag-cli/supertag-export /usr/local/bin/supertag-export
sudo ln -s /opt/supertag-cli/supertag-mcp /usr/local/bin/supertag-mcp
```

### Verify

```bash
supertag --version
```

---

## Step 3: Configure API Token

Get your Tana API token from: https://app.tana.inc/?bundle=settings&panel=api

### Option A: CLI Command (Recommended)

```bash
supertag config --token "your_token_here"
```

This saves the token to `~/.config/supertag/config.json`.

### Option B: Environment Variable

```bash
# Add to shell config
echo 'export TANA_API_TOKEN="your_token_here"' >> ~/.bashrc
source ~/.bashrc

# For Zsh users
echo 'export TANA_API_TOKEN="your_token_here"' >> ~/.zshrc
source ~/.zshrc
```

---

## Step 4: Install Playwright (Required for Export)

The `supertag-export` tool requires Playwright for browser automation. Due to Playwright's native dependencies, it must be installed globally.

### Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### Install Playwright Globally

```bash
# Install Playwright globally (required for compiled binary)
bun add -g playwright
```

### Configure NODE_PATH

The compiled binary needs `NODE_PATH` to find the global playwright package:

```bash
# Add to ~/.bashrc (or ~/.zshrc for Zsh users)
echo 'export NODE_PATH="$HOME/.bun/install/global/node_modules"' >> ~/.bashrc
source ~/.bashrc
```

### Install System Dependencies and Chromium

**Ubuntu/Debian:**
```bash
# Install system dependencies for Chromium
sudo apt-get update
sudo apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2

# Install Chromium browser
bunx playwright install chromium
```

**Fedora/RHEL:**
```bash
# Install system dependencies
sudo dnf install -y \
    nss \
    nspr \
    atk \
    at-spi2-atk \
    cups-libs \
    libdrm \
    libxkbcommon \
    libXcomposite \
    libXdamage \
    libXfixes \
    libXrandr \
    mesa-libgbm \
    alsa-lib

# Install Chromium browser
bunx playwright install chromium
```

**Arch Linux:**
```bash
# Most dependencies come with base
sudo pacman -S --needed nss cups libdrm mesa

# Install Chromium browser
bunx playwright install chromium
```

### Verify Playwright

```bash
supertag-export --help
```

You should see the help text. Then test login:

```bash
supertag-export login
```

A browser window should open.

---

## Step 5: Create Export Directory

```bash
mkdir -p ~/Documents/Tana-Export/main
```

---

## Step 6: First Run

```bash
# 1. Login to Tana (opens browser)
supertag-export login

# 2. Discover workspaces
supertag-export discover

# 3. Export your data
supertag-export run

# 4. Index the export
supertag sync index

# 5. Test a search
supertag search "test"

# 6. View stats
supertag stats
```

---

## Automated Exports with systemd

Set up automatic daily exports using systemd timers.

### Create Service File

```bash
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/supertag-export.service << 'EOF'
[Unit]
Description=Supertag Tana Export
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/supertag-export run
Environment="TANA_API_TOKEN=your_token_here"
Environment="DISPLAY=:0"

[Install]
WantedBy=default.target
EOF
```

### Create Timer File

```bash
cat > ~/.config/systemd/user/supertag-export.timer << 'EOF'
[Unit]
Description=Run Supertag Export daily

[Timer]
OnCalendar=*-*-* 06:00:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
```

### Enable and Start

```bash
# Reload systemd
systemctl --user daemon-reload

# Enable timer (start on boot)
systemctl --user enable supertag-export.timer

# Start timer now
systemctl --user start supertag-export.timer

# Check status
systemctl --user status supertag-export.timer
systemctl --user list-timers
```

### Manual Run

```bash
systemctl --user start supertag-export.service
```

---

## MCP Server Setup (Optional)

### Claude Desktop (if available on Linux)

```bash
mkdir -p ~/.config/claude
cat > ~/.config/claude/claude_desktop_config.json << 'EOF'
{
  "mcpServers": {
    "tana": {
      "command": "/usr/local/bin/supertag-mcp"
    }
  }
}
EOF
```

### Other MCP Clients

The MCP server runs on stdio. Configure your client to launch:
```
/usr/local/bin/supertag-mcp
```

See [MCP Documentation](./mcp.md) for details.

---

## File Locations on Linux

| Type | Location |
|------|----------|
| Config | `~/.config/supertag/config.json` |
| Database | `~/.local/share/supertag/workspaces/main/tana-index.db` |
| Cache | `~/.cache/supertag/` |
| Exports | `~/Documents/Tana-Export/main/` |
| Playwright | `~/.cache/ms-playwright/` |

These follow the [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/basedir-spec-latest.html).

---

## Troubleshooting

### "command not found: supertag"

PATH not configured. Either:
- Open a new terminal
- Run: `source ~/.bashrc`
- Check: `echo $PATH | grep -E "(local/bin|supertag)"`

### "API token not configured"

Check your environment:
```bash
echo $TANA_API_TOKEN
```

If empty, add to `~/.bashrc` (see [Step 3](#step-3-configure-api-token)).

### "Database not found"

Run the indexer:
```bash
supertag sync index
```

### Playwright: "Cannot find browser"

Install Chromium:
```bash
bunx playwright install chromium
```

### Playwright: Missing Dependencies

The browser needs system libraries. See [Step 4](#step-4-install-playwright-required-for-export) for your distro.

**Quick fix for Ubuntu/Debian:**
```bash
bunx playwright install-deps chromium
```

### Headless Server: No Display

For servers without a display, use headless mode in the export directory option or configure Xvfb:

```bash
# Install Xvfb
sudo apt-get install xvfb

# Run with virtual display
xvfb-run supertag-export run
```

Or do manual exports (see next section).

### Permissions Error

```bash
chmod +x ~/.local/bin/supertag*
# or
sudo chmod +x /usr/local/bin/supertag*
```

---

## Alternative: Manual Export (No Playwright Required)

For headless servers or minimal installations:

1. Export from Tana in your browser:
   - Go to **Settings** → **Export**
   - Select **JSON** format
   - Download the file

2. Transfer to your server:
   ```bash
   scp your-workspace@date.json user@server:~/Documents/Tana-Export/main/
   ```

3. Index:
   ```bash
   supertag sync index
   ```

---

## Updating

```bash
# Download new version
curl -LO https://github.com/jcfischer/supertag-cli/releases/download/vX.Y.Z/supertag-cli-vX.Y.Z-linux-x64.zip

# Extract and replace
unzip -o supertag-cli-v*.zip
cp supertag-cli-linux-x64/supertag* ~/.local/bin/
# or
sudo cp supertag-cli-linux-x64/supertag* /usr/local/bin/

# Verify
supertag --version
```

---

## Uninstalling

```bash
# Remove binaries
rm ~/.local/bin/supertag*
# or
sudo rm /usr/local/bin/supertag*

# Remove data (optional)
rm -rf ~/.config/supertag
rm -rf ~/.local/share/supertag
rm -rf ~/.cache/supertag

# Remove systemd timer (if configured)
systemctl --user disable supertag-export.timer
rm ~/.config/systemd/user/supertag-export.*
systemctl --user daemon-reload
```

---

## Getting Help

- [Main README](../README.md)
- [Getting Started Guide](./GETTING-STARTED.md)
- [GitHub Issues](https://github.com/jcfischer/supertag-cli/issues)
