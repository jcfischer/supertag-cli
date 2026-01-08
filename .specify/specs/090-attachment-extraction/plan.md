---
feature: "Attachment Extraction"
spec: "./spec.md"
status: "draft"
---

# Technical Plan: Attachment Extraction

## Architecture Overview

Create a new `attachments` command group for discovering and downloading files from Firebase Storage. The implementation leverages existing auth infrastructure from the export module and adds file discovery via database queries or JSON export parsing.

```
+-----------------------------------------------------------------------+
|                            CLI                                         |
|  supertag attachments list    |    supertag attachments extract       |
+-----------------+---------------------------+-------------------------+
                  |                           |
                  v                           v
+-----------------------------------------------------------------------+
|                     AttachmentService                                  |
|  +---------------------------------------------------------------+   |
|  |  discover(options)         - Find attachment URLs              |   |
|  |  list(options)             - Return metadata without download  |   |
|  |  extract(options)          - Download files                    |   |
|  |  get(nodeId)               - Download single file              |   |
|  +---------------------------------------------------------------+   |
+-----------------------------------------------------------------------+
                  |                           |
                  v                           v
+-------------------------------+   +-------------------------------+
|     AttachmentDiscovery       |   |     AttachmentDownloader      |
|  - parseNodeForUrls()         |   |  - downloadFile()             |
|  - scanDatabase()             |   |  - downloadWithProgress()     |
|  - scanExport()               |   |  - retryWithBackoff()         |
|  - extractFilename()          |   |  - validateDownload()         |
+-------------------------------+   +-------------------------------+
                  |                           |
                  v                           v
+-------------------------------+   +-------------------------------+
|     TanaQueryEngine           |   |     Firebase Auth             |
|  - SELECT nodes with URLs     |   |  - getAuthToken()             |
+-------------------------------+   |  - refreshAuthToken()         |
                                    +-------------------------------+
```

## Technology Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Language | TypeScript | PAI standard, existing codebase |
| Runtime | Bun | PAI standard, native fetch with streaming |
| Database | SQLite (existing) | Query nodes with attachment URLs |
| Auth | Firebase (existing) | Reuse export module auth infrastructure |
| Progress | cli-progress or built-in | Show download progress |
| Validation | Zod | Input validation, consistent with codebase |
| Testing | Bun test | Consistent with codebase |

## Constitutional Compliance

- [x] **CLI-First:** `supertag attachments list|extract|get` commands with comprehensive flags
- [x] **Library-First:** `AttachmentService` as reusable module, callable from CLI and tests
- [x] **Test-First:** Unit tests for URL parsing, download logic; E2E tests for CLI
- [x] **Deterministic:** Pure file operations, consistent naming logic
- [x] **Code Before Prompts:** All logic in TypeScript, no LLM prompts

## Data Model

### Entities

```typescript
// Attachment found in Tana export/database
interface Attachment {
  nodeId: string;                  // Node containing the URL
  url: string;                     // Firebase Storage URL
  filename: string;                // Decoded from URL or generated
  extension: string;               // File extension from URL/mime
  parentNodeId?: string;           // Parent node for context
  parentNodeName?: string;         // Parent name for organization
  tags?: string[];                 // Tags on the attachment node
  created?: number;                // Creation timestamp
}

// Result of download attempt
interface DownloadResult {
  attachment: Attachment;
  status: 'success' | 'skipped' | 'failed';
  localPath?: string;              // Where file was saved
  bytesWritten?: number;           // File size
  error?: string;                  // Error message if failed
  retries?: number;                // Number of retries attempted
}

// Options for list/extract commands
interface AttachmentOptions {
  workspace?: string;              // Workspace alias
  tags?: string[];                 // Filter by tags
  outputDir?: string;              // Output directory (extract only)
  organizeBy?: 'flat' | 'date' | 'tag' | 'node';  // Subdirectory organization
  dryRun?: boolean;                // Show what would download
  skipExisting?: boolean;          // Skip files that exist
  concurrency?: number;            // Parallel downloads (default: 3)
  limit?: number;                  // Max attachments to process
  verbose?: boolean;               // Detailed output
}

// Summary of extraction operation
interface ExtractionSummary {
  workspace: string;
  totalFound: number;
  downloaded: number;
  skipped: number;
  failed: number;
  bytesDownloaded: number;
  outputDir: string;
  duration: number;                // ms
  errors: Array<{nodeId: string; error: string}>;
}
```

### Database Schema

No schema changes needed. Uses existing tables:

```sql
-- Query nodes containing Firebase Storage URLs
SELECT id, name, parent_id, created
FROM nodes
WHERE name LIKE '%firebasestorage.googleapis.com%'

-- Join with tag_applications for filtering
SELECT n.id, n.name, ta.tag_name
FROM nodes n
LEFT JOIN tag_applications ta ON n.id = ta.data_node_id
WHERE n.name LIKE '%firebasestorage.googleapis.com%'
AND ta.tag_name = ?
```

## API Contracts

### Internal APIs

```typescript
// src/services/attachment-service.ts
class AttachmentService {
  constructor(options: { dbPath: string; exportDir?: string });

  /**
   * Discover all attachments in workspace
   * @returns Array of attachment metadata
   */
  async discover(options?: AttachmentOptions): Promise<Attachment[]>;

  /**
   * List attachments with metadata (no download)
   */
  async list(options?: AttachmentOptions): Promise<Attachment[]>;

  /**
   * Download attachments to local directory
   * @returns Summary of extraction
   */
  async extract(options: AttachmentOptions): Promise<ExtractionSummary>;

  /**
   * Download single attachment by node ID
   * @throws StructuredError with NODE_NOT_FOUND if not found
   */
  async get(nodeId: string, outputPath?: string): Promise<DownloadResult>;

  close(): void;
}

// src/services/attachment-downloader.ts
class AttachmentDownloader {
  constructor(authToken: string);

  /**
   * Download file with progress tracking
   */
  async downloadFile(
    url: string,
    outputPath: string,
    options?: { onProgress?: (percent: number) => void }
  ): Promise<{ bytesWritten: number }>;

  /**
   * Download with retry logic
   */
  async downloadWithRetry(
    url: string,
    outputPath: string,
    maxRetries?: number
  ): Promise<DownloadResult>;
}

// src/services/attachment-discovery.ts
class AttachmentDiscovery {
  /**
   * Extract attachment URL from node name
   */
  static parseNodeForUrl(name: string): string | null;

  /**
   * Extract filename from Firebase Storage URL
   */
  static extractFilename(url: string): { filename: string; extension: string };

  /**
   * Find all attachments in database
   */
  async scanDatabase(dbPath: string, options?: AttachmentOptions): Promise<Attachment[]>;

  /**
   * Find all attachments in JSON export file
   */
  async scanExport(exportPath: string, options?: AttachmentOptions): Promise<Attachment[]>;
}
```

### CLI Commands

```bash
# List all attachments
supertag attachments list
supertag attachments list --tag meeting
supertag attachments list --format json
supertag attachments list --format csv > attachments.csv

# Extract (download) attachments
supertag attachments extract
supertag attachments extract -o ./my-attachments
supertag attachments extract --tag project --organize-by tag
supertag attachments extract --dry-run
supertag attachments extract --skip-existing
supertag attachments extract --concurrency 5

# Get single attachment
supertag attachments get <nodeId>
supertag attachments get <nodeId> -o ~/Downloads/myfile.png

# All commands support standard options
--workspace <alias>    # Workspace selection
--format <type>        # Output format (list only)
--verbose              # Detailed output
--json                 # JSON output (list only)
```

### Output Formats

**List (table):**
```
Attachments in workspace 'main':

  ID              Filename              Size     Created      Tags
  OG8mqnSHb-SY    screenshot.png        245 KB   2025-01-15   meeting
  Xk92jf8sQr4     document.pdf          1.2 MB   2025-01-14   project
  ...

Found 42 attachments (total: 156 MB)
```

**List (JSON):**
```json
{
  "workspace": "main",
  "attachments": [
    {
      "nodeId": "OG8mqnSHb-SY",
      "url": "https://firebasestorage.googleapis.com/...",
      "filename": "screenshot.png",
      "extension": "png",
      "tags": ["meeting"],
      "created": 1705341234000
    }
  ],
  "count": 42,
  "totalBytes": 163840000
}
```

**Extract (progress):**
```
Extracting attachments to ./attachments...

  [1/42] screenshot.png ..................... [=====>          ] 45%
  [2/42] document.pdf ....................... [done] 1.2 MB

Extraction complete:
  Downloaded: 42 files (156 MB)
  Skipped: 0
  Failed: 0
  Duration: 2m 34s
  Output: ./attachments
```

## Implementation Strategy

### Phase 1: Discovery Foundation

Build URL parsing and database/export scanning:

- [ ] Create `src/services/attachment-discovery.ts`
- [ ] Implement `parseNodeForUrl()` - regex extraction of Firebase URLs
- [ ] Implement `extractFilename()` - decode URL-encoded filename
- [ ] Implement `scanDatabase()` - query nodes table
- [ ] Write unit tests for URL parsing and filename extraction

### Phase 2: Download Infrastructure

Build authenticated download with retry:

- [ ] Create `src/services/attachment-downloader.ts`
- [ ] Implement `downloadFile()` with progress callback
- [ ] Implement `downloadWithRetry()` with exponential backoff
- [ ] Integrate with Firebase auth from export module
- [ ] Write unit tests for download logic

### Phase 3: Service Layer

Create main service orchestrating discovery and download:

- [ ] Create `src/services/attachment-service.ts`
- [ ] Implement `discover()` method
- [ ] Implement `list()` method
- [ ] Implement `extract()` method with concurrency control
- [ ] Implement `get()` method for single file
- [ ] Add organization logic (flat/date/tag/node)
- [ ] Write unit tests for service methods

### Phase 4: CLI Commands

Create CLI command group:

- [ ] Create `src/commands/attachments.ts`
- [ ] Implement `list` subcommand with format support
- [ ] Implement `extract` subcommand with all options
- [ ] Implement `get` subcommand
- [ ] Wire into main CLI in `src/index.ts`
- [ ] Write E2E tests

### Phase 5: Documentation & Polish

- [ ] Update README with new commands
- [ ] Add to CHANGELOG
- [ ] Update SKILL.md with capability
- [ ] Add help examples

## File Structure

```
src/
+-- services/
|   +-- attachment-service.ts       # [New] Main service
|   +-- attachment-discovery.ts     # [New] URL parsing & scanning
|   +-- attachment-downloader.ts    # [New] Download with retry
+-- commands/
|   +-- attachments.ts              # [New] CLI command group
+-- index.ts                        # [Modified] Register command

tests/
+-- unit/
|   +-- attachment-discovery.test.ts   # [New] URL parsing tests
|   +-- attachment-downloader.test.ts  # [New] Download tests
|   +-- attachment-service.test.ts     # [New] Service tests
+-- e2e/
    +-- attachments-cli.test.ts        # [New] CLI integration tests
```

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Firebase URL format changes | High | Low | Configurable URL pattern, version check |
| Auth token issues | Medium | Medium | Clear error messages, prompt re-auth |
| Large file downloads | Medium | Medium | Streaming, progress display, timeout handling |
| Rate limiting | Medium | Low | Configurable concurrency, backoff logic |
| Filename conflicts | Low | Medium | Add suffix for duplicates, organize by node ID |
| Missing Content-Length | Low | Low | Allow unknown size, validate after download |

## Failure Mode Analysis

### How This Code Can Fail

| Failure Mode | Trigger | Detection | Degradation | Recovery |
|-------------|---------|-----------|-------------|----------|
| Auth expired | Token timeout | 401 response | Stop, prompt | Refresh token, retry |
| File not found | Deleted attachment | 404 response | Skip, warn | Continue with others |
| Network error | Connection issue | Fetch error | Retry 3x | Exponential backoff |
| Disk full | No space | Write error | Stop | Clear message, cleanup |
| URL decode fail | Malformed URL | Decode error | Use fallback name | Generate from node ID |

### Assumptions That Could Break

| Assumption | What Would Invalidate It | Detection Strategy |
|-----------|-------------------------|-------------------|
| Firebase Storage URLs in node.name | Tana stores elsewhere | Scan all props |
| URL encoding standard | Non-standard encoding | Fallback decoder |
| Auth token works for all files | Per-file permissions | Detect 403, report |

### Blast Radius

- **Files touched:** ~6 files (5 new, 1 modified)
- **Systems affected:** CLI commands (no MCP tool in initial version)
- **Rollback strategy:** Feature is additive; remove command registration to disable

## Dependencies

### External

- None new (uses existing packages)

### Internal

- `getAuthToken()` from `export/lib/auth.ts` - Token management
- `resolveWorkspaceContext()` - Workspace resolution
- `TanaQueryEngine` - Database queries (optional, can scan export directly)
- `createFormatter()` - Output formatting

## Migration/Deployment

- [x] Database migrations needed? **No**
- [x] Environment variables? **No**
- [x] Breaking changes? **No** - new feature only

## Estimated Complexity

- **New files:** ~5 (services, command, tests)
- **Modified files:** ~1 (index.ts)
- **Test files:** ~4 (unit + e2e)
- **Estimated tasks:** ~15-18
- **Debt score:** 3 (moderate complexity - new feature area, auth integration)

## Longevity Assessment

### Maintainability Indicators

| Indicator | Status | Notes |
|-----------|--------|-------|
| **Readability:** Can a developer understand this in 6 months? | Yes | Clear separation of concerns |
| **Testability:** Can changes be verified without manual testing? | Yes | Unit tests for each layer |
| **Documentation:** Is the "why" captured? | Yes | Spec captures use cases |

### Evolution Vectors

| What Might Change | Preparation | Impact |
|------------------|-------------|--------|
| New storage providers | Configurable URL patterns | Low |
| MCP tool addition | Service layer ready | Low |
| Batch operations | Concurrency already built-in | Low |
| Real-time sync | Would need new architecture | High |

### Deletion Criteria

- [ ] Feature superseded by: Tana native export with attachments
- [ ] Dependency deprecated: Firebase Storage (would need migration)
- [ ] User need eliminated: Local backups no longer needed
- [ ] Maintenance cost exceeds value when: < 5 monthly uses and issues arise
