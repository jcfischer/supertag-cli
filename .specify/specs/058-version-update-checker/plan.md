---
feature: "Version Update Checker"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Version Update Checker

## Architecture Overview

Library-first design with a core update service that handles version checking, caching, and download logic. CLI commands wrap this service, and passive notifications hook into the main CLI entry point.

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Entry Point                         │
│                       (src/index.ts)                         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Passive Check Hook (async, non-blocking)           │    │
│  │  - Check cache age → fetch if stale → notify if new │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Update Commands                           │
│                  (src/commands/update.ts)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │  check   │  │ download │  │ install  │                   │
│  └──────────┘  └──────────┘  └──────────┘                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Update Service                             │
│               (src/services/update.ts)                       │
│  ┌───────────────────┐  ┌───────────────────┐               │
│  │  VersionChecker   │  │  UpdateInstaller  │               │
│  │  - fetchLatest()  │  │  - download()     │               │
│  │  - compare()      │  │  - verify()       │               │
│  │  - getCache()     │  │  - backup()       │               │
│  │  - setCache()     │  │  - install()      │               │
│  └───────────────────┘  └───────────────────┘               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    External APIs                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  GitHub Releases API                                   │  │
│  │  GET /repos/jcfischer/supertag-cli/releases/latest    │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  GitHub Release Assets (HTTPS download)                │  │
│  │  https://github.com/.../releases/download/vX.Y.Z/...  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | Project standard |
| Runtime | Bun | Project standard, native fetch |
| HTTP Client | Native fetch | Built into Bun, no dependencies |
| Semver | Custom comparison | Avoid dependency for simple comparison |
| Cache | JSON file | Simple, human-readable, no DB needed |
| Download | Bun.write + fetch | Native streaming download |

## Constitutional Compliance

- [x] **CLI-First:** `supertag update check|download|install` commands
- [x] **Library-First:** Core logic in `src/services/update.ts`, usable by CLI and tests
- [x] **Test-First:** Unit tests for version comparison, integration tests for full flow
- [x] **Deterministic:** Version comparison is deterministic; network calls have cached fallbacks
- [x] **Code Before Prompts:** All logic in TypeScript, no LLM involvement

## Data Model

### Entities

```typescript
// GitHub Release response (partial)
interface GitHubRelease {
  tag_name: string;          // "v1.3.2"
  name: string;              // "Release 1.3.2"
  published_at: string;      // ISO date
  body: string;              // Markdown changelog
  assets: GitHubAsset[];
}

interface GitHubAsset {
  name: string;              // "supertag-cli-v1.3.2-macos-arm64.zip"
  browser_download_url: string;
  size: number;              // bytes
}

// Cached version info
interface UpdateCache {
  checkedAt: string;         // ISO timestamp
  notifiedAt: string | null; // Last time user was notified
  latestVersion: string;     // "1.3.2" (without 'v' prefix)
  currentVersion: string;    // Version at check time
  releaseDate: string;       // ISO timestamp
  changelog: string[];       // First 5 bullet points
  assets: {
    platform: Platform;
    url: string;
    size: number;
    filename: string;
  }[];
}

type Platform = 'macos-arm64' | 'macos-x64' | 'linux-x64' | 'windows-x64';

// Update check config
interface UpdateConfig {
  checkMode: 'enabled' | 'disabled' | 'manual';  // Default: 'enabled'
}
```

### Cache File Location

```
~/.cache/supertag/update-cache.json
```

## API Contracts

### Internal APIs

```typescript
// src/services/update.ts

/** Check for updates, using cache if fresh */
function checkForUpdate(options?: {
  force?: boolean;  // Bypass cache
}): Promise<UpdateCheckResult>;

interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  changelog: string[];
  downloadUrl: string;
  downloadSize: number;
  releaseDate: Date;
  fromCache: boolean;
}

/** Get platform-specific download URL */
function getDownloadUrl(release: GitHubRelease): string;

/** Detect current platform */
function detectPlatform(): Platform;

/** Compare semantic versions */
function compareVersions(a: string, b: string): -1 | 0 | 1;

/** Download update to specified path */
function downloadUpdate(options: {
  url: string;
  destination: string;
  onProgress?: (percent: number) => void;
}): Promise<string>;  // Returns path to downloaded file

/** Install update (replace binary) */
function installUpdate(options: {
  zipPath: string;
  targetDir?: string;  // Default: directory containing current executable
  createBackup?: boolean;  // Default: true
}): Promise<InstallResult>;

interface InstallResult {
  success: boolean;
  backupPath?: string;
  installedVersion: string;
  message: string;
}

/** Check if should show passive notification */
function shouldShowNotification(cache: UpdateCache): boolean;

/** Mark notification as shown */
function markNotificationShown(): Promise<void>;
```

### External APIs

**GitHub Releases API:**
```
GET https://api.github.com/repos/jcfischer/supertag-cli/releases/latest
Accept: application/vnd.github+json
User-Agent: supertag-cli/{version}

Response: GitHubRelease object
Rate Limit: 60 requests/hour (unauthenticated)
```

## Implementation Strategy

### Phase 1: Foundation

Core service with version checking and caching.

- [ ] Create `src/services/update.ts` with types
- [ ] Implement `detectPlatform()` - os/arch detection
- [ ] Implement `compareVersions()` - semver comparison
- [ ] Implement cache read/write utilities
- [ ] Add tests for version comparison (edge cases)
- [ ] Add tests for platform detection

### Phase 2: Core Features

GitHub API integration and CLI commands.

- [ ] Implement `checkForUpdate()` - fetch + cache logic
- [ ] Implement `getDownloadUrl()` - asset matching
- [ ] Implement `downloadUpdate()` - streaming download with progress
- [ ] Create `src/commands/update.ts` with subcommands
- [ ] Implement `supertag update check` command
- [ ] Implement `supertag update download` command
- [ ] Add integration tests for update check

### Phase 3: Self-Update

Binary replacement with backup/rollback.

- [ ] Implement `installUpdate()` - unzip, backup, replace
- [ ] Implement `supertag update install` command
- [ ] Add rollback logic if install fails
- [ ] Handle Windows file locking edge cases
- [ ] Add tests for install flow

### Phase 4: Integration

Hook into main CLI and finalize.

- [ ] Add passive notification hook to `src/index.ts`
- [ ] Add `--update-check` option to config command
- [ ] Update `TanaConfig` type with `UpdateConfig`
- [ ] Add user documentation
- [ ] Final E2E tests

## File Structure

```
src/
├── services/
│   └── update.ts            # [New] Core update service
├── commands/
│   ├── update.ts            # [New] CLI commands
│   └── config.ts            # [Modified] Add --update-check option
├── config/
│   └── manager.ts           # [Modified] Add updateCheck config
├── types.ts                 # [Modified] Add update types
└── index.ts                 # [Modified] Add passive check hook

tests/
├── update-service.test.ts   # [New] Unit tests
└── update-commands.test.ts  # [New] Integration tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| GitHub API rate limiting | Med | Low | Cache aggressively (24h), graceful degradation |
| Network timeout blocking CLI | High | Med | Async check with timeout (2s), never block |
| Self-update corrupts binary | High | Low | Always backup before replace, verify checksum |
| Windows file locking | Med | Med | Spawn helper process for Windows self-update |
| Version comparison edge cases | Low | Med | Comprehensive tests, use semver spec |

## Dependencies

### External

- None required (using native Bun fetch)

### Internal

- `src/version.ts` - Current version
- `src/config/manager.ts` - Config storage
- `src/config/paths.ts` - Cache directory

## Migration/Deployment

- [ ] Database migrations needed? **No**
- [ ] Environment variables? **No** (optional GitHub token for higher rate limits)
- [ ] Breaking changes? **No** - purely additive feature

### Config Migration

Existing config files will gain new optional field:
```json
{
  "updateCheck": "enabled"
}
```

Default behavior (`enabled`) preserves backward compatibility.

## Estimated Complexity

- **New files:** 2 (service + commands)
- **Modified files:** 4 (types, config, index, config command)
- **Test files:** 2
- **Estimated tasks:** ~12-15
