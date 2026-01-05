# macOS Installation Guide

This guide covers installing Supertag CLI on macOS (Apple Silicon and Intel).

## Prerequisites

- macOS 11 (Big Sur) or later
- Terminal access
- Homebrew (recommended, not required)

---

## Step 1: Download and Extract

1. Go to [GitHub Releases](https://github.com/jcfischer/supertag-cli/releases)
2. Download the appropriate version:
   - **Apple Silicon (M1/M2/M3)**: `supertag-cli-vX.Y.Z-macos-arm64.zip`
   - **Intel Mac**: `supertag-cli-vX.Y.Z-macos-x64.zip`

3. Extract and move to installation location:

```bash
# Extract
unzip ~/Downloads/supertag-cli-v*.zip

# Move to a permanent location (choose one)
# Option A: User directory (recommended)
mv supertag-cli-macos-* ~/Tools/supertag-cli

# Option B: System-wide
sudo mv supertag-cli-macos-* /usr/local/supertag-cli
```

---

## Step 2: Remove Quarantine

macOS marks downloaded files as "quarantined" for security. Remove this flag:

```bash
cd ~/Tools/supertag-cli  # or your installation path
xattr -d com.apple.quarantine ./supertag ./supertag-mcp ./supertag-export
```

**If you see "No such xattr"**, the files aren't quarantined (this is fine).

### Gatekeeper Warning

If macOS shows "cannot be opened because the developer cannot be verified":

1. Go to **System Preferences** → **Security & Privacy** → **General**
2. Click **Allow Anyway** next to the blocked app message
3. Try running the command again and click **Open** when prompted

---

## Step 3: Add to PATH

### Option A: Symlinks (Recommended)

Create symlinks in a directory that's already in your PATH:

```bash
sudo ln -s ~/Tools/supertag-cli/supertag /usr/local/bin/supertag
sudo ln -s ~/Tools/supertag-cli/supertag-export /usr/local/bin/supertag-export
sudo ln -s ~/Tools/supertag-cli/supertag-mcp /usr/local/bin/supertag-mcp
```

### Option B: Modify PATH

Add the installation directory to your shell's PATH:

**For Zsh (default on modern macOS):**
```bash
echo 'export PATH="$PATH:$HOME/Tools/supertag-cli"' >> ~/.zshrc
source ~/.zshrc
```

**For Bash:**
```bash
echo 'export PATH="$PATH:$HOME/Tools/supertag-cli"' >> ~/.bash_profile
source ~/.bash_profile
```

### Verify

```bash
supertag --version
```

---

## Step 4: Configure API Token

Get your Tana API token from: https://app.tana.inc/?bundle=settings&panel=api

### Option A: CLI Command (Recommended)

```bash
supertag config --token "your_token_here"
```

This saves the token to `~/.config/supertag/config.json`.

### Option B: Environment Variable

Add to your shell configuration:

```bash
# For Zsh
echo 'export TANA_API_TOKEN="your_token_here"' >> ~/.zshrc
source ~/.zshrc

# For Bash
echo 'export TANA_API_TOKEN="your_token_here"' >> ~/.bash_profile
source ~/.bash_profile
```

---

## Step 5: Install Playwright (Required for Export)

The `supertag-export` tool requires Playwright for browser automation. Due to Playwright's native dependencies, it must be installed globally.

### Using Homebrew (Recommended)

```bash
# Install Bun
brew install oven-sh/bun/bun

# Install Playwright globally (required for compiled binary)
bun add -g playwright

# Install Chromium browser
bunx playwright install chromium
```

### Using the Install Script

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Reload shell
source ~/.zshrc  # or ~/.bash_profile

# Install Playwright globally (required for compiled binary)
bun add -g playwright

# Install Chromium browser
bunx playwright install chromium
```

### Configure NODE_PATH

The compiled binary needs `NODE_PATH` to find the global playwright package. Add to your shell config:

```bash
# For Zsh (default on modern macOS)
echo 'export NODE_PATH="$HOME/.bun/install/global/node_modules"' >> ~/.zshrc
source ~/.zshrc

# For Bash
echo 'export NODE_PATH="$HOME/.bun/install/global/node_modules"' >> ~/.bash_profile
source ~/.bash_profile
```

### Verify

```bash
supertag-export --help
```

You should see the help text. Then test login:

```bash
supertag-export login
```

A browser window should open for Tana login.

---

## Step 6: Create Export Directory

```bash
mkdir -p ~/Documents/Tana-Export/main
```

---

## Step 7: First Run

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

## Automated Exports with launchd

Set up automatic daily exports using macOS launchd:

### Create the Launch Agent

```bash
cat > ~/Library/LaunchAgents/com.supertag.export.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.supertag.export</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/supertag-export</string>
        <string>run</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>6</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/supertag-export.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/supertag-export.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>TANA_API_TOKEN</key>
        <string>your_token_here</string>
    </dict>
</dict>
</plist>
EOF
```

### Load the Agent

```bash
launchctl load ~/Library/LaunchAgents/com.supertag.export.plist
```

### Manage the Agent

```bash
# Check status
launchctl list | grep supertag

# Stop
launchctl unload ~/Library/LaunchAgents/com.supertag.export.plist

# Start
launchctl load ~/Library/LaunchAgents/com.supertag.export.plist

# Run immediately (test)
launchctl start com.supertag.export
```

See [Launchd Setup](./LAUNCHD-SETUP.md) for detailed configuration.

---

## MCP Server Setup (Optional)

### Claude Desktop

1. Open the Claude Desktop config:
   ```bash
   code ~/Library/Application\ Support/Claude/claude_desktop_config.json
   # or
   open -a TextEdit ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```

2. Add the MCP server:
   ```json
   {
     "mcpServers": {
       "tana": {
         "command": "/usr/local/bin/supertag-mcp"
       }
     }
   }
   ```

3. Restart Claude Desktop

See [MCP Documentation](./mcp.md) for other AI tools.

---

## File Locations on macOS

| Type | Location |
|------|----------|
| Config | `~/.config/supertag/config.json` |
| Database | `~/.local/share/supertag/workspaces/main/tana-index.db` |
| Cache | `~/.cache/supertag/` |
| Exports | `~/Documents/Tana-Export/main/` |
| Playwright | `~/Library/Caches/ms-playwright/` |

---

## Troubleshooting

### "command not found: supertag"

PATH not configured. Either:
- Open a new terminal window
- Run: `source ~/.zshrc` (or `~/.bash_profile`)
- Follow [Step 3](#step-3-add-to-path) again

### "cannot be opened because the developer cannot be verified"

1. Run: `xattr -d com.apple.quarantine /path/to/supertag`
2. Or: System Preferences → Security & Privacy → Allow Anyway

### "API token not configured"

Check your environment:
```bash
echo $TANA_API_TOKEN
```

If empty, add to your shell config (see [Step 4](#step-4-configure-api-token)).

### "Database not found"

Run the indexer:
```bash
supertag sync index
```

### Playwright Issues

**"Cannot find package 'playwright'"**

This usually means playwright isn't installed globally or NODE_PATH isn't set:

```bash
# 1. Install playwright globally
bun add -g playwright

# 2. Set NODE_PATH (add to ~/.zshrc or ~/.bash_profile)
export NODE_PATH="$HOME/.bun/install/global/node_modules"

# 3. Reload shell
source ~/.zshrc

# 4. Install Chromium browser
bunx playwright install chromium
```

**Browser doesn't open**
```bash
# Install all browsers
bunx playwright install
```

### Apple Silicon: "Bad CPU type"

You downloaded the Intel version. Download `macos-arm64` instead.

### Intel Mac: "Bad CPU type"

You downloaded the ARM version. Download `macos-x64` instead.

---

## Updating

1. Download the new version
2. Remove quarantine: `xattr -d com.apple.quarantine ./supertag*`
3. Replace the old binaries (symlinks will still work)
4. Verify: `supertag --version`

---

## Uninstalling

```bash
# Remove binaries
rm -rf ~/Tools/supertag-cli

# Remove symlinks
sudo rm /usr/local/bin/supertag /usr/local/bin/supertag-export /usr/local/bin/supertag-mcp

# Remove data (optional)
rm -rf ~/.config/supertag ~/.local/share/supertag ~/.cache/supertag

# Remove launch agent (if configured)
launchctl unload ~/Library/LaunchAgents/com.supertag.export.plist
rm ~/Library/LaunchAgents/com.supertag.export.plist
```

---

## Getting Help

- [Main README](../README.md)
- [Getting Started Guide](./GETTING-STARTED.md)
- [Launchd Setup](./LAUNCHD-SETUP.md)
- [GitHub Issues](https://github.com/jcfischer/supertag-cli/issues)
