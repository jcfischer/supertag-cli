# Windows Installation Guide

This guide covers installing Supertag CLI on Windows 10/11.

---

## Quick Install (Recommended)

Run this command in PowerShell:

```powershell
irm https://raw.githubusercontent.com/jcfischer/supertag-cli/main/install.ps1 | iex
```

This automatically:
- Installs Bun runtime (if needed)
- Installs Playwright and Chromium browser
- Downloads supertag-cli for Windows x64
- Configures PATH
- Sets up MCP for Claude Desktop/Cursor (if installed)

**After installation**, open a **new** PowerShell window and verify:
```powershell
supertag --version
```

If this works, skip to [Step 3: Configure API Token](#step-3-configure-api-token).

---

## Manual Installation

If the quick install doesn't work, follow these manual steps.

### Prerequisites

- Windows 10 (1809+) or Windows 11
- PowerShell 5.1+ (included with Windows)
- Administrator access (for some steps)

---

### Step 1: Download and Extract

1. Go to [GitHub Releases](https://github.com/jcfischer/supertag-cli/releases)
2. Download `supertag-cli-vX.Y.Z-windows-x64.zip`
3. Extract to a permanent location

### Recommended Installation Paths

| Option | Path | When to use |
|--------|------|-------------|
| **User install** | `C:\Users\<YourName>\Tools\supertag-cli` | Personal use, no admin needed |
| **System install** | `C:\Program Files\supertag-cli` | Shared computer, requires admin |
| **Portable** | `D:\Tools\supertag-cli` | Keep on external drive |

**Example - User install:**

```powershell
# Create Tools directory
mkdir "$env:USERPROFILE\Tools"

# Extract (right-click zip → Extract All → choose location)
# Or use PowerShell:
Expand-Archive -Path "$env:USERPROFILE\Downloads\supertag-cli-v*.zip" -DestinationPath "$env:USERPROFILE\Tools"

# Verify
dir "$env:USERPROFILE\Tools\supertag-cli-windows-x64"
```

You should see three executables:
- `supertag.exe` - Main CLI
- `supertag-export.exe` - Browser automation
- `supertag-mcp.exe` - MCP server

---

### Step 2: Add to PATH

Adding Supertag to your PATH lets you run it from any directory.

### Option A: User PATH (Recommended)

Open PowerShell and run:

```powershell
# Replace with your actual installation path
$SupertagPath = "$env:USERPROFILE\Tools\supertag-cli-windows-x64"

# Add to User PATH (persists across sessions)
$CurrentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($CurrentPath -notlike "*$SupertagPath*") {
    [Environment]::SetEnvironmentVariable("PATH", "$CurrentPath;$SupertagPath", "User")
    Write-Host "Added to PATH successfully!" -ForegroundColor Green
} else {
    Write-Host "Already in PATH" -ForegroundColor Yellow
}

# Apply to current session
$env:PATH += ";$SupertagPath"
```

### Option B: System PATH (requires Administrator)

1. Press `Win + X` → Select **Terminal (Admin)** or **PowerShell (Admin)**
2. Run:

```powershell
$SupertagPath = "C:\Program Files\supertag-cli"
$CurrentPath = [Environment]::GetEnvironmentVariable("PATH", "Machine")
[Environment]::SetEnvironmentVariable("PATH", "$CurrentPath;$SupertagPath", "Machine")
```

### Option C: Using Windows Settings UI

1. Press `Win + S` and search for "environment variables"
2. Click **Edit the system environment variables**
3. Click **Environment Variables...**
4. Under **User variables**, select **Path** and click **Edit**
5. Click **New** and add your Supertag path (e.g., `C:\Users\YourName\Tools\supertag-cli-windows-x64`)
6. Click **OK** on all dialogs
7. **Restart PowerShell** for changes to take effect

### Verify PATH Configuration

Open a **new** PowerShell window and run:

```powershell
supertag --version
```

You should see the version number (e.g., `0.6.4`).

---

### Step 3: Configure API Token

Get your Tana API token from: https://app.tana.inc/?bundle=settings&panel=api

### Option A: CLI Command (Recommended)

```powershell
.\supertag config --token "your_token_here"
```

This saves the token to the config file at `%APPDATA%\supertag\config.json`.

### Option B: Environment Variable

```powershell
# Set permanently for your user account
[Environment]::SetEnvironmentVariable("TANA_API_TOKEN", "your_token_here", "User")

# Apply to current session
$env:TANA_API_TOKEN = "your_token_here"

# Verify
echo $env:TANA_API_TOKEN
```

---

### Step 4: Install Playwright (Required for Export)

The `supertag-export` tool uses Playwright for browser automation. Due to Playwright's native dependencies, it must be installed globally.

### Option A: Using Bun (Recommended)

Bun is a fast JavaScript runtime that works well with Playwright.

1. **Install Bun:**

   Open PowerShell and run:
   ```powershell
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

   Or with npm if you have Node.js:
   ```powershell
   npm install -g bun
   ```

2. **Restart PowerShell** (important!)

3. **Install Playwright globally:**
   ```powershell
   bun add -g playwright
   ```

4. **Configure NODE_PATH:**

   The compiled binary needs NODE_PATH to find the global playwright package:
   ```powershell
   [Environment]::SetEnvironmentVariable("NODE_PATH", "$env:USERPROFILE\.bun\install\global\node_modules", "User")
   ```

5. **Restart PowerShell** (important!)

6. **Install Chromium browser:**
   ```powershell
   bunx playwright install chromium
   ```

   This downloads Chromium to:
   `C:\Users\<YourName>\AppData\Local\ms-playwright\chromium-*`

7. **Verify:**
   ```powershell
   supertag-export --help
   supertag-export login
   ```
   A browser window should open.

### Option B: Using Node.js

1. **Install Node.js:**
   - Download from https://nodejs.org (LTS version recommended)
   - Run the installer with default options

2. **Open a new PowerShell window**

3. **Install Playwright globally:**
   ```powershell
   npm install -g playwright
   ```

4. **Configure NODE_PATH:**
   ```powershell
   [Environment]::SetEnvironmentVariable("NODE_PATH", "$env:APPDATA\npm\node_modules", "User")
   ```

5. **Restart PowerShell**

6. **Install Chromium browser:**
   ```powershell
   npx playwright install chromium
   ```

7. **Verify:**
   ```powershell
   supertag-export --help
   supertag-export login
   ```

### Troubleshooting Playwright

**Error: "Cannot find package 'playwright'"**

This usually means playwright isn't installed globally or NODE_PATH isn't set:

1. Install globally: `bun add -g playwright` (or `npm install -g playwright`)
2. Set NODE_PATH (see steps above)
3. Restart PowerShell
4. Install browser: `bunx playwright install chromium`

**Error: "Executable doesn't exist"**

Run the install command again:
```powershell
bunx playwright install chromium
# or
npx playwright install chromium
```

**Browser window doesn't open**

Try installing all browsers:
```powershell
bunx playwright install
```

---

### Step 5: Set Up Export Directory

Supertag expects Tana exports in a specific location:

```powershell
# Create export directory
mkdir "$env:USERPROFILE\Documents\Tana-Export\main" -ErrorAction SilentlyContinue
```

---

### Step 6: First Run

Now let's verify everything works:

```powershell
# 1. Check CLI version
supertag --version

# 2. Login to Tana (opens browser)
supertag-export login

# 3. Discover your workspaces
supertag-export discover

# 4. Export your data
supertag-export run

# 5. Index the export
supertag sync index

# 6. Test a search
supertag search "test"
```

---

## Alternative: Manual Export (No Playwright Required)

If you don't want to install Bun/Node.js, you can export manually from Tana:

1. Open Tana in your browser
2. Go to **Settings** (gear icon) → **Export**
3. Select **JSON** format
4. Click **Export**
5. Save the file to `%USERPROFILE%\Documents\Tana-Export\main\`
   - Name format: `{workspaceId}@{date}.json`
6. Run:
   ```powershell
   supertag sync index
   ```

This works for one-time exports. For automated/scheduled exports, Playwright is recommended.

---

## MCP Server Setup (Optional)

To use Supertag with AI tools like Claude Desktop:

### Claude Desktop

1. Find your Claude Desktop config:
   ```powershell
   notepad "$env:APPDATA\Claude\claude_desktop_config.json"
   ```

2. Add the MCP server configuration:
   ```json
   {
     "mcpServers": {
       "tana": {
         "command": "C:\\Users\\YourName\\Tools\\supertag-cli-windows-x64\\supertag-mcp.exe",
         "env": {
           "TANA_API_TOKEN": "your_token_here"
         }
       }
     }
   }
   ```

   **Note:** Use double backslashes (`\\`) in JSON paths.

3. Restart Claude Desktop

See [MCP Documentation](./mcp.md) for other AI tools.

---

## File Locations on Windows

| Type | Location |
|------|----------|
| Config | `%APPDATA%\supertag\config.json` |
| Database | `%LOCALAPPDATA%\supertag\workspaces\main\tana-index.db` |
| Cache | `%LOCALAPPDATA%\supertag\cache\` |
| Exports | `%USERPROFILE%\Documents\Tana-Export\main\` |
| Playwright | `%LOCALAPPDATA%\ms-playwright\` |

---

## Troubleshooting

### Corporate Proxy / Firewall

If the quick install fails with errors like "302 Moved Temporarily", "Umbrella Cloud Security Gateway", or `WebException`, your corporate proxy is likely blocking `raw.githubusercontent.com`.

**Option 1: Download the installer manually**

```powershell
# Download install.ps1 from GitHub (use a browser if PowerShell is blocked)
# https://github.com/jcfischer/supertag-cli/blob/main/install.ps1
# Save to Downloads, then run:
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
& "$env:USERPROFILE\Downloads\install.ps1"
```

**Option 2: Use explicit proxy**

If you know your proxy URL:
```powershell
# Download and run with proxy
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$proxy = "http://your-proxy-server:8080"
iwr -Proxy $proxy -Uri "https://raw.githubusercontent.com/jcfischer/supertag-cli/main/install.ps1" -OutFile install.ps1
.\install.ps1 -Proxy $proxy
```

**Option 3: Manual install (no scripts needed)**

1. Download the ZIP from [GitHub Releases](https://github.com/jcfischer/supertag-cli/releases/latest) using your browser
2. Extract to `%USERPROFILE%\Tools\supertag-cli`
3. Follow [Step 2: Add to PATH](#step-2-add-to-path) below

**Finding your proxy URL:**
```powershell
# Check system proxy settings
netsh winhttp show proxy
# Or check environment variable
echo $env:HTTP_PROXY
```

---

### "Cannot require module @lancedb/lancedb-win32-x64-msvc"

This error affects versions before v1.6.4 due to cross-compilation issues with native modules.

**Solution:** Download v1.6.4 or later from [GitHub Releases](https://github.com/jcfischer/supertag-cli/releases).

**Workaround for older versions:**
1. Most features still work - only `embed` commands and `--semantic` search are affected
2. Use regular search: `supertag search "meeting"` (not `supertag search "meeting" --semantic`)

Or run from source:
```powershell
# Install Bun
powershell -c "irm bun.sh/install.ps1 | iex"

# Clone and run from source
git clone https://github.com/jcfischer/supertag-cli.git
cd supertag-cli
bun install
bun run src/index.ts --version
```

---

### "supertag is not recognized"

PATH not configured. Either:
- Open a new PowerShell window (PATH changes require restart)
- Run from the installation directory: `.\supertag.exe --version`
- Follow [Step 2](#step-2-add-to-path) again

### "API token not configured"

Set the environment variable:
```powershell
[Environment]::SetEnvironmentVariable("TANA_API_TOKEN", "your_token", "User")
# Restart PowerShell
```

### "Database not found"

Run the indexer first:
```powershell
supertag sync index
```

### PowerShell Execution Policy Error

If you see "script cannot be loaded because running scripts is disabled":

```powershell
# Allow scripts for current user
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Antivirus/Defender Warnings

Some antivirus software may flag the executables because they're unsigned. You may need to:
1. Add an exclusion for the Supertag installation directory
2. Or allow the specific executables when prompted

---

## Updating Supertag

1. Download the new version from [GitHub Releases](https://github.com/jcfischer/supertag-cli/releases)
2. Extract to the same location (overwrite existing files)
3. Verify: `supertag --version`

Your configuration, database, and exports are stored separately and will be preserved.

---

## Uninstalling

1. Remove the installation directory
2. Remove from PATH (reverse of [Step 2](#step-2-add-to-path))
3. Optionally remove data:
   ```powershell
   Remove-Item -Recurse "$env:APPDATA\supertag"
   Remove-Item -Recurse "$env:LOCALAPPDATA\supertag"
   ```

---

## Getting Help

- [Main README](../README.md)
- [Getting Started Guide](./GETTING-STARTED.md)
- [GitHub Issues](https://github.com/jcfischer/supertag-cli/issues)
