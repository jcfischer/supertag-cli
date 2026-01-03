---
id: "058"
feature: "Version Update Checker"
status: "draft"
created: "2025-12-31"
---

# Specification: Version Update Checker

## Overview

Notify users when a new version of Supertag CLI is available and provide platform-specific instructions for updating. This ensures users stay current with bug fixes, security patches, and new features without requiring manual version checking.

## User Scenarios

### Scenario 1: Passive Update Notification

**As a** Supertag CLI user
**I want to** be notified when a new version is available
**So that** I can decide whether to update without manually checking GitHub

**Acceptance Criteria:**
- [ ] Notification appears when running common commands (search, stats, etc.)
- [ ] Notification is non-blocking (command executes normally)
- [ ] Notification shows current version, available version, and brief update command
- [ ] Notification only appears once per day (not on every command)
- [ ] Notification can be suppressed via config option

### Scenario 2: Explicit Version Check

**As a** Supertag CLI user
**I want to** explicitly check for updates
**So that** I can see detailed information about available updates

**Acceptance Criteria:**
- [ ] `supertag update check` shows current version, latest version, and changelog highlights
- [ ] Command shows platform-specific update instructions
- [ ] Command works offline (shows cached info or graceful error)
- [ ] Command shows release date and download size

### Scenario 3: Download Update

**As a** Supertag CLI user
**I want to** download the latest version easily
**So that** I don't have to navigate to GitHub manually

**Acceptance Criteria:**
- [ ] `supertag update download` downloads the correct platform binary
- [ ] Progress indicator shows download status
- [ ] Downloaded file is placed in a sensible location with clear instructions
- [ ] Checksum verification ensures download integrity

### Scenario 4: Self-Update (Optional/Advanced)

**As a** power user
**I want to** update the CLI in-place
**So that** I can update with a single command

**Acceptance Criteria:**
- [ ] `supertag update install` replaces the current binary with the new version
- [ ] Backup of current version is created before replacement
- [ ] Rollback is possible if update fails
- [ ] User is warned about permission requirements (may need sudo/admin)

### Scenario 5: MCP Server Update Awareness

**As an** MCP server user (Claude Desktop, etc.)
**I want** the MCP server to indicate when updates are available
**So that** AI tools can inform me about available updates

**Acceptance Criteria:**
- [ ] MCP server exposes version info via a tool or resource
- [ ] MCP server can report if an update is available
- [ ] Update check doesn't block MCP server startup or operations

## Functional Requirements

### FR-1: Version Check Against GitHub Releases

The system must check the GitHub Releases API for the latest version.

**Validation:**
- API call to `https://api.github.com/repos/jcfischer/supertag-cli/releases/latest` returns version info
- Handles rate limiting gracefully (GitHub allows 60 requests/hour unauthenticated)

### FR-2: Version Comparison

The system must compare semantic versions correctly.

**Validation:**
- `0.6.4` < `0.6.5` (patch)
- `0.6.5` < `0.7.0` (minor)
- `0.7.0` < `1.0.0` (major)
- Pre-release versions handled correctly (e.g., `0.7.0-beta.1`)

### FR-3: Check Result Caching

The system must cache version check results to avoid excessive API calls.

**Validation:**
- Cache stored in user's cache directory
- Cache expires after configurable period (default: 24 hours)
- Cache includes timestamp, latest version, download URLs, changelog

### FR-4: Platform Detection

The system must detect the current platform and provide correct download URL.

**Validation:**
- macOS ARM64: `supertag-cli-vX.Y.Z-macos-arm64.zip`
- macOS Intel: `supertag-cli-vX.Y.Z-macos-x64.zip`
- Linux x64: `supertag-cli-vX.Y.Z-linux-x64.zip`
- Windows x64: `supertag-cli-vX.Y.Z-windows-x64.zip`

### FR-5: Notification Throttling

The system must not annoy users with repeated notifications.

**Validation:**
- Passive notification shown at most once per 24 hours
- Notification timestamp stored in cache
- Config option to disable passive notifications entirely

### FR-6: Offline Resilience

The system must work gracefully when offline.

**Validation:**
- Commands don't fail if GitHub is unreachable
- Cached version info used when offline
- Clear message when no cached info and offline

### FR-7: Configuration Options

The system must allow user configuration of update behavior.

**Validation:**
- `supertag config --update-check <enabled|disabled|manual>` controls passive checks
- Config persists in `config.json`

## Non-Functional Requirements

- **Performance:** Version check must not add more than 500ms to command startup (use async/background check)
- **Security:** Download URLs must be HTTPS; checksums should be verified
- **Reliability:** Network failures must not crash the CLI or block operations
- **Privacy:** No telemetry or usage data sent; only fetches public GitHub API

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| VersionInfo | Information about a release | version, releaseDate, downloadUrls, changelog, checksum |
| UpdateCache | Cached version check result | checkedAt, latestVersion, notifiedAt |
| UpdateConfig | User preferences for updates | checkMode (enabled/disabled/manual) |

## Success Criteria

- [ ] Users see update notification within 24 hours of new release
- [ ] `supertag update check` returns accurate version info
- [ ] Zero commands fail due to update check (network resilience)
- [ ] Update check adds < 100ms to command execution (async)
- [ ] Platform-specific instructions are accurate for all 4 platforms

## Assumptions

- GitHub Releases API remains stable and accessible
- Semantic versioning is followed for all releases
- Binary distribution model continues (no package manager distribution yet)
- Users have internet access at least occasionally

## [NEEDS CLARIFICATION]

- Should `supertag update install` (self-update) be included in initial release, or deferred?
  -> included
- Should we support GitHub authentication for higher API rate limits?
  -> no
- What changelog information should be displayed (full notes vs. highlights)?
  -> full notes since current installed version
- Should the MCP server have its own update checking, or rely on main CLI?
  -> rely on main CLI

## Out of Scope

- Package manager integration (brew, apt, chocolatey, etc.)
- Automatic background updates without user action
- Delta/incremental updates (always full binary download)
- Update notifications for `supertag-export` or `supertag-mcp` separately (they share versions)
- Rollback to arbitrary previous versions (only immediate rollback after failed update)
