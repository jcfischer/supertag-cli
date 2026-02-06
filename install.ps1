#Requires -Version 5.1
<#
.SYNOPSIS
    Installs supertag-cli and all dependencies (Bun, Playwright, Chromium)

.DESCRIPTION
    This script installs supertag-cli and its dependencies on Windows.
    It handles Bun runtime installation, Playwright, Chromium browser,
    and optionally configures MCP for Claude Desktop, Cursor, and Claude Code.

.PARAMETER Version
    Specific version to install (default: latest)

.PARAMETER NoMcp
    Skip MCP auto-configuration

.PARAMETER Proxy
    HTTP proxy URL for corporate networks (e.g. http://proxy:8080)

.EXAMPLE
    irm https://raw.githubusercontent.com/jcfischer/supertag-cli/main/install.ps1 | iex

.EXAMPLE
    .\install.ps1 -Version 0.16.0

.EXAMPLE
    .\install.ps1 -NoMcp

.EXAMPLE
    .\install.ps1 -Proxy http://your-proxy:8080
#>

[CmdletBinding()]
param(
    [string]$Version = "latest",
    [switch]$NoMcp,
    [switch]$Help,
    [string]$Proxy
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# PowerShell 5.1 defaults to TLS 1.0/1.1 — GitHub requires TLS 1.2+
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# =============================================================================
# Configuration
# =============================================================================

$Script:InstallDir = "$env:USERPROFILE\Tools\supertag-cli"
$Script:GitHubRepo = "jcfischer/supertag-cli"

# =============================================================================
# Utility Functions
# =============================================================================

function Write-Info {
    param([string]$Message)
    Write-Host "      → " -ForegroundColor Cyan -NoNewline
    Write-Host $Message
}

function Write-Success {
    param([string]$Message)
    Write-Host "      ✓ " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warning {
    param([string]$Message)
    Write-Host "      ⚠ " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Error {
    param([string]$Message)
    Write-Host "      ✗ " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Write-Step {
    param([string]$Step, [string]$Description)
    Write-Host ""
    Write-Host "[$Step] " -ForegroundColor White -NoNewline
    Write-Host $Description -ForegroundColor White
}

function Test-Command {
    param([string]$Command)
    $null = Get-Command $Command -ErrorAction SilentlyContinue
    return $?
}

function Get-ProxyParams {
    $params = @{}
    if ($Script:Proxy) {
        $params["Proxy"] = $Script:Proxy
        $params["ProxyUseDefaultCredentials"] = $true
    }
    return $params
}

function Invoke-Download {
    param(
        [string]$Uri,
        [string]$OutFile,
        [hashtable]$Headers = @{}
    )
    $proxyParams = Get-ProxyParams
    try {
        if ($OutFile) {
            Invoke-WebRequest -Uri $Uri -OutFile $OutFile -UseBasicParsing -Headers $Headers @proxyParams
        } else {
            Invoke-RestMethod -Uri $Uri -Headers $Headers @proxyParams
        }
    } catch [System.Net.WebException] {
        $response = $_.Exception.Response
        $status = if ($response) { [int]$response.StatusCode } else { 0 }
        if ($status -eq 302 -or $status -eq 407 -or $_.Exception.Message -match "proxy|Umbrella|Zscaler|Forcepoint|gateway") {
            Write-Error "HTTP request to $Uri was blocked (possibly by a corporate proxy/firewall)."
            Write-Host ""
            Write-Host "      Workarounds:" -ForegroundColor Yellow
            Write-Host "        1. Try with explicit proxy:  .\install.ps1 -Proxy http://your-proxy:8080"
            Write-Host "        2. Download manually from:   https://github.com/$Script:GitHubRepo/releases/latest"
            Write-Host "        3. See: https://github.com/$Script:GitHubRepo/blob/main/docs/INSTALL-WINDOWS.md#corporate-proxy"
            Write-Host ""
            throw "Download blocked by proxy/firewall: $Uri"
        }
        throw
    }
}

function Get-Confirmation {
    param(
        [string]$Prompt,
        [bool]$Default = $true
    )

    $suffix = if ($Default) { "[Y/n]" } else { "[y/N]" }
    $response = Read-Host "      $Prompt $suffix"

    if ([string]::IsNullOrWhiteSpace($response)) {
        return $Default
    }

    return $response -match "^[Yy]"
}

# =============================================================================
# Detection Functions
# =============================================================================

function Get-Platform {
    # Try .NET RuntimeInformation first (PowerShell 7+ / .NET Core)
    try {
        $arch = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
        switch ($arch) {
            "X64" { return "windows-x64" }
            "Arm64" { return "windows-arm64" }
        }
    } catch { }

    # Fallback for Windows PowerShell 5.1 (.NET Framework)
    $envArch = $env:PROCESSOR_ARCHITECTURE
    switch ($envArch) {
        "AMD64" { return "windows-x64" }
        "ARM64" { return "windows-arm64" }
        "x86" {
            # 32-bit PowerShell on 64-bit OS reports x86, check real arch
            if ($env:PROCESSOR_ARCHITEW6432 -eq "AMD64") {
                return "windows-x64"
            }
            throw "Unsupported architecture: x86 (32-bit Windows is not supported)"
        }
        default { throw "Unsupported architecture: $envArch" }
    }
}

function Test-BunInstalled {
    return Test-Command "bun"
}

function Test-PlaywrightInstalled {
    if (-not (Test-BunInstalled)) { return $false }
    $result = bun pm ls -g 2>$null | Select-String "playwright"
    return $null -ne $result
}

function Test-ChromiumInstalled {
    $cacheDir = "$env:LOCALAPPDATA\ms-playwright"
    return (Test-Path $cacheDir) -and ((Get-ChildItem $cacheDir -ErrorAction SilentlyContinue).Count -gt 0)
}

function Get-InstalledVersion {
    $supertag = Join-Path $Script:InstallDir "supertag.exe"
    if (Test-Path $supertag) {
        try {
            $output = & $supertag --version 2>$null
            if ($output -match '(\d+\.\d+\.\d+)') {
                return $Matches[1]
            }
        } catch { }
    }
    return $null
}

function Resolve-Version {
    param([string]$Requested)

    if ($Requested -eq "latest") {
        try {
            $headers = @{ "User-Agent" = "supertag-cli-installer" }
            $release = Invoke-Download -Uri "https://api.github.com/repos/$Script:GitHubRepo/releases/latest" -Headers $headers
            $tag = $release.tag_name -replace '^v', ''
            return $tag
        } catch {
            throw "Could not fetch latest version from GitHub: $($_.Exception.Message)"
        }
    }

    return $Requested -replace '^v', ''
}

# =============================================================================
# Installation Functions
# =============================================================================

function Install-Bun {
    if (Test-BunInstalled) {
        $version = (bun --version 2>$null) -join ""
        Write-Success "Bun v$version already installed (skipping)"
        return
    }

    Write-Info "Downloading Bun installer..."
    try {
        irm bun.sh/install.ps1 | iex
    } catch {
        throw "Failed to install Bun. Visit https://bun.sh/docs/installation for manual installation."
    }

    # Refresh PATH
    $env:BUN_INSTALL = "$env:USERPROFILE\.bun"
    $env:PATH = "$env:BUN_INSTALL\bin;$env:PATH"

    if (-not (Test-BunInstalled)) {
        throw "Bun installation completed but 'bun' command not found. Please restart your terminal."
    }

    $version = (bun --version 2>$null) -join ""
    Write-Success "Bun v$version installed"
}

function Install-Playwright {
    if (Test-PlaywrightInstalled) {
        Write-Success "Playwright already installed (skipping)"
        return
    }

    Write-Info "Installing Playwright globally..."
    try {
        bun add -g playwright
    } catch {
        throw "Failed to install Playwright. Try: bun add -g playwright"
    }

    Write-Success "Playwright installed"
}

function Install-Chromium {
    if (Test-ChromiumInstalled) {
        Write-Success "Chromium already installed (skipping)"
        return
    }

    Write-Info "Installing Chromium browser (this may take a minute)..."
    try {
        bunx playwright install chromium
    } catch {
        throw "Failed to install Chromium. Try: bunx playwright install chromium"
    }

    Write-Success "Chromium installed"
}

function Install-Supertag {
    param(
        [string]$Version,
        [string]$Platform
    )

    $installedVersion = Get-InstalledVersion

    if ($installedVersion -eq $Version) {
        Write-Success "supertag-cli v$Version already installed (skipping)"
        return
    }

    if ($installedVersion) {
        Write-Info "Updating from v$installedVersion to v$Version"
    }

    $downloadUrl = "https://github.com/$Script:GitHubRepo/releases/download/v$Version/supertag-cli-v$Version-$Platform.zip"
    $tempDir = Join-Path $env:TEMP "supertag-install-$(Get-Random)"
    $zipFile = Join-Path $tempDir "supertag-cli.zip"

    Write-Info "Downloading supertag-cli v$Version for $Platform..."

    try {
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        $headers = @{ "User-Agent" = "supertag-cli-installer" }
        Invoke-Download -Uri $downloadUrl -OutFile $zipFile -Headers $headers
    } catch {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        throw "Failed to download from $downloadUrl`: $($_.Exception.Message)"
    }

    Write-Info "Extracting to $Script:InstallDir..."

    try {
        New-Item -ItemType Directory -Path $Script:InstallDir -Force | Out-Null
        Expand-Archive -Path $zipFile -DestinationPath $tempDir -Force

        # Find and copy executables
        $exes = Get-ChildItem -Path $tempDir -Filter "*.exe" -Recurse
        foreach ($exe in $exes) {
            Copy-Item -Path $exe.FullName -Destination $Script:InstallDir -Force
        }
    } catch {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
        throw "Failed to extract archive"
    }

    Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    Write-Success "supertag-cli v$Version installed to $Script:InstallDir"
}

function Set-PathConfiguration {
    $currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")

    if ($currentPath -like "*$Script:InstallDir*") {
        Write-Success "PATH already configured (skipping)"
        return
    }

    Write-Info "Adding $Script:InstallDir to PATH..."

    $newPath = "$currentPath;$Script:InstallDir"
    [Environment]::SetEnvironmentVariable("PATH", $newPath, "User")

    # Also update current session
    $env:PATH = "$env:PATH;$Script:InstallDir"

    Write-Success "Added to PATH"
    Write-Warning "Open a new terminal for PATH changes to take effect"
}

function Set-NodePathConfiguration {
    $bunGlobalDir = "$env:USERPROFILE\.bun\install\global\node_modules"
    $currentNodePath = [Environment]::GetEnvironmentVariable("NODE_PATH", "User")

    if ($currentNodePath -like "*bun*") {
        return
    }

    $newNodePath = if ($currentNodePath) {
        "$bunGlobalDir;$currentNodePath"
    } else {
        $bunGlobalDir
    }

    [Environment]::SetEnvironmentVariable("NODE_PATH", $newNodePath, "User")
    $env:NODE_PATH = $newNodePath

    Write-Success "NODE_PATH configured"
}

# =============================================================================
# MCP Configuration
# =============================================================================

function Set-McpConfiguration {
    $mcpPath = Join-Path $Script:InstallDir "supertag-mcp.exe"
    $configured = @()

    # Claude Desktop
    $claudeConfig = "$env:APPDATA\Claude\claude_desktop_config.json"
    if (Test-Path (Split-Path $claudeConfig -Parent)) {
        if (Set-McpClientConfig -ConfigFile $claudeConfig -McpPath $mcpPath) {
            $configured += "Claude Desktop"
        }
    }

    # Cursor
    $cursorConfig = "$env:APPDATA\Cursor\User\globalStorage\cursor-mcp\config.json"
    if (Test-Path (Split-Path $cursorConfig -Parent)) {
        if (Set-McpClientConfig -ConfigFile $cursorConfig -McpPath $mcpPath) {
            $configured += "Cursor"
        }
    }

    # Claude Code
    $claudeCodeConfig = "$env:USERPROFILE\.claude.json"
    if (Test-Path $claudeCodeConfig) {
        if (Set-McpClientConfig -ConfigFile $claudeCodeConfig -McpPath $mcpPath) {
            $configured += "Claude Code"
        }
    }

    if ($configured.Count -eq 0) {
        Write-Info "No MCP clients found. You can configure manually later."
    } else {
        Write-Success "MCP configured for: $($configured -join ', ')"
    }
}

function ConvertTo-HashtableRecursive {
    param([Parameter(ValueFromPipeline)]$InputObject)
    if ($null -eq $InputObject) { return @{} }
    if ($InputObject -is [System.Collections.IDictionary]) { return $InputObject }
    $hash = @{}
    foreach ($prop in $InputObject.PSObject.Properties) {
        if ($prop.Value -is [PSCustomObject]) {
            $hash[$prop.Name] = ConvertTo-HashtableRecursive $prop.Value
        } else {
            $hash[$prop.Name] = $prop.Value
        }
    }
    return $hash
}

function Set-McpClientConfig {
    param(
        [string]$ConfigFile,
        [string]$McpPath
    )

    try {
        # Create backup if exists
        if (Test-Path $ConfigFile) {
            $timestamp = Get-Date -Format "yyyyMMddHHmmss"
            Copy-Item -Path $ConfigFile -Destination "$ConfigFile.backup.$timestamp"
        }

        # Load or create config (compatible with PowerShell 5.1+)
        if (Test-Path $ConfigFile) {
            $json = Get-Content $ConfigFile -Raw | ConvertFrom-Json
            $config = ConvertTo-HashtableRecursive $json
        } else {
            $config = @{}
        }

        if (-not $config.ContainsKey("mcpServers")) {
            $config["mcpServers"] = @{}
        }

        if (-not $config["mcpServers"].ContainsKey("supertag")) {
            $config["mcpServers"]["supertag"] = @{
                command = $McpPath
            }

            # Ensure directory exists
            $configDir = Split-Path $ConfigFile -Parent
            if (-not (Test-Path $configDir)) {
                New-Item -ItemType Directory -Path $configDir -Force | Out-Null
            }

            $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile
            return $true
        } else {
            # Update path if different
            if ($config["mcpServers"]["supertag"]["command"] -ne $McpPath) {
                $config["mcpServers"]["supertag"]["command"] = $McpPath
                $config | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile
                return $true
            }
            Write-Info "supertag already configured in $(Split-Path $ConfigFile -Leaf)"
            return $true
        }
    } catch {
        Write-Warning "Could not configure $ConfigFile`: $_"
        return $false
    }
}

# =============================================================================
# Verification
# =============================================================================

function Test-Installation {
    Write-Host ""
    Write-Info "Verifying installation..."

    $allGood = $true

    # Check supertag binary
    $supertag = Join-Path $Script:InstallDir "supertag.exe"
    if (Test-Path $supertag) {
        try {
            $version = (& $supertag --version 2>$null) -join ""
            Write-Success "supertag: $version"
        } catch {
            Write-Success "supertag: ready"
        }
    } else {
        Write-Error "supertag binary not found"
        $allGood = $false
    }

    # Check supertag-export
    $supertagExport = Join-Path $Script:InstallDir "supertag-export.exe"
    if (Test-Path $supertagExport) {
        Write-Success "supertag-export: ready"
    } else {
        Write-Warning "supertag-export not found (optional)"
    }

    # Check supertag-mcp
    $supertagMcp = Join-Path $Script:InstallDir "supertag-mcp.exe"
    if (Test-Path $supertagMcp) {
        Write-Success "supertag-mcp: ready"
    } else {
        Write-Warning "supertag-mcp not found (optional)"
    }

    # Check if in PATH
    if (Test-Command "supertag") {
        Write-Success "supertag in PATH"
    } else {
        Write-Warning "supertag not in PATH yet (open a new terminal)"
    }

    if (-not $allGood) {
        throw "Installation verification failed"
    }
}

# =============================================================================
# Output
# =============================================================================

function Write-Banner {
    Write-Host ""
    Write-Host "Installing supertag-cli" -ForegroundColor White
    Write-Host ""
}

function Write-SuccessBanner {
    Write-Host ""
    Write-Host "Installation complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Commands installed:"
    Write-Host "    supertag        - Query your Tana graph"
    Write-Host "    supertag-export - Export Tana data"
    Write-Host "    supertag-mcp    - MCP server for AI tools"
    Write-Host ""
    Write-Host "  Next steps:"
    Write-Host "    1. Open a new PowerShell window"
    Write-Host "    2. Run: supertag-export login"
    Write-Host "    3. Run: supertag-export discover"
    Write-Host ""
    Write-Host "  Documentation: " -NoNewline
    Write-Host "https://github.com/$Script:GitHubRepo" -ForegroundColor Cyan
    Write-Host ""
}

function Write-HelpMessage {
    Write-Host "supertag-cli installer"
    Write-Host ""
    Write-Host "Usage: install.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Version VERSION  Install specific version (default: latest)"
    Write-Host "  -NoMcp            Skip MCP auto-configuration"
    Write-Host "  -Proxy URL        Use HTTP proxy for downloads (e.g. http://proxy:8080)"
    Write-Host "  -Help             Show this help message"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  irm https://raw.githubusercontent.com/$Script:GitHubRepo/main/install.ps1 | iex"
    Write-Host "  .\install.ps1 -Version 0.16.0"
    Write-Host "  .\install.ps1 -Proxy http://your-proxy:8080"
    Write-Host ""
}

# =============================================================================
# Main
# =============================================================================

function Main {
    if ($Help) {
        Write-HelpMessage
        return
    }

    # Store proxy at script scope for helper functions
    if ($Proxy) {
        $Script:Proxy = $Proxy
    }

    Write-Banner

    $platform = Get-Platform
    Write-Info "Detected platform: $platform"

    $resolvedVersion = Resolve-Version -Requested $Version
    Write-Info "Target version: v$resolvedVersion"

    Write-Step "1/6" "Installing Bun"
    Install-Bun

    Write-Step "2/6" "Installing Playwright"
    Install-Playwright

    Write-Step "3/6" "Installing Chromium"
    Install-Chromium

    Write-Step "4/6" "Downloading supertag-cli"
    Install-Supertag -Version $resolvedVersion -Platform $platform

    Write-Step "5/6" "Configuring PATH"
    Set-PathConfiguration
    Set-NodePathConfiguration

    if (-not $NoMcp) {
        Write-Step "6/6" "Configuring MCP"
        Set-McpConfiguration
    }

    Test-Installation
    Write-SuccessBanner
}

Main
