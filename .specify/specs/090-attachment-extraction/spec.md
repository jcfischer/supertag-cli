---
id: "090"
feature: "Attachment Extraction"
status: "draft"
created: "2026-01-08"
---

# Specification: Attachment Extraction

## Overview

Add command to extract and download attachments (images, files) from Tana exports. Tana stores uploaded files in Firebase Storage with URLs embedded in node names. This feature parses exports to find attachment URLs and downloads them locally for backup, offline access, or migration purposes.

## System Context

### Upstream Dependencies

| Dependency | Purpose | Failure Impact |
|------------|---------|----------------|
| `nodes` table | Source of attachment URLs | Query fails completely |
| Tana JSON exports | Raw data with all node properties | Cannot find attachments |
| Firebase Storage | Remote file host | Downloads fail |
| Firebase Auth | Authentication for private files | 401/403 errors |
| `export/lib/auth.ts` | Token management | Cannot authenticate |

### Downstream Consumers

| Consumer | Usage | Breaking Change Risk |
|----------|-------|---------------------|
| CLI users | `supertag attachments extract` command | Flag/output changes break scripts |
| Backup workflows | Automated attachment archival | Path changes break scripts |
| Migration tools | Export attachments for import elsewhere | Format changes break tools |

### Implicit Coupling

- Firebase Storage URL format (firebasestorage.googleapis.com)
- Tana's file naming convention (timestamp-filename in URL)
- Authentication token refresh mechanism from export module

## User Scenarios

### Scenario 1: Download All Attachments for Backup

**As a** Tana user wanting offline copies
**I want to** download all my uploaded images and files
**So that** I have local backups independent of Tana

**Acceptance Criteria:**
- [ ] `supertag attachments extract` downloads all files
- [ ] Files preserve original filenames when possible
- [ ] Progress shown during download
- [ ] Resume capability for interrupted downloads

**Failure Behavior:** Network errors retry 3x with exponential backoff. 401/403 errors prompt for re-authentication.

### Scenario 2: Extract Attachments for Specific Tag

**As a** user organizing project materials
**I want to** extract only attachments from nodes with a specific tag
**So that** I can gather project-related files in one place

**Acceptance Criteria:**
- [ ] `--tag <tagname>` filters to attachments on tagged nodes
- [ ] Includes attachments in child nodes of tagged items
- [ ] Can specify multiple tags with OR logic

**Failure Behavior:** Unknown tag returns validation error with suggestion.

### Scenario 3: List Attachments Without Downloading

**As a** user auditing storage usage
**I want to** see all attachments and their sizes
**So that** I can decide what to download

**Acceptance Criteria:**
- [ ] `supertag attachments list` shows URLs without downloading
- [ ] Shows file size, date, parent node context
- [ ] Supports all output formats (json, csv, table)

**Failure Behavior:** Returns available metadata even if some requests fail.

### Scenario 4: Download Specific Attachment

**As a** user needing one specific file
**I want to** download by node ID
**So that** I don't have to download everything

**Acceptance Criteria:**
- [ ] `supertag attachments get <nodeId>` downloads single file
- [ ] Can specify output path with `-o`
- [ ] Shows download progress

**Failure Behavior:** Not found returns structured error with NODE_NOT_FOUND code.

## Functional Requirements

### FR-1: Attachment Discovery

Scan exports/database for Firebase Storage URLs:

```typescript
// Pattern: firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>
const FIREBASE_STORAGE_PATTERN = /https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^\/]+\/o\/[^"]+/g;
```

**Validation:** Discovers all attachment URLs in indexed nodes.

**Failure Behavior:** Invalid URLs skipped with warning in verbose mode.

### FR-2: List Command

List all attachments with metadata:

```bash
supertag attachments list
supertag attachments list --tag project
supertag attachments list --format json
```

**Output includes:**
- Node ID containing attachment
- Original filename (decoded from URL)
- File URL
- Parent node context (name, tags)

**Failure Behavior:** Returns partial results if some metadata unavailable.

### FR-3: Extract Command

Download attachments to local directory:

```bash
supertag attachments extract                    # All to default dir
supertag attachments extract -o ./attachments   # Custom output
supertag attachments extract --tag meeting      # Filter by tag
supertag attachments extract --dry-run          # Show what would download
supertag attachments extract --skip-existing    # Skip already downloaded
```

**Validation:**
- Downloads use Firebase auth token for authenticated requests
- Preserves original filename when possible
- Falls back to node ID + extension if filename unavailable
- Creates subdirectories by date or tag optionally

**Failure Behavior:** Failed downloads logged and retried. Summary shows success/failure count.

### FR-4: Get Single Attachment

Download specific attachment by node ID:

```bash
supertag attachments get <nodeId>
supertag attachments get <nodeId> -o ~/Downloads/myfile.png
```

**Validation:** Downloads single file with progress display.

**Failure Behavior:** 404 returns NODE_NOT_FOUND. 401/403 prompts re-auth.

### FR-5: Authentication Integration

Use existing Firebase auth from export module:

```typescript
import { getAuthToken, isTokenValid } from '../export/lib/auth';
```

**Validation:**
- Reuses cached/refreshed tokens
- Falls back to browser extraction if needed
- Token passed in Authorization header for private files

**Failure Behavior:** Auth failure prompts `supertag-export login` command.

### FR-6: Organize Output Options

Optional organization of downloaded files:

```bash
--organize-by date      # attachments/2025-01/file.png
--organize-by tag       # attachments/meeting/file.png
--organize-by node      # attachments/nodeId/file.png
--flat                  # attachments/file.png (default)
```

**Validation:** Creates subdirectories based on organization strategy.

**Failure Behavior:** Falls back to flat if organization metadata unavailable.

## Non-Functional Requirements

- **Performance:** Download with configurable concurrency (default: 3 parallel)
- **Reliability:** Retry failed downloads up to 3 times with backoff
- **Resume:** Track downloaded files, skip on re-run with `--skip-existing`
- **Progress:** Show download progress bar for large files
- **Limits:** Default limit 1000 files, warn if more exist

## Key Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| Attachment | File reference in node | `nodeId`, `url`, `filename`, `size`, `mimeType` |
| DownloadResult | Outcome of download | `status`, `path`, `bytesWritten`, `error` |
| ExtractionOptions | Command configuration | `outputDir`, `organizeBy`, `tags`, `dryRun`, `concurrency` |

## Success Criteria

- [ ] List command shows all attachments with metadata
- [ ] Extract command downloads files successfully
- [ ] Authentication works automatically via cached tokens
- [ ] Progress displayed during downloads
- [ ] Failed downloads reported with retry option
- [ ] Output organization options work correctly
- [ ] Resume works (skip existing files)

## Assumptions

| Assumption | Invalidation Condition | Mitigation |
|------------|----------------------|------------|
| All attachments use firebasestorage.googleapis.com | Tana changes storage provider | Add configurable URL pattern |
| Files accessible with Tana auth token | Different auth per workspace | Support workspace-specific auth |
| Filenames encoded in URLs | URL format changes | Fall back to node ID naming |
| Files under 2GB each | Large video files | Add streaming download support |

## Failure Mode Analysis

| Failure Mode | Likelihood | Impact | Detection | Recovery |
|--------------|------------|--------|-----------|----------|
| Auth token expired | Medium | Medium | 401 response | Auto-refresh or prompt login |
| File not found (deleted) | Low | Low | 404 response | Skip with warning, continue |
| Network timeout | Medium | Low | Fetch timeout | Retry with backoff |
| Disk full | Low | High | Write error | Abort with clear message |
| Rate limiting | Low | Medium | 429 response | Exponential backoff |
| Corrupted download | Low | Medium | Size mismatch | Retry, verify with Content-Length |

## Out of Scope

- Uploading files back to Tana
- Video thumbnail generation
- Image format conversion
- Deduplication of identical files
- Cross-workspace attachment discovery
- Real-time sync of new attachments
