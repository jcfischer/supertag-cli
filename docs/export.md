# Export - Automated Backup

The `supertag-export` tool provides automated Tana workspace export using browser automation (Playwright).

## Quick Start

```bash
# First-time login (opens browser, saves session)
supertag-export login

# Export your workspace
supertag-export run

# Index the export
supertag sync index
```

---

## Commands

### Login

Opens a browser window for Tana authentication. Your session is saved for future exports.

```bash
supertag-export login
```

**Note:** Chromium (~300 MB) auto-installs on first run. You can also run `supertag-export setup` to install it explicitly.

### Status

Check authentication status and session info:

```bash
supertag-export status
```

### Discover

Find all Tana workspaces:

```bash
# Discover workspaces
supertag-export discover

# Discover and add all workspaces
supertag-export discover --add
```

### Run Export

```bash
# Export default workspace
supertag-export run

# Export with verbose output (shows auth method)
supertag-export run -v

# Export all enabled workspaces
supertag-export run --all

# Export specific workspace
supertag-export run -w personal
```

---

## Authentication Flow

Authentication is automatic (no user action needed after initial login):

| Method | Speed | Description |
|--------|-------|-------------|
| Cached token | ~0.7s | Uses previously saved token |
| API refresh | ~1.0s | Refreshes expired token via Firebase API |
| Browser extraction | ~8s | Falls back to browser if needed |

The `-v` flag shows which auth method was used.

---

## Export Location

Tana JSON exports are stored at:

```
~/Documents/Tana-Export/
├── main/
│   └── M9rkJkwuED@2025-12-12.json
├── work/
│   └── xyz123@2025-12-12.json
└── ...
```

Files are named: `{rootFileId}@{date}.json`

---

## Daily Automation

### Combined Workflow

Run export, sync, and cleanup in sequence:

```bash
# Full daily workflow
supertag-export run && supertag sync index && supertag sync cleanup

# Export all workspaces
supertag-export run --all && supertag sync index --all && supertag sync cleanup --all

# Export only (no indexing)
supertag-export run

# Index only (after manual export)
supertag sync index

# Cleanup only
supertag sync cleanup
```

### Export Cleanup

Remove old export files to save disk space:

```bash
# Dry run (show what would be deleted)
supertag sync cleanup --dry-run

# Keep last 7 files (default)
supertag sync cleanup

# Keep custom number
supertag sync cleanup --keep 5

# Clean all workspaces
supertag sync cleanup --all
```

### macOS LaunchAgent (Automated Scheduling)

Use the install script to set up automated sync (runs every 6 hours):

```bash
# Install the daily sync scheduler
./scripts/install-launchd.sh daily

# Check status
launchctl list | grep supertag

# View logs
tail -f ~/.local/state/supertag/logs/supertag-daily.log
```

See [LAUNCHD-SETUP.md](./LAUNCHD-SETUP.md) for full documentation.

---

## Configuration

In `~/.config/supertag/config.json`:

```json
{
  "cleanup": {
    "keepCount": 7,
    "autoCleanup": false
  }
}
```

---

## Troubleshooting

### "Chromium not found"

Chromium auto-installs on first run. If auto-install fails:

```bash
# Explicit install
supertag-export setup

# Or manual install
bunx playwright install chromium
```

### Session Expired

```bash
# Re-login
supertag-export login
```

---

## Performance

| Metric | Value |
|--------|-------|
| Export (large workspace) | 10-15 minutes |
| Indexing | 107k nodes/second |
| Database size | ~500 MB for 1M nodes |
