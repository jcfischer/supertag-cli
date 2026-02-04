# Changelog

All notable changes to Supertag CLI are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.2] - 2026-02-04

### Fixed

- **Windows manual login browser process merging** - `supertag-export login --manual` failed to extract tokens when Chrome/Edge was already running because the spawned process merged into the existing one, ignoring `--remote-debugging-port`. Now detects running browsers, prompts user to restart with debugging enabled, and uses the real user profile so no re-login is needed.
- **CDP debug port readiness** - Added port polling (up to 15s) after browser launch to catch cases where the debug port never opens, with clear diagnostic logging before attempting CDP connection.
- **setTimeout leak in manual login** - The 180s timeout was never cleared when user pressed Enter, causing a confusing "Timeout reached" message after extraction had already completed.
- **CDP connection timeout** - Increased from 10s to 30s to accommodate slower Windows machines.

## [2.1.1] - 2026-02-04

### Fixed

- **Windows installer MCP configuration** - `install.ps1` failed at step [6/6] with "A parameter cannot be found that matches parameter name 'AsHashtable'" because `ConvertFrom-Json -AsHashtable` requires PowerShell 7+. Added recursive PSCustomObject-to-hashtable converter for PowerShell 5.1 compatibility.
- **Windows manual login token extraction** - `supertag-export login --manual` failed with "Token extraction failed" because it launched Playwright's Chromium to read Chrome/Edge's IndexedDB profile — incompatible formats on Windows. Now uses Chrome DevTools Protocol (CDP) to extract tokens directly from the running browser session. User instructions updated to keep browser open while pressing Enter.

## [2.1.0] - 2026-02-03

### Added

- **MCP Lite Mode (F-096)** - Complement tana-local MCP with analytics and search tools
  - `mcp.toolMode: "lite"` config option or `--lite` CLI flag
  - 16 tools: semantic search, aggregation, timeline, field queries, transcripts, graph traversal
  - Excludes CRUD tools handled by tana-local (create, edit, tag, trash, done/undone)
  - Excluded tools return helpful message pointing to the equivalent tana-local tool
  - `TANA_MCP_TOOL_MODE=lite` environment variable support
  - Three-mode comparison: `full` (32 tools), `slim` (14), `lite` (16)

## [2.0.3] - 2026-02-01

### Fixed

- **Index fails on imported workspaces** - Workspaces imported from Roam Research (and potentially other tools) have nodes missing the `created` timestamp in their props. The Zod schema validation now treats `created` as optional, defaulting to `0` in the database. Fixes #34.

## [2.0.2] - 2026-01-30

### Fixed

- **Windows installer GitHub API calls** - `install.ps1` failed to fetch latest version on PowerShell 5.1 because TLS 1.2 is not enabled by default (.NET Framework uses TLS 1.0/1.1) and GitHub API requires a `User-Agent` header. Added explicit TLS 1.2 enablement and `User-Agent` headers to all HTTP requests. Error messages now include the actual exception detail.

## [2.0.1] - 2026-01-30

### Fixed

- **Windows installer architecture detection** - `install.ps1` failed on Windows PowerShell 5.1 with "Unsupported architecture:" error because `RuntimeInformation.ProcessArchitecture` requires .NET Core (PowerShell 7+). Added fallback to `$env:PROCESSOR_ARCHITECTURE` environment variable which correctly maps `AMD64` → `windows-x64` and `ARM64` → `windows-arm64`.

## [2.0.0] - 2026-01-30

### Added

- **Delta-Sync via Local API (F-095)** - Incremental sync between full exports using Tana Desktop's local API
  - `supertag sync index --delta` - Fetch only nodes changed since last sync instead of full reindex
  - MCP `tana_sync` tool now accepts `action="delta"` for incremental sync from AI tools
  - Background delta-sync poller in MCP server runs periodic incremental syncs (configurable interval)
  - Health-aware polling: pauses when Tana Desktop is unreachable, resumes when back
  - Delta-sync status in `supertag sync status` output (last sync time, nodes synced, embedding coverage)
  - Configuration: `localApi.deltaSyncInterval` in config (minutes, default 5, 0 disables)
  - Environment variables: `TANA_DELTA_SYNC_INTERVAL`, `TANA_MCP_TOOL_MODE`

- **MCP Slim Mode (F-095)** - Reduced tool set for AI agents that benefit from fewer tools
  - `mcp.toolMode: "slim"` config option reduces from 31 tools to 16 essential tools
  - Slim mode keeps: semantic_search, all mutations, sync, cache_clear, capabilities, tool_schema
  - Environment variable: `TANA_MCP_TOOL_MODE=slim`

- **Local API Integration (F-094)** - Tana Desktop's tana-local REST API as write backend
  - New backend abstraction layer: `TanaBackend` interface with `InputApiBackend` and `LocalApiBackend` implementations
  - Auto-detects available backend: Local API (if Tana Desktop running) → Input API fallback
  - `supertag config --bearer-token <token>` to configure Local API authentication
  - `supertag config --local-api-url <url>` to set custom endpoint (default: `http://localhost:8262`)
  - `supertag config --use-input-api true` to prefer legacy Input API
  - Environment variables: `TANA_LOCAL_API_TOKEN`, `TANA_LOCAL_API_URL`

- **Node Mutation Commands** - New CLI commands for editing existing nodes (requires Local API)
  - `supertag edit <nodeId>` - Update node name or description
  - `supertag tag add <nodeId> <tagIds...>` - Add supertags to a node
  - `supertag tag remove <nodeId> <tagIds...>` - Remove supertags from a node
  - `supertag tag create <name>` - Create a new supertag definition
  - `supertag set-field <nodeId> <attributeId> <value>` - Set field text content
  - `supertag trash <nodeId>` - Move a node to trash
  - `supertag done <nodeId>` / `supertag undone <nodeId>` - Check/uncheck nodes

- **MCP Mutation Tools** - 9 new MCP tools for AI-driven node editing
  - `tana_update_node` - Update node name/description
  - `tana_tag_add` / `tana_tag_remove` - Add or remove supertags
  - `tana_create_tag` - Create new supertag definitions
  - `tana_set_field` / `tana_set_field_option` - Set field values
  - `tana_trash_node` - Move nodes to trash
  - `tana_done` / `tana_undone` - Check/uncheck nodes

### Changed

- **Backend Abstraction** - `supertag create` and `supertag batch create` now route through the backend abstraction, automatically using Local API when available

## [1.13.3] - 2026-01-29

### Fixed

- **Windows Playwright Login Bug** - `supertag-export login` now works on Windows 11
  - Added `--channel chrome|msedge` flag to use system browser instead of bundled Chromium
  - Added `--manual` flag for manual login mode that bypasses Playwright launch entirely
  - Added `--timeout <seconds>` flag for configurable login timeout (default: 180s)
  - Auto-detect Windows and add GPU-related args (`--disable-gpu`, `--disable-software-rasterizer`, `--disable-dev-shm-usage`)
  - Fixes Playwright `launchPersistentContext` timeout where browser exits immediately with exitCode=0

## [1.13.2] - 2026-01-27

### Fixed

- **Timeline Content Filtering** - Filter noise from timeline output at service layer
  - Empty/whitespace-only nodes excluded from results
  - Transcript timestamps (209K `1970-01-01T*` nodes) filtered out
  - Counts now accurately reflect displayed items (was showing "10 items" but displaying fewer)

## [1.13.1] - 2026-01-27

### Added

- **Timeline & Temporal Queries** - New commands for time-based activity views
  - `supertag timeline` - Time-bucketed activity with configurable granularity (hour/day/week/month/quarter/year)
  - `supertag recent` - Recently created/updated items within a time period
  - Support relative dates: `7d`, `1w`, `1m`, `1y` and ISO dates
  - MCP tools: `tana_timeline`, `tana_recent`

- **Community Links** - Added video course and Discord links to README
  - Video course: https://courses.invisible.ch
  - Discord community: https://discord.gg/MbQpMWsB

## [1.13.0] - 2026-01-26

### Added

- **Option Values Enumeration** - `tags show` and `tags fields` now display available option values for inline options fields
  - Inline options show values: `Type: options (Active, Next Up, In Review, ...)`
  - Reference fields show target: `Type: reference → project`
  - New database column `option_values` in `supertag_fields` table stores JSON array of option names
  - New `extractOptionValuesFromField()` function traverses field definition → "Values" tuple → option nodes
  - MCP `tana_supertag_info` tool now includes `optionValues` array in field info

## [1.12.6] - 2026-01-21

### Fixed

- **Query Parser Select Clause** - Complete fix for field selection syntax
  - Unquoted comma-separated: `select name,email,phone`
  - Mixed quoted and unquoted: `select name,Status,'Due Date'`
  - Field names with spaces: `select name,"Due Date",Status`
  - Added COMMA token type to tokenizer for proper field list parsing

- **Query Output Duplicate Columns** - Fixed duplicate columns when selecting core fields
  - Previously: `select name,Status` produced header `id,name,created,updated,name,Status`
  - Now: Core fields (id, name, created, updated) are deduplicated when also in select clause

- **Query Field Resolution with Duplicate Supertags** - Fixed `select *` returning no fields when multiple supertags share the same name
  - Previously: Field resolver picked first supertag by DB order, often the wrong one
  - Now: Picks supertag with most inheritance/fields (matching `tags fields` behavior)
  - Example: `find project select *` now correctly resolves to the project with fields

## [1.12.5] - 2026-01-21

_Incomplete release - use 1.12.6 instead_

## [1.12.4] - 2026-01-21

_Incomplete release - use 1.12.6 instead_

## [1.12.3] - 2026-01-21

_Incomplete release - use 1.12.4 instead_

## [1.12.2] - 2026-01-21

### Fixed

- **Export Status Display Bug (Issue #32)** - Fixed `supertag-export status` always showing "Token expired"
  - Bug: `showStatus()` passed `AuthResult` object to `isTokenValid()` instead of `AuthResult.auth`
  - Now correctly shows token validity and expiration time
  - Also displays auth method (cached/refreshed/browser) for debugging

- **Export Token Refresh (Issue #33)** - Fixed automated exports failing after 60 minutes
  - Root cause: `supertag-export login` did not extract Firebase API key needed for token refresh
  - Added `extractFirebaseApiKey()` to extract API key from browser's IndexedDB during login
  - Login now polls for successful authentication and auto-extracts the API key
  - API key is saved to config.json enabling unattended token refresh
  - Fixes "Method doesn't allow unregistered callers" 403 errors in scheduled exports

## [1.12.1] - 2026-01-21

### Fixed

- **Core Node Fields in Aggregate --where** - WHERE clause now supports filtering by core node fields like `name`
  - Previously: `--where "name~keyword"` returned 0 results
  - Now: Core fields (name, created, updated) filter directly on nodes table
  - Example: `supertag aggregate --tag todo --group-by Priority --where "name~urgent"`

- **Default Output Format** - Changed default output from JSON to table (TSV)
  - All query commands now default to human-readable table format
  - Fixes inconsistency where piped output was JSON but terminal was table
  - Use `--format json` or `--json` for JSON output

- **Aggregate Table Alignment** - Fixed column alignment for entries containing emojis
  - Emoji characters now correctly counted as 2-column width
  - Tables align properly regardless of emoji content

- **CI Test Compatibility** - Fixed test database schemas for CI environment
  - Corrected field_values column names (parent_id, value_text)
  - Corrected tag_applications column names (data_node_id)

## [1.12.0] - 2026-01-21

### Added

- **Query Field Output with Select Clause (F-093)** - Include custom field values in query output
  - `select *` returns all supertag fields including inherited fields
  - `select "Email,Phone"` returns specific fields by name
  - No select clause = core fields only (backward compatible)
  - Multi-value fields are comma-joined
  - Works with all output formats (table, json, csv, jsonl)
  - New `is empty` operator for querying empty/missing field values
  - Example: `supertag query "find contact select *"`
  - Example: `supertag query "find contact select 'Email,Phone,Company'"`
  - Example: `supertag query "find task where Status is empty"`

- **Semantic Search --min-score Option** - Filter results by minimum similarity threshold
  - `supertag search "query" --semantic --min-score 0.5` - Only results with >= 50% similarity
  - Accepts decimal (0-1) or percentage (0-100) values
  - Example: `--min-score 0.75` or `--min-score 75` both mean 75% threshold

- **@Name Reference Resolution (F-094)** - Reference nodes by display name instead of ID
  - Use `@Name` syntax in field values to lookup nodes by name: `--state "@Open"`
  - Matches Tana's native @mention behavior
  - Automatically filters by field's target supertag for precise matching
  - Falls back to creating new node if name not found
  - Works with comma-separated values: `--assignees "@John Doe,@Jane Doe"`
  - Works even for fields without explicit dataType
  - Example: `supertag create task "My Task" --state "@Open"`
  - Example: `supertag create meeting "Standup" --owner "@John Doe"`

- **Aggregate --where Clause (F-095)** - Filter nodes before aggregation
  - Use `--where` to filter by field values before counting
  - Multiple `--where` flags combine with AND logic
  - Supports operators: `=`, `!=`, `~` (contains), `>`, `<`, `>=`, `<=`
  - Example: `supertag aggregate --tag task --group-by Priority --where "Status=Active"`
  - Example: `supertag aggregate --tag task --group-by month --where "Status!=Cancelled" --where "Priority=High"`

### Fixed

- **@Name Resolution for Options Fields Without targetSupertagId** - Correctly resolves option values from field's Values tuple hierarchy
  - Previously: `--Status "@Active"` could find wrong node when multiple nodes have same name
  - Now: Traverses Field Definition → "Values" tuple → Options Container → matches correct option
  - Example: Status dropdown options now resolve to correct node even without supertag tagging

## [1.11.0] - 2026-01-19

### Added

- **Lite Binary (supertag-lite)** - Lightweight build without embedding support for environments with native module issues
  - Excludes `embed` and `server` commands that depend on `@lancedb/lancedb` native module
  - Fixes "exit 137" crash in environments where Bun's --compile has issues with native modules
  - Includes all core functionality: create, post, tags, fields, search, nodes, stats, sync, batch, etc.
  - Perfect for Raycast extensions, Docker containers, CI/CD pipelines
  - New build script: `bun run build:lite`
  - Compiles successfully without native module dependencies
  - Documented in README-LITE.md

### Fixed

- **Compiled Binary Crash on macOS** - Fixed supertag binary crashing with exit code 137 (SIGKILL)
  - Root cause: Bun's --compile feature incompatibility with @lancedb/lancedb native ARM64 module
  - Solution: Created lite build that excludes embedding functionality
  - Raycast extension and other distribution packages now use supertag-lite

## [1.10.0] - 2026-01-18

### Added

- **Field Default Values (F-092)** - Auto-populate field default values when creating nodes
  - Extracts default values from Tana supertag definitions during sync
  - Automatically applies defaults for fields not provided by user
  - Explicit empty values override defaults
  - Shared implementation between CLI and MCP (no code duplication)
  - New database columns: `default_value_id` and `default_value_text` in `supertag_fields`

- **Unified Field Format (F-091)** - Both MCP and CLI now accept fields in two formats:
  - Nested format (recommended): `{ "fields": { "Status": "Done" } }`
  - Flat format (legacy): `{ "Status": "Done" }`
  - Mixed format merges both, with nested taking precedence
  - New `normalizeFieldInput()` utility in `src/services/field-normalizer.ts`
  - 35 unit tests + 30 integration tests for field normalization

## [1.9.8] - 2026-01-17

### Added

- **Interactive Launchd Setup in Installer** - Installer now prompts to set up background services during installation
  - Option to install webhook server (starts on login)
  - Option to install scheduled sync with customizable schedule (every 4/6 hours, twice daily, once daily, or custom)
  - New `--no-launchd` flag to skip this step
  - `SKIP_LAUNCHD=true` environment variable also supported

- **Interactive Menu for install-launchd.sh** - Running without parameters now shows a menu instead of defaulting to server
  - Choose between server, scheduled sync, or both
  - Schedule selection when installing sync service
  - Custom hours input (e.g., "6,12,18" for 6 AM, noon, 6 PM)

- **Custom Sync Schedule Support** - Scheduled sync now supports custom hours via `SYNC_HOURS` environment variable
  - Example: `SYNC_HOURS="6,18" ./install-launchd.sh daily` for twice-daily sync
  - Generates proper launchd StartCalendarInterval entries

## [1.9.7] - 2026-01-17

### Fixed

- **Scripts Not Included in Install** - Fixed `install-launchd.sh` and other scripts not being available after installation
  - Root cause: Installer only copied binaries, not the `scripts/`, `launchd/`, and `docs/` directories
  - Added copying of these directories during installation
  - Fixed early skip logic that prevented re-downloading when version matched (users couldn't get scripts even after re-running installer)
  - Scripts now available at `~/.supertag-cli/scripts/` for launchd setup and maintenance

- **Interactive Prompts in curl|bash Install** - Fixed install prompts not working when running via `curl | bash`
  - Root cause: stdin consumed by pipe, breaking `read` commands
  - Added `</dev/tty` to all interactive prompts

- **NODE_PATH Unbound Variable** - Fixed "NODE_PATH: unbound variable" error when NODE_PATH not previously set
  - Used `${NODE_PATH:+:$NODE_PATH}` for set -u safety

## [1.9.6] - 2026-01-17

### Fixed

- **Playwright Not Found After Install** - Fixed `supertag-export` failing with "Cannot find package 'playwright'" error immediately after installation
  - Root cause: `NODE_PATH` was only written to shell config, not exported in current session
  - Users running `supertag-export login` in same terminal session couldn't find globally installed Playwright
  - Added immediate `export NODE_PATH` in install script for current session
  - Added prominent yellow warning: "IMPORTANT: Open a new terminal window before continuing!"
  - Thanks to user feedback for reporting this installation issue

## [1.9.5] - 2026-01-12

### Fixed

- **Tags List Count Always 1** - Fixed `supertag tags list` showing node count as 1 for all supertags
  - Root cause: `getNodeCountsBySupertag()` queried the `supertags` table (tag definitions - one row per tag) instead of `tag_applications` table (node-to-tag mappings)
  - Changed SQL query to use `tag_applications` with `COUNT(DISTINCT data_node_id)` to count actual tagged nodes
  - Added regression test to prevent recurrence

### Added

- **Snapshot Freshness Diagnostic** - Export now shows snapshot timestamp and age to help diagnose stale data issues
  - Displays "Snapshot: 2026-01-12 15:13:37 (6h ago)" after node count
  - Shows warning if snapshot is >24 hours old: "⚠️ Snapshot is 2d ago old - may be missing recent changes"
  - Added troubleshooting section to `docs/export.md` explaining stale snapshot behavior
  - Note: Tana generates snapshots periodically, not on-demand - recent changes may not appear immediately

## [1.9.4] - 2026-01-12

### Fixed

- **Field Values with Inline References Truncated** - Fixed field values containing multiple inline node references being truncated to only the first reference (#26)
  - Root cause: Three duplicate `formatValue()` functions used `.match()` which only returns the first regex match
  - Created centralized `formatInlineRefs()` utility using `.replace()` with global regex to process ALL inline references
  - Affected: CLI `nodes show`, MCP `tana_node_show`, and internal display functions
  - Example: `"Meeting with [[abc]] and [[def]]"` now displays completely instead of `"[[abc]]"` only
  - Added 35 unit tests covering all edge cases (multiple refs, adjacent refs, mixed node+date refs, etc.)

## [1.9.2] - 2026-01-11

### Fixed

- **Claude Desktop MCP Compatibility** - Fixed `supertag-mcp` binary crashing on startup with Claude Desktop (#24)
  - Root cause: Zod 4.x bundling issue with Bun's compiler caused `TypeError: undefined is not a constructor` error in `_custom` function
  - Downgraded from Zod 4.x to Zod 3.25.x which bundles correctly with Bun
  - Updated `zodToJsonSchema` helper to use Zod 3.x internal structure (`_def.typeName` instead of `_zod.def.type`)
  - MCP SDK supports both Zod 3.25+ and Zod 4.x, so compatibility is maintained

## [1.9.1] - 2026-01-09

### Fixed

- **Deleted Supertags Not Removed on Sync** - Fixed issue where deleted supertags remained in the database after re-syncing (#23)
  - The `supertag_metadata` table was not being cleared during sync, only `supertag_fields` and `supertag_parents`
  - Now all three tables are cleared before re-extracting metadata from export
  - Deleted supertags will now properly disappear after running `supertag sync index`

- **Windows LanceDB Loading** - Fixed startup crash on Windows when LanceDB native module wasn't available
  - Commands like `sync index` no longer require LanceDB to be installed
  - LanceDB is now lazy-loaded only when embedding/semantic search features are used
  - Server commands (`supertag server start`) dynamically import LanceDB-dependent modules

- **Flaky CI Test** - Fixed `installUpdate` test using unique temp directories to prevent race conditions

## [1.9.0] - 2026-01-08

### Added

- **Attachment Extraction (Spec 090)** - Discover and download attachments from Tana exports
  - New `supertag attachments list` command - List all attachments with metadata (filename, extension, tags)
  - New `supertag attachments extract` command - Download attachments to local directory
  - New `supertag attachments get <nodeId>` command - Download a single attachment by node ID
  - New `supertag attachments stats` command - Show attachment statistics by type and tag
  - Supports Firebase Storage URLs embedded in Tana exports
  - Organization strategies: `flat` (default), `date`, `tag`, `node`
  - Concurrent downloads with configurable parallelism (1-10, default 3)
  - Retry logic with exponential backoff for failed downloads
  - Skip existing files with `--skip-existing` flag
  - Dry-run mode to preview without downloading
  - Filter by extension: `-e png -e jpg` or `--extension pdf`
  - Filter by tag: `-t meeting` or `--tag project`
  - All standard output formats supported (table, json, csv, ids, minimal, jsonl)
  - Discovered 1,277 attachments in test export (images, audio, video, PDFs)

## [1.8.3] - 2026-01-08

### Fixed

- **Update Install ENOTSUP Error** - Fixed `supertag update install` failing with "operation not supported on socket, copyfile" error
  - The issue occurred when the target binary path was a symlink, socket, or other special file type
  - `existsSync()` may return false for sockets, causing the unlink to be skipped before copy
  - Now always attempts to unlink the target file first (catching errors if file doesn't exist)
  - This allows the update installer to correctly replace symlinked binaries

## [1.8.2] - 2026-01-08

### Fixed

- **SQLite Database Locking on Windows** - Added WAL mode for better concurrent database access
  - Enables multiple readers while a writer is active
  - Sets 5-second busy timeout so processes wait for locks instead of failing immediately
  - Especially important on Windows where SQLite file locking is stricter than on Unix
  - Prevents "database is locked" errors when running multiple supertag commands simultaneously
  - New helper functions: `enableWalMode()`, `configureDbForConcurrency()`, `isInMemoryDb()`
  - WAL mode automatically configured for indexer, query engine, and all database connections

## [1.8.1] - 2026-01-08

### Fixed

- **Windows Export Directory Path** - Fixed Windows using wrong default export directory
  - Windows now correctly uses `Documents\Tana-Export` like macOS
  - Previously Windows used `~/.local/share/supertag/exports` (XDG-style) which didn't match the documented location
  - This aligns with the existing Windows installation guide documentation

## [1.8.0] - 2026-01-08

### Added

- **Graph Traversal (Spec 065)** - New `related` command and `tana_related` MCP tool
  - Find nodes related through references, children, and field links
  - CLI: `supertag related <nodeId>` - find all related nodes
  - CLI: `supertag related <nodeId> --direction in` - incoming references only
  - CLI: `supertag related <nodeId> --direction out` - outgoing references only
  - CLI: `supertag related <nodeId> --types child,reference` - filter by relationship type
  - CLI: `supertag related <nodeId> --depth 2` - multi-hop traversal (up to 5)
  - MCP: `tana_related { nodeId: "abc123", direction: "both", depth: 2 }`
  - Relationship types: child, parent, reference, field
  - BFS traversal with cycle detection
  - Returns relationship metadata (type, direction, distance, path)
  - Output formats: table, json, csv, ids, minimal, jsonl
  - 32+ tests passing

### Fixed

- **Field References in Graph Traversal** - The `related` command now correctly finds field references
  - Nodes used as field values (e.g., Topic, Focus fields) are now discovered
  - Previously only inline references were found; field references were missing
  - Example: `related <topic-id> --direction in` now shows all nodes that use this topic as a field value

- **Search Tag Query Filter (Spec 089)** - The `search` command now respects the query when combined with `--tag`
  - `supertag search "Velo" --tag topic` now returns only #topic nodes whose name contains "Velo"
  - Previously the query was ignored and all #topic nodes were returned
  - MCP `tana_tagged` tool now supports optional `query` parameter for the same filtering
  - Substring matching is case-insensitive

## [1.7.1] - 2026-01-07

### Added

- **System Field Discovery (Spec 074)** - Automatic detection and inclusion of Tana system fields
  - System fields (SYS_A90 Date, SYS_A61 Due Date, SYS_A142 Attendees) are now discovered during sync
  - Fields like "Attendees" appear in `tags fields --all` with `system: true` flag
  - MCP `tana_supertag_info` tool returns system field information
  - CLI shows `[system]` marker for system fields in table output
  - Backwards compatible: gracefully handles databases without the new table

- **Contains Operator Shorthand** - Query filters now support `~value` shorthand for contains queries
  - `where: { name: "~meeting" }` is equivalent to `where: { name: { contains: "meeting" } }`
  - Use `\~value` to search for literal tilde prefix
  - Works in both MCP `tana_query` tool and unified query engine

- **Comma-Separated Reference Fields** - Reference field values can now be comma-separated strings
  - Values like `"abc123, def456"` are automatically split into arrays
  - Improves compatibility with Tana API responses that return comma-joined IDs

## [1.7.0] - 2026-01-07

### Added

- **Aggregation Queries (Spec 064)** - New `aggregate` command and `tana_aggregate` MCP tool
  - Group and count nodes by field values or time periods
  - CLI: `supertag aggregate --tag task --group-by Status`
  - CLI: `supertag aggregate --tag meeting --group-by month`
  - MCP: `tana_aggregate { find: "task", groupBy: ["Status"] }`
  - Supports single-field and two-field nested aggregation
  - Time periods: day, week, month, quarter, year
  - Options: `--show-percent` for percentages, `--top N` for top groups
  - Output formats: table, json, csv, jsonl
  - 26 tests passing

## [1.6.4] - 2026-01-06

### Fixed

- **Windows Native Build** - Windows binaries now build on native Windows runner instead of cross-compilation
  - Fixes "Cannot require module @lancedb/lancedb-win32-x64-msvc" error on Windows
  - LanceDB native modules are now properly bundled for Windows x64
  - Semantic search (`--semantic`) and embedding commands now work on Windows

- **Documentation** - Removed outdated `tana-daily` script references
  - Updated `docs/export.md` with current `supertag-export` and `supertag sync` commands
  - Added link to `LAUNCHD-SETUP.md` for macOS automation

## [1.6.3] - 2026-01-05

### Fixed

- **Supertags with Zero Fields** - `findAllTagsByName` now queries `supertag_metadata` instead of `supertag_fields`
  - Supertags with no fields (like "article") were invisible to `tags show` command
  - Now all supertags in the schema are findable regardless of field count

## [1.6.2] - 2026-01-05

### Fixed

- **Deep Trash Detection** - Now walks entire ownership chain (up to 20 levels) to detect trashed nodes
  - Previously only checked immediate `_ownerId` for "TRASH" marker
  - Nodes nested deep inside trashed hierarchies (e.g., 9 levels) were not filtered
  - Added `isNodeInTrash()` helper function for recursive ownership check
  - Filters out 139 additional trashed supertags that were previously showing

## [1.6.1] - 2026-01-05

### Fixed

- **Trash Detection for Supertags** - Supertags in Tana's trash are now filtered from queries
  - Detects trashed nodes by `_ownerId` property containing "TRASH"
  - Filters during both indexing (supertag-metadata.ts) and queries (UnifiedSchemaService)
  - Prevents stale/deleted supertags from appearing in search results

- **Playwright Export Build** - Fixed `supertag-export` binary failing with "Cannot find package 'playwright'"
  - Build now uses `--external` flags for playwright and related packages
  - Requires global playwright installation: `bun add -g playwright`
  - Requires `NODE_PATH` environment variable pointing to global node_modules
  - Updated installation docs for all platforms (macOS, Linux, Windows)

## [1.6.0] - 2026-01-04

### Added

- **Inheritance-Aware Tag Search** - New `--include-descendants` flag for `search --tag` command
  - Finds all supertags inheriting from the specified tag using recursive CTE
  - Queries for nodes with ANY of the descendant tags
  - Example: `search --tag "Source | Origin" --include-descendants` returns nodes tagged with todo, project, Area, meeting, etc. (40 descendant tags)
  - Uses same hierarchy traversal logic as `tags visualize` command
  - Case-insensitive tag name matching for robust lookups
  - Enables "Options from Supertag" fields in Raycast and other tools to show all relevant nodes

- **Schema Registry Export (Spec 081)** - Enhanced schema-registry.json with target supertag metadata
  - `FieldSchema` interface now includes optional `targetSupertag` property with `id` and `name`
  - `UnifiedSchemaService.toSchemaRegistryJSON()` exports target supertag for reference fields
  - Enables Raycast and other tools to read target supertags directly from cached JSON file
  - Backward compatible - tools using old schema format continue to work
  - Performance: Eliminates need for CLI spawning in external tools (200-500ms → <10ms)
  - 62 tests passing including enhanced schema export

- **Target Supertag Extraction (Spec 077)** - Reference fields now store actual target supertag from Tana definition
  - New database columns `target_supertag_id` and `target_supertag_name` in `supertag_fields` table
  - Extracts target supertag from "Selected source supertag" tuple in field definitions
  - Replaces field name heuristics with precise Tana metadata
  - `tags fields` command now includes `targetSupertagId` and `targetSupertagName` in JSON output
  - Enables correct dropdown population in Raycast and other integrations
  - Fixes "Options from Supertag" fields where field name doesn't match target supertag name (e.g., "Company" field → "company" supertag)
  - Database migration automatically runs on first sync after update
  - 18 tests passing including extraction, storage, and service layer integration

### Fixed

- **Tag Resolution** - `isTagId()` now correctly distinguishes Tana IDs from kebab-case tag names
  - Requires mixed case (both uppercase and lowercase) to identify as ID
  - Fixes commands failing on tags like "outcome-goal", "value-goal", etc.
  - Previously these were incorrectly treated as IDs due to matching `/^[A-Za-z0-9_-]{8,}$/`
  - Now requires both `/[A-Z]/` and `/[a-z]/` patterns for ID detection

## [1.4.1] - 2026-01-03

### Fixed

- **Query: ISO date parsing** - ISO dates (e.g., `2024-12-08`) now work for `created`/`updated` fields
  - Previously only relative dates (`7d`, `today`) were converted to timestamps
  - Use range queries for exact day matching: `created > 2024-12-07 and created < 2024-12-09`

## [1.4.0] - 2026-01-03

### Added

- **Unified Query Language (Spec 063)** - SQL-like query syntax for complex filtering
  - New `supertag query "find task where Status = Done"` CLI command
  - New `tana_query` MCP tool with structured input
  - SQL-like syntax: `find <tag> where <conditions> order by <field> limit <n>`
  - Operators: `=` (exact), `~` (contains), `>`, `<`, `>=`, `<=`, `exists`, `not`
  - Logical operators: `and`, `or` with parentheses grouping
  - Relative dates: `today`, `yesterday`, `7d`, `1w`, `1m`, `1y`
  - Parent path queries: `parent.tags`, `parent.name`
  - Field projection with `select` parameter
  - Sorting with `-field` for descending order
  - All standard output formats supported
  - 8 new test files with comprehensive coverage

- **Batch Operations (Spec 062)** - Fetch or create multiple nodes in a single request
  - New `supertag batch get <ids...>` command to fetch multiple nodes by ID
    - Supports stdin input: `echo "id1\nid2" | supertag batch get --stdin`
    - Supports combined positional and stdin IDs
    - Efficient SQL query (no N+1 queries)
    - Max 100 nodes per request
  - New `supertag batch create` command to create multiple nodes at once
    - Supports JSON file input: `supertag batch create --file nodes.json`
    - Supports stdin: `cat nodes.json | supertag batch create --stdin`
    - Dry-run mode for validation: `--dry-run`
    - Max 50 nodes per request
  - New MCP tools: `tana_batch_get` and `tana_batch_create`
  - All standard format options supported (json, csv, table, ids, minimal, jsonl)
  - 46 new tests

- **Universal Format Options (Spec 060)** - Extended output formatting from 3 modes to 6 formats
  - New `--format <type>` option on all standard commands
  - Formats: `json`, `table`, `csv`, `ids`, `minimal`, `jsonl`
  - Smart TTY detection: `table` format for terminals, `json` for pipes
  - `SUPERTAG_FORMAT` environment variable for default format
  - Config file support via `output.format` setting
  - Backward compatible with `--json` and `--pretty` flags
  - New formatters:
    - `CsvFormatter`: RFC 4180 compliant CSV with proper escaping
    - `IdsFormatter`: One ID per line for `xargs` piping
    - `MinimalFormatter`: JSON projection to id, name, tags only
    - `JsonlFormatter`: JSON Lines format for streaming
  - `--no-header` option for CSV/table formats
  - 24 new integration tests

## [1.3.4] - 2026-01-01

### Fixed

- **Update Install (Spec 058 bugfix)** - Fixed `ENOTSUP: operation not supported on socket` error when installing updates
  - The `installUpdate` function now properly unlinks the target file before copying
  - Fixes installation on symlinked binaries and other special file types

## [1.3.3] - 2026-01-01

### Added

- **Version Update Checker (Spec 058)** - Automatic update detection and self-update capability
  - New `supertag update check` command to check for available updates
  - New `supertag update download` command to download updates to local cache
  - New `supertag update install` command with automatic backup and rollback on failure
  - Passive notifications on CLI startup when updates are available
  - GitHub Releases API integration with 24-hour cache to respect rate limits
  - Platform detection for correct binary downloads (darwin-arm64, darwin-x64, linux-x64)
  - Configurable behavior: `updateCheck: 'enabled' | 'disabled' | 'manual'` in config

### Changed

- **Unified Logger (Spec 057)** - Migrated core infrastructure to centralized logging system
  - Consistent log levels (debug/info/warn/error) across all modules
  - Structured logging with context objects
  - Child loggers for component-specific logging
  - JSON and pretty output modes

- **Batch Workspace Processor (Spec 056)** - New `processWorkspaces()` utility for multi-workspace operations
  - Sequential and parallel execution modes
  - Progress callbacks for status reporting
  - Migrated sync, embed, and tana-export commands to use batch processor

- **Query Builder Utilities (Spec 055)** - Safe SQL query construction helpers
  - `buildPagination()` for LIMIT/OFFSET with safe defaults
  - `buildOrderBy()` with column whitelist validation
  - `buildWhereClause()` for parameterized WHERE conditions
  - `buildSelectQuery()` for complete query composition
  - 53 tests with 108 assertions

- **Output Formatter Consolidation (Spec 054)** - Unified output formatting across CLI
  - `OutputFormatter` interface with Unix, Pretty, and JSON implementations
  - `resolveOutputMode()` helper for consistent flag handling
  - `createFormatter()` factory for formatter instantiation

- **Database Resource Management (Spec 053)** - RAII-style database connection handling
  - `withDatabase()` for auto-closing database connections
  - `withQueryEngine()` for combined database + query engine handling
  - `withTransaction()` for automatic commit/rollback
  - `withWorkspaceDatabase()` and `withWorkspaceQuery()` for workspace-resolved paths
  - Eliminates try-finally boilerplate, prevents resource leaks
  - Custom `DatabaseNotFoundError` for better error messages

## [1.3.2] - 2025-12-30

### Fixed

- **CLI --children Flag Now Preserves Nested Children** - Fixed bug where `--children` JSON with nested structures silently discarded the nested children
  - Root cause: `parseChildren()` only extracted `name`, `id`, `dataType` - ignored `children` property
  - Added recursive `parseChildObject()` helper to properly handle nested structures
  - Now `--children '{"name": "Section", "children": [{"name": "Item"}]}'` works correctly
  - Added 18 unit tests for CLI children parsing to prevent regression

## [1.3.1] - 2025-12-30

### Added

- **Nested Children Support in Node Creation** - `tana_create` MCP tool and `createNode()` now support hierarchical child structures
  - Children can have their own `children` arrays for deep nesting (e.g., workshop notes with sections and sub-points)
  - Recursive schema validation using `z.lazy()` for type-safe nested structures
  - Both CLI (`supertag create`) and MCP (`tana_create`) support nested children
  - Example: `{"name": "Section 1", "children": [{"name": "Point 1"}, {"name": "Point 2"}]}`
  - Perfect for creating structured notes, outlines, and hierarchical content via AI assistants

## [1.3.0] - 2025-12-28

### Added

- **Code Generation from Supertags (Spec 024)** - Generate type-safe Effect Schema classes from Tana supertag definitions
  - New `supertag codegen generate -o <path>` command for generating TypeScript code
  - Generates Effect Schema.Class definitions with proper type mappings
  - Full inheritance support: child supertags extend parent classes using `.extend()`
  - Topological sorting ensures parent classes are generated before children
  - Multiple optional field strategies: `option` (default), `undefined`, `nullable`
  - Split mode: `--split` generates separate files per supertag with barrel index
  - Dry-run mode: `--dry-run` previews output without writing files
  - Filter by tags: `--tags TodoItem Meeting` generates only specified supertags
  - Metadata comments: includes Tana supertag ID and description (disable with `--no-metadata`)
  - Type mappings: text→String, date→DateFromString, checkbox→Boolean, url→URL pattern, number→Number, reference→String, email→String, options→String
  - Unicode support: handles emoji field names (⚙️Vault → vault) while preserving unicode letters
  - All fields treated as optional since Tana allows sparse data

- **TUI Todo Example Application (Spec 031)** - Terminal-based todo manager demonstrating codegen feature
  - Located in `examples/tui-todo/` with full documentation
  - Uses Ink (React for CLIs) for terminal UI with split-pane layout
  - Reads todos from supertag-cli SQLite database
  - Creates new todos via Tana Input API
  - 35 tests covering TodoService and TanaInputApi
  - Vim-style keyboard navigation (j/k, /search, n/c/h/q)
  - Demonstrates Effect Schema generated from Tana supertags

- **Codegen Documentation** - New comprehensive documentation at `docs/codegen.md`
  - Quick start guide with CLI examples
  - Type mapping reference (Tana → Effect Schema)
  - Optional field strategies (option/undefined/nullable)
  - Supertag inheritance examples
  - Integration with supertag-cli database

## [1.2.3] - 2025-12-28

### Fixed

- **Explicit Field Types in Node Creation** - `createNode()` now uses database field types for Input API payloads
  - Date fields correctly sent as `{ dataType: "date", name: "2025-01-15" }`
  - Reference fields correctly sent as `{ dataType: "reference", id: "nodeId" }`
  - URL fields correctly sent as `{ dataType: "url", name: "https://..." }`
  - Falls back to SchemaRegistry when database unavailable
  - Benefits both CLI (`supertag create`) and MCP (`tana_create`) commands

- **Duplicate Supertag Handling** - Fixed `UnifiedSchemaService.getSupertag()` selecting wrong entry
  - Database can have multiple entries for same supertag name (e.g., 3 "todo" entries)
  - Now selects canonical entry using SchemaRegistry logic: prefer more inheritance parents, then more fields
  - Ensures correct field lookup when creating nodes

## [1.2.2] - 2025-12-27

### Changed

- **Consistent Field Display** - `tags fields` now shows field IDs and types matching `tags show` format
  - Fields now display as: `- FieldName (fieldId)` with `Type: dataType` on next line
  - Inherited fields show origin: `- FieldName (fieldId, from ParentTag)`
  - Shared `formatFieldLines()` helper ensures DRY, consistent output across commands

### Added

- **Inherited Fields in `tags show`** - New `--all` flag shows inherited fields
  - `supertag tags show todo --all` - Shows all 8 fields including inherited
  - Matches functionality of `tags fields --all`
  - Uses `SupertagMetadataService.getAllFields()` for accurate inheritance chain

### Fixed

- **System Field Markers in SchemaRegistry** - `tags show` now displays system fields (Due Date, Date, etc.)
  - SchemaRegistry now extracts system field markers (SYS_A61, SYS_A90, etc.) from tagDef children
  - Fixes inconsistency where `tags show` showed fewer fields than `tags fields`
  - Uses shared `SYSTEM_FIELD_MARKERS` mapping from supertag-metadata.ts (DRY)
  - System fields now visible in all schema-based commands

- **Explicit Field Type Extraction** - Field types now extracted from Tana's typeChoice structure
  - Discovered Tana encodes field types in `typeChoice` tuples with SYS_D* codes:
    - SYS_D01 = checkbox, SYS_D03 = date, SYS_D05 = reference (Options from Supertag)
    - SYS_D06 = text, SYS_D08 = number, SYS_D10 = url, SYS_D11 = email
    - SYS_D12 = options (inline), SYS_D13 = reference (Tana User)
  - Added new DataTypes: `email`, `options` for more accurate field typing
  - Type extraction runs during sync, before value-based inference
  - Reduced "text" type fields from 790 to 509, correctly typing 280+ additional fields
  - Fixes bug where all field types displayed as "text" regardless of actual Tana configuration

- **Value-Based Type Inference** - Fallback inference from actual field values
  - Reference fields correctly detected when values have `_metaNodeId` (e.g., Horizon, Assignee)
  - Date fields correctly detected from value patterns (ISO dates, PARENT+1, etc.)
  - Checkbox fields correctly detected from true/false values
  - Falls back to name-based heuristics when no values exist

## [1.2.1] - 2025-12-26

### Fixed

- **Transcript Search Table Format** - `transcript search --pretty` now uses table format matching documentation
  - Added Meeting ID column to search results table
  - Columns: ID, Meeting, Speaker, Text (truncated to 50 chars)
  - Inline date references in meeting names now parsed correctly

- **CI Test Fixes** - Fixed MCP transcript tests failing on GitHub CI
  - Added database existence check before running tests
  - Fixed TypeScript type errors for workspace parameter

## [1.2.0] - 2025-12-26

### Added

- **Transcript Filtering and Commands (Spec 023)** - Dedicated transcript access with default exclusion from search/embeddings
  - New `supertag transcript list` command - List meetings with transcripts (ID, name, line count, date)
  - New `supertag transcript show <id>` command - Display transcript content with speaker and timing info
  - New `supertag transcript search <query>` command - Full-text search within transcript content only
  - New `--include-transcripts` flag for `embed generate` to opt-in to transcript embedding
  - Transcripts (90K+ lines) excluded from default embeddings to improve search quality
  - MCP tools: `tana_transcript_list`, `tana_transcript_show`, `tana_transcript_search`
  - Optimized batch queries for transcript metadata (30x performance improvement)
  - Pretty table output with `--pretty` flag for transcript list command

- **Expanded System Field Mappings** - Added 12 additional SYS_* field mappings for comprehensive field extraction
  - Core fields: Tag (SYS_A13), Due date (SYS_A61), Date (SYS_A90), Attendees (SYS_A142)
  - Schema fields: Supertag (SYS_T01), Field (SYS_T02), Option value (SYS_T03)
  - Search fields: Search expression (SYS_A15), Search title (SYS_A144)
  - AI/Entity fields: Entity type (SYS_A130)
  - Transcript fields: Speaker (SYS_A150), Transcript speaker (SYS_A252), Start time (SYS_A253), End time (SYS_A254)
  - Internal fields: System reference (SYS_A12), Default value (SYS_A16), Field reference (SYS_A20)

### Fixed

- **Transcript Search Meeting Context** - Fixed `tana_transcript_search` returning null meetingId/meetingName
  - Added meeting context resolution: transcript line → parent transcript → meeting via SYS_A199 tuple
  - Optimized queries using indexed `parent_id` column (reduced from 13s to ~4s)
  - Filters out trashed meetings (`_ownerId` ending with `_TRASH`)

- **Inline Reference Parsing** - Meeting names with inline date references now display properly
  - Parses `<span data-inlineref-date=...>` to readable ISO-8601 dates
  - Applied to both transcript list and transcript show commands

- **System Field Extraction** - Fixed SYS_* fields (Due date, Date, Attendees) not being extracted into `field_values` table
  - System field IDs like `SYS_A61` are synthetic IDs that don't exist in the nodes table
  - `isFieldTuple()` now recognizes SYS_* first children as valid field labels
  - `resolveFieldNameFromTuple()` now looks up SYS_* names from centralized `SYSTEM_FIELD_NAMES` mapping
  - Added tests for Due date (SYS_A61), Date (SYS_A90), and Attendees (SYS_A142) extraction

### Upgrade Notes

**Re-embedding recommended for transcript functionality:**

If you want semantic search to include transcript content, regenerate your embeddings:

```bash
# Default: transcripts excluded (recommended for most users)
supertag embed generate

# Include transcripts in semantic search (90K+ additional nodes)
supertag embed generate --include-transcripts
```

Transcript-specific search is always available via `supertag transcript search` regardless of embedding settings

## [1.1.1] - 2025-12-24

### Added

- **3D Visualization Enhancements**
  - Visible node labels with tag names displayed above each sphere
  - Theme-appropriate label colors (dark text on light, light text on dark)
  - Cursor-following tooltips showing field details and usage stats

- **Ancestor Traversal** - New `--from <tag>` option for visualizing inheritance upwards
  - Shows the specified tag and all its ancestors (parents, grandparents, etc.)
  - Complements `--root <tag>` which shows descendants
  - Works with all visualization formats (mermaid, dot, json, html, 3d)

## [1.1.0] - 2025-12-24

### Added

- **Schema Consolidation (Spec 020)** - Unified database-backed schema storage
  - New `UnifiedSchemaService` class for database-backed schema queries
  - Auto-generates `schema-registry.json` cache after `sync index` (no separate `schema sync` needed)
  - New database columns: `normalized_name`, `description`, `inferred_data_type` for fields
  - New `supertag_metadata` table for tag-level metadata (name, description, color)
  - `getSchemaRegistryFromDatabase()` function for loading schema from database
  - `getTagDetailsFromDatabase()` function with inferred data types
  - `buildNodePayloadFromDatabase()` function for node creation from database
  - MCP `tana_supertag_info` tool now returns `inferredDataType` in field info
  - Utility functions: `normalizeName()`, `inferDataType()`

- **System Field Extraction** - Added support for Tana's built-in system fields
  - `SYS_A90` → "Date" field (used by meeting, calendar-item, appointment supertags)
  - `SYS_A61` → "Due Date" field (used by task, todo, project supertags)
  - `Mp2A7_2PQw` → "Attendees" field (used by meeting supertag)
  - System fields now appear in `supertag tags fields <tag>` output
  - Mapping exported as `SYSTEM_FIELD_MARKERS` for extensibility

- **Supertag Visualization** - New `tags visualize` command for inheritance graph visualization
  - Five output formats: Mermaid (default), Graphviz DOT, JSON, **HTML (interactive 2D)**, and **3D (Three.js)**
  - Filter options: `--root <tag>` for subtrees, `--orphans` to include isolated tags
  - Display options: `--direction` (BT/TB/LR/RL), `--show-fields`, `--show-inherited`, `--colors`, `--theme`
  - Output to file with `--output <file>`, auto-open with `--open`
  - New documentation: `docs/visualization.md` with rendering instructions

- **Interactive HTML Visualization** - Self-contained HTML files with UML-style class diagram nodes
  - Pan & zoom navigation (mouse drag and scroll wheel)
  - Click-to-highlight inheritance paths (ancestors and descendants)
  - UML-style nodes showing tag name, fields (own and inherited), and usage count
  - Light/dark theme support with `--theme` option
  - Hierarchical layout with barycenter ordering to minimize edge crossings
  - No external dependencies - works offline

- **3D Visualization (Spec 021)** - Interactive 3D graph visualization using Three.js
  - `--format 3d` generates self-contained HTML with 3d-force-graph
  - Full 3D camera controls: rotate, pan, zoom with mouse and touch support
  - Click-to-highlight inheritance paths (ancestors and descendants glow)
  - Force-directed layout (default) for natural node clustering
  - `--layout hierarchical` mode positions parents above children
  - `--size-by-usage` scales node size by tag usage count
  - `--theme dark/light` for color scheme preference

- **Field Details in All Formats** - `--show-fields` now shows actual field names in all visualization formats
  - Previously only showed field counts in Mermaid/DOT; now shows field names and types
  - `--show-inherited` displays inherited fields with their origin tag
  - Consistent field display across Mermaid, DOT, JSON, and HTML formats

### Fixed

- **Duplicate Supertag Detection** - Fixed inconsistent tag resolution when multiple tags share the same name
  - `tags show`, `tags fields`, and `tags inheritance` now use consistent preference logic (most inheritance parents, then most fields)
  - Shows warning with all duplicate options: ID, usage count, and field count
  - Supports direct ID access for disambiguation (e.g., `supertag tags show fbAkgDqs3k`)
  - Added tip suggesting to rename duplicates in Tana

- **Tags Show Command** - Fixed "Invalid export format" error in `supertag tags show <tag>`
  - Command was incorrectly loading schema cache as Tana export format
  - Now uses `getSchemaRegistry()` which correctly parses cached registry format

- **Supertag Parent Extraction** - Fixed extraction of parent supertag relationships
  - SYS_A13 inheritance marker is now correctly detected as raw string (not node ID)
  - Parent relationships now properly stored in `supertag_parents` table
  - `supertag tags inheritance <tag>` now shows complete inheritance tree
  - Tag names resolved from nodes table for tagDefs without fields

## [1.0.2] - 2025-12-23

### Added

- **Release Packages Include Documentation** - Release zips now include:
  - `docs/` - Full documentation (MCP setup, embeddings, webhooks, launchd, etc.)
  - `launchd/` - macOS LaunchAgent plist templates
  - `scripts/` - Installation and management scripts

- **Tana Command Integration Guide** - New documentation for setting up Tana Commands
  - Screenshot showing Make API request configuration
  - Payload parameters explained (`${sys:context}`, format, workspace)
  - Examples for semantic search, full-text search, and tagged nodes

### Changed

- **Sync Scheduler Runs Every 6 Hours** - Daily sync now runs 4 times per day
  - Schedule: midnight, 6 AM, noon, 6 PM
  - Command: `supertag sync index`
  - Previous: once daily at 6 AM

- **Improved launchd Documentation** - Path configuration section added
  - Explains placeholder replacement during installation
  - Documents installation from different locations
  - Troubleshooting for wrong paths after moving installation

### Fixed

- **launchd Plist Naming** - Corrected inconsistent naming
  - Renamed from `ch.invisible.tana-*` to `ch.invisible.supertag-*`
  - Scripts now use consistent naming convention
  - Fixed daily plist to use correct `supertag sync index` command

## [1.0.0] - 2025-12-23

### BREAKING CHANGES

This is a major version release with significant CLI restructuring. Legacy commands have been removed.

**Removed Commands** (use new equivalents):
- `supertag query search` → use `supertag search`
- `supertag query tagged` → use `supertag search --tag`
- `supertag query stats` → use `supertag stats --db`
- `supertag query top-tags` → use `supertag tags top`
- `supertag query refs` → use `supertag nodes refs`
- `supertag query recent` → use `supertag nodes recent`
- `supertag show node` → use `supertag nodes show`
- `supertag show tagged` → use `supertag search --tag --show`
- `supertag embed search` → use `supertag search --semantic`
- `supertag embed stats` → use `supertag stats --embed`
- `supertag embed filter-stats` → use `supertag stats --filter`

### Added

#### CLI Harmonization - New Unified Commands

New commands following the `object action` pattern for consistency and discoverability:

- **`supertag search <query>`** - Unified search command
  - Full-text search (default)
  - `--semantic` flag for vector similarity search
  - `--tag <name>` flag for filtering by supertag
  - `--show` flag for full node content display
  - `--depth <n>` for child traversal with --show

- **`supertag nodes show|refs|recent`** - Node operations
  - `nodes show <id>` - Display node contents with depth traversal
  - `nodes refs <id>` - Show references to a node
  - `nodes recent` - Recently updated nodes

- **`supertag tags list|top|show`** - Supertag operations
  - `tags list` - List all supertags
  - `tags top` - Most used supertags
  - `tags show <name>` - Show tag schema

- **`supertag stats`** - Unified statistics
  - `--db` - Database statistics only
  - `--embed` - Embedding statistics only
  - `--filter` - Content filter breakdown

#### Webhook Server RESTful API (T-4)

New RESTful endpoints with consistent API design:

- **POST /search** - Unified search with `type` parameter
  - `type=fts` - Full-text search (default)
  - `type=semantic` - Vector similarity search
  - `type=tagged` - Search by supertag

- **GET /stats** - Unified statistics with `type` parameter
  - `type=all` - All statistics (default)
  - `type=db` - Database stats only
  - `type=embed` - Embedding stats only
  - `type=filter` - Content filter stats

- **RESTful /nodes endpoints**
  - `GET /nodes/:id` - Get node by ID with optional depth
  - `GET /nodes/:id/refs` - Get node references
  - `GET /nodes/recent` - Recently created nodes
  - `POST /nodes/find` - Find nodes by pattern/tag

- **RESTful /tags endpoints**
  - `GET /tags` - List all supertags
  - `GET /tags/top` - Top supertags by usage
  - `GET /tags/:name` - Get tag schema details

**Deprecated webhook endpoints** (still functional, marked for removal):
- `POST /semantic-search` → use `POST /search` with `type=semantic`
- `GET /embed-stats` → use `GET /stats?type=embed`
- `POST /refs` → use `GET /nodes/:id/refs`
- `POST /nodes` → use `POST /nodes/find`
- `POST /tags` → use `GET /tags` or `GET /tags/top`

### Changed

- Help text updated to show new command structure
- Webhook server /help endpoint updated with complete API documentation
- All tests updated for new command structure (457 tests passing)
- Demo scripts updated to use new commands
- README updated with new command examples

## [0.13.4] - 2025-12-21

### Fixed

- **Firebase API Key Extraction** - Login now correctly extracts Firebase Web API key instead of auth token
  - Extracts `entry.value.apiKey` from Firebase IndexedDB
  - Enables token refresh functionality via Firebase API
  - Previous version was extracting auth token (already cached elsewhere)

## [0.13.3] - 2025-12-21

### Changed

- **Firebase API Key Storage** - Firebase token now stored in `config.json` instead of `.env`
  - `supertag-export --login` saves Firebase API key to `~/.config/supertag/config.json`
  - Centralized configuration in config.json for better management
  - Falls back to `TANA_FIREBASE_API_KEY` environment variable if not in config
  - Existing `.env` files with `FIREBASE_API_TOKEN` can be safely deleted

## [0.13.2] - 2025-12-21

### Changed

- **Documentation Improvements** - Updated README with better workflow and recommendations
  - Added explicit sync step after export in Quick Start
  - Changed recommended embedding model from mxbai-embed-large to bge-m3
  - Clarified workspace configuration examples

## [0.13.1] - 2025-12-21

### Added

- **Automatic Browser Installation** - `supertag-export` now auto-installs Chromium browser on first run
  - No manual `bunx playwright install chromium` needed
  - Auto-detects missing browser before login/discover commands
  - New `supertag-export setup` command for explicit installation
  - Improved first-time user experience with automatic dependency resolution

- **Automatic Workspace Configuration** - `supertag-export discover` now auto-adds first workspace as `main`
  - First discovered workspace (root workspace) automatically configured
  - Sets as default workspace for immediate use
  - Eliminates manual `supertag workspace add` step for primary workspace
  - Shows clear next steps after discovery

### Changed

- **Flat Distribution Structure** - All executables now in same directory
  - Changed from `export/supertag-export` to `./supertag-export`
  - Changed from `mcp/supertag-mcp` to `./supertag-mcp`
  - Simpler extraction: all tools in root directory
  - Run `bun install` from root instead of `cd export && bun install`

## [0.13.0] - 2025-12-20

### Added

- **Firebase Token Extraction** - `supertag-export --login` now automatically extracts Firebase API token
  - Token saved to `.env` as `FIREBASE_API_TOKEN`
  - Polls for successful login and extracts from IndexedDB
  - Updates existing `.env` or creates new one

- **Open Source Release** - Repository is now publicly available on GitHub
  - MIT License
  - CONTRIBUTING.md with development setup and TDD requirements
  - CODE_OF_CONDUCT.md (Contributor Covenant v2.1)
  - SECURITY.md with vulnerability reporting process
  - GitHub issue and PR templates
  - GitHub Actions CI workflow for automated testing

### Fixed

- **TypeScript CI Compatibility** - Resolved all TypeScript errors for clean CI builds
  - Fixed Zod v4 schema compatibility in MCP tools
  - Added missing required parameters to MCP tool tests
  - Fixed type assertions for API responses and union types
  - Use GitHub reference for resona dependency (`github:jcfischer/resona#main`)

## [0.12.0] - 2025-12-20

### Removed

- **Time bombing trial system** - CLI no longer expires
- **LemonSqueezy license integration** - All commands now free and unrestricted
- **License activation/deactivation commands** - `supertag activate`, `supertag deactivate`, `supertag license status` removed
- **License validation on CLI startup** - No more license checks before command execution

### Changed

- **All commands now execute without restrictions** - No license checks or trial expiry
- **Simplified CLI startup** - No network calls for license validation
- **Removed trial status from help text** - Clean help output without licensing information
- **CLI is now fully open and unrestricted** - All features available to all users

### Notes

- Existing license files (`~/.local/share/supertag/license.json`) are no longer used but harmless if present
- No action required for existing users - all features now available without activation

## [0.11.5] - 2025-12-18

### Changed

- **Embedding Backend Migration** - Migrated from sqlite-vec to resona/LanceDB
  - **Breaking**: Existing SQLite-based embeddings are no longer used
  - Run `supertag embed generate` to create new LanceDB embeddings
  - Cross-platform support: no more platform-specific SQLite extensions
  - Embedding config now stored in `~/.config/supertag/config.json` instead of database
  - Removed A/B testing commands (was only for provider comparison during development)

### Removed

- **sqlite-vec dependency** - No longer required
- **@huggingface/transformers dependency** - No longer required
- **Preload scripts** - No longer needed for SQLite extension loading
- **embed ab-test commands** - Development-only feature removed

### Migration Guide

1. Update to latest version
2. Run `supertag embed generate` to regenerate embeddings in LanceDB format
3. Previous SQLite embeddings can be safely deleted from workspace databases

---

## [0.11.5] - 2025-12-14

### Added

- **Embeddings in Daily Pipeline** - `tana-daily` now generates embeddings after sync
  - Full pipeline: export → sync → embed → cleanup
  - New `--embed` flag to run embeddings only
  - New `--no-embed` flag to skip embeddings
  - Multi-workspace support with `--all` flag

### Fixed

- **Symlink Resolution** - `tana-daily` now properly resolves symlinks on macOS
  - Script can be symlinked to `~/bin/` and still find export tools

- **Sync Command** - Fixed sync to use main CLI with proper workspace support
  - `--all` mode now correctly indexes all enabled workspaces

---

## [0.11.4] - 2025-12-13

### Fixed

- **Inline Reference Documentation** - Added important constraint: never end a node with an inline reference
  - ✅ `"Meeting with <span data-inlineref-node=\"id\">John</span> today"`
  - ❌ `"Meeting with <span data-inlineref-node=\"id\">John</span>"`

---

## [0.11.3] - 2025-12-13

### Added

- **Inline Reference Support** - Create inline references using Input API syntax
  - Use `<span data-inlineref-node="NODE_ID">Display Text</span>` in node names or children
  - Works in both node name and child node text

- **CLI Children Option** - New `-c, --children` flag for `supertag create`
  - Add child nodes: `--children "Child text"`
  - Reference nodes: `--children '{"name": "Link", "id": "abc123"}'`
  - Inline references: `--children "See <span data-inlineref-node=\"xyz\">Related</span>"`

### Improved

- **MCP Tool Documentation** - `tana_create` now documents correct reference formats
  - Inline refs: `<span data-inlineref-node="ID">Text</span>`
  - Child refs: `{"name": "...", "id": "..."}`
  - Clearer guidance for AI assistants

- **Embedding Cleanup** - Sync now cleans up embeddings for deleted/modified nodes

- **sqlite-vec Fix** - Indexer now loads custom SQLite before database creation

### Example

```bash
# Create todo with children and inline reference
supertag create todo "Meeting with <span data-inlineref-node=\"abc123\">John</span>" \
  --children "First subtask" \
  --children '{"name": "Assigned to", "id": "person123"}'
```

---

## [0.11.2] - 2025-12-13

### Added

#### Multi-Workspace Webhook Server
- **New**: Webhook server now serves ALL enabled workspaces simultaneously
- **New**: `/workspaces` endpoint lists available workspaces
- **New**: All endpoints accept `workspace` parameter to target specific workspace
- **New**: `/health` returns workspace list and default workspace info
- **Improved**: Server startup shows all loaded workspaces
- **Improved**: Graceful handling of missing databases (skipped with warning)

### Usage

Start server (serves all configured workspaces):
```bash
supertag server start --daemon
```

Query specific workspace:
```bash
# GET endpoints: use query param
curl "http://localhost:3000/stats?workspace=work"

# POST endpoints: include in body
curl -X POST http://localhost:3000/search \
  -H "Content-Type: application/json" \
  -d '{"query": "meeting", "workspace": "personal"}'
```

---

## [0.11.1] - 2025-12-13

### Fixed

#### Embedding Dimension Mismatch Bug
- **Fixed**: Vector table now correctly recreated when configuring embeddings for first time with non-default dimensions
- **Root Cause**: `setEmbeddingConfig()` only checked for dimension *changes*, not first-time setup
- **Impact**: Models like `mxbai-embed-large` (1024d) now work correctly on fresh workspaces
- **New**: Added `--fix` flag to `embed config` command for manual repair of affected databases

### How to Fix Affected Workspaces

If you configured embeddings before v0.11.1 and got dimension mismatch errors:

```bash
supertag embed config --fix -w <workspace>
supertag embed generate -w <workspace>
```

---

## [0.11.0] - 2025-12-13

### Added

#### Embeddings System with Semantic Search
- **New**: Complete embeddings system for vector-based semantic search
- **New**: Multiple embedding providers: Ollama (local), Transformers.js (lightweight)
- **New**: sqlite-vec integration for vector storage and similarity search
- **New**: `embed config` - Configure embedding provider and model
- **New**: `embed generate` - Generate embeddings for nodes with content filtering
- **New**: `embed search` - Semantic search with similarity scores
- **New**: `embed stats` - Show embedding statistics
- **New**: Content filtering (min length, exclude timestamps, system types)
- **New**: Entities bypass min-length filter to preserve meaningful short nodes
- **New**: AB testing infrastructure for provider comparison

#### Entity Detection
- **New**: Entity detection based on Tana developer insights (`props._flags`)
- **New**: `isEntity()`, `isEntityById()`, `findNearestEntityAncestor()` functions
- **New**: Entities are "interesting" nodes: tagged items, library items, "Create new" items
- **New**: Fallback inference via supertags and library ownership

#### Semantic Search MCP Tool
- **New**: `tana_semantic_search` MCP tool for AI assistants
- **New**: Natural language queries find conceptually similar content
- **New**: Configurable similarity threshold (0-1)
- **New**: Optional ancestor context for nested fragments
- **New**: Entity detection in search results

#### Database Improvements
- **New**: Database retry utilities with exponential backoff for concurrent access
- **New**: `withDbRetry()` and `withDbRetrySync()` for lock handling

#### Test Suite Improvements
- **New**: Separated fast (~10s) and slow (~110s) test suites
- **New**: `bun run test` - Fast tests only
- **New**: `bun run test:slow` - Slow integration tests
- **New**: `bun run test:full` - Complete test suite
- **New**: `bun run precommit` - Alias for full suite

### Changed

#### Workspace Discovery Refactoring
- **Changed**: `supertag-export discover` now uses Tana's `appState.nodeSpace.openFiles` instead of network traffic capture
- **Improved**: Much more reliable workspace discovery - finds all workspaces instantly after app initialization
- **Changed**: Removed `sizeBytes` from discovered workspace data (not available in appState)
- **Added**: `isRootFile` flag to identify user's primary workspace
- **Changed**: Results now sorted with root workspace first, then by node count (largest first)
- **Technical**: Uses `page.evaluate()` to query Tana's internal state directly in browser context

---

## [0.10.1] - 2025-12-12

### Changed

#### Centralized Version Management
- **New**: Single source of truth for version in `package.json`
- **New**: `src/version.ts` module exports VERSION constant
- **Changed**: All CLIs, MCP server, and webhook server now import version from central module
- **Fixed**: Version drift between tools (supertag-export was 0.8.0, now synced to 0.10.1)
- **Impact**: Future version bumps only require changing `package.json`

### Fixed

#### supertag-export Symlink Resolution
- **Fixed**: `supertag-export` now works when called via symlink from any directory
- **Root Cause**: Wrapper script's `BASH_SOURCE[0]` returned symlink path instead of actual script location
- **Fix**: Added symlink resolution loop to follow chain to real file location
- **Impact**: `supertag-export` command now works from any working directory

---

## [0.10.0] - 2025-12-12

### Added

#### Search Result Filtering & Deduplication
- **New**: Shared filtering module (`search-filter.ts`) used by CLI, MCP, and webhook server
- **New**: Filter out reference-syntax text nodes (`[[Something]]` literal names) from search results
- **New**: Deduplicate search results by name+tags, keeping highest similarity match
- **New**: Nodes with same name but different tags preserved (e.g., "Animal #topic" vs "Animal #concept")
- **New**: Over-fetch pattern (3x requested limit) ensures enough results after filtering/deduplication

#### Entity Stats in filter-stats Command
- `embed filter-stats` now shows entity detection statistics at the end
- Shows breakdown: With override, Automatic (_flags), Tagged items, Library items
- Indicates whether using native `_flags` or inferred detection

#### Database Path in Stats
- `embed stats` now displays the database path being queried

### Changed

#### Short Text Embedding Support
- **Changed**: Lowered default `minLength` from 15 to 3 characters
- **Reason**: Testing confirmed mxbai-embed-large produces semantically meaningful embeddings for short text:
  - Animal-Mammal: 88.2% similarity (correctly high)
  - John-Animal: 57.1% similarity (correctly low)
- **Impact**: Names, concepts, and short terms now get embedded
- **Note**: Very short noise (<3 chars like `*`, `..`) still filtered

### Fixed

#### Entity Detection Using _flags from Export
- **Fixed**: Entity detection now correctly reads `props._flags` (with underscore prefix) from Tana exports
- **Fixed**: Zod schema in `tana-dump.ts` now includes `_flags` and `_entityOverride` fields
- **Fixed**: Added `.passthrough()` to PropsSchema to preserve additional underscore-prefixed props during parsing
- **Root Cause**: Tana exports use `_flags` with underscore, not `flags`. Zod was stripping unknown fields.
- **Impact**: ~13,735 entities now detected via `_flags=1` (previously only ~12k via tag/library inference)

#### Content Filter Entities Bypass Length
- **Fixed**: Entities now bypass the minLength content filter for embeddings
- **Root Cause**: Short-named entities like "Animal #topic" (6 chars) were filtered out by default 15-char minimum
- **Impact**: Entities + filters increased from 7,251 to 12,564 nodes eligible for embedding
- **Logic**: `LENGTH(name) >= minLength OR is_entity` ensures meaningful short entities get embedded

#### Embedding Schema Migration Safety
- **Fixed**: `migrateEmbeddingSchema()` now checks if `embeddings` table exists before ALTER
- **Fixed**: `getEmbeddingConfig()` now checks if `embedding_config` table exists before querying
- **Root Cause**: Functions assumed tables exist, causing crashes on fresh databases
- **Impact**: `embed stats` and `embed filter-stats` now work gracefully without embeddings configured

---

## [0.9.9] - 2025-12-12

### Fixed

#### Webhook Server Bug Fixes
- **Fixed**: Webhook server routes not being registered due to async CORS plugin initialization race condition
- **Fixed**: Search results Tana paste format - removed query from header to prevent Tana's field parser from breaking table view
  - Before: `- Search Results: Pizza %%view:table%%` (colon confused Tana parser)
  - After: `- Search Results %%view:table%%` (matches semantic search format)

---

## [0.9.8] - 2025-12-12

### Fixed

#### Semantic Search Improvements
- **Fixed**: Semantic search now returns proper Tana Paste references using `[[Name^nodeID]]` syntax instead of creating duplicate nodes
- **Fixed**: Semantic search now filters out nodes with `_TRASH` ancestors to reduce deleted node pollution
- **Fixed**: Return actual workspace name in search results instead of hardcoded "default"
- **Known Limitation**: Some deleted nodes may still appear in results because Tana's JSON export doesn't include comprehensive deletion metadata

---

## [0.9.7] - 2025-12-12

### Changed

#### Recommended Embedding Model: mxbai-embed-large
- **Breaking**: Changed default/recommended embedding model from `nomic-embed-text` to `mxbai-embed-large`
- A/B testing showed mxbai-embed-large significantly outperforms nomic-embed-text:
  - 3x better differentiation of short text (15% collision rate vs 45%)
  - More relevant search results with proper similarity scoring
  - Higher dimensional embeddings (1024d vs 768d) capture more semantic nuance
- **Note**: Changing models requires embedding regeneration (`supertag embed generate`)

#### Database Lock Retry Logic
- Added exponential backoff retry for database lock errors during embedding generation
- Retries up to 5 times with delays: 100ms → 200ms → 400ms → 800ms → 1600ms
- Includes jitter to prevent thundering herd on concurrent access
- Improves reliability when running embedding generation alongside other database operations

---

## [0.9.6] - 2025-12-11

### Added

#### Contextualized Embeddings
- Embeddings now include ancestor context for improved semantic search quality
- Short text like person names now embedded with context: "Contact: Switch | Monika Stucki"
- Schema updated with `ancestor_id` and `context_text` columns for traceability
- New `buildContextualizedNode()` function uses `findMeaningfulAncestor()` for context resolution
- Format options:
  - Node with supertag: "Tag: NodeName"
  - Node with tagged ancestor: "Tag: AncestorName | NodeName"
  - Node without context: "NodeName"
- **Note**: Requires embedding regeneration with `supertag embed generate`

### Changed

- MCP search tool now uses `engine.rawDb` instead of `engine.db` for ancestor resolution
- Integration tests skip gracefully on database errors (schema migration needed)
- Search results include ancestor context when available

---

## [0.9.5] - 2025-12-11

### Added

#### Multi-Workspace Embedding Support
- All embed commands now support `-w, --workspace <alias>` flag
- `embed generate --all-workspaces` processes all enabled workspaces sequentially
- Automatic fallback to legacy database for read operations (search, stats)
- Workspace name displayed in command output headers

#### Improved Embedding Generation
- Live progress reporting with ETA calculation during `embed generate`
- Periodic WAL checkpoints every 100 embeddings for durability
- Error sampling captures first 10 error messages for debugging
- Rate calculation shows embeddings/second during processing

### Changed

#### Increased Default Minimum Length to 15 Characters
- Default `--min-length` increased from 10 to 15 characters
- Prevents embedding model collision on short text (person names, etc.)
- Root cause: Ollama's nomic-embed-text returns identical vectors for different short texts (~10 chars)
- Longer text produces semantically distinct embeddings
- Use `--min-length 10` to restore previous behavior if needed

### Fixed

#### Embedding Vector Corruption Bug
- Fixed Float32Array buffer reuse bug that caused identical vectors for different nodes
- Root cause: `Buffer.from(embedding.buffer)` without byteOffset/byteLength
- Fixed with `Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength)`
- **Note**: Existing embeddings may be corrupted; regenerate with `supertag embed generate`

---

## [0.9.4] - 2025-12-11

### Added

#### MCP Semantic Search Tool
- `tana_semantic_search` - New MCP tool for vector similarity search
- Finds conceptually related content without exact keyword matches
- Returns results ranked by similarity score (0-1)
- Supports `minSimilarity` threshold filtering
- Includes supertags on matched nodes
- `includeContents` parameter for full node details (fields, children, tags)
- `depth` parameter for child traversal (0-3) when includeContents is true
- Improved sqlite-vec extension loading for MCP server context

#### Smart Ancestor Resolution for All Search
- Automatic detection of meaningful containing nodes (projects, meetings, people, etc.)
- When a search matches a nested fragment, shows the nearest ancestor with a supertag
- Includes path from ancestor to matched node for context
- Works for both full-text search (`query search`, `tana_search`) and semantic search (`embed search`, `tana_semantic_search`)
- Enabled by default; disable with `--no-ancestor` (CLI) or `includeAncestor: false` (MCP)
- Example: searching for "meeting notes" shows the containing #meeting or #project

#### Smart Content Filtering for Embeddings
- Intelligent filtering reduces embedding workload by ~43% while preserving semantic value
- Excludes system/structural nodes (tuple, metanode, viewDef, etc.) that have no search value
- Filters short noise like "Mhm.", "Yes.", "*" (default: <10 characters)
- Excludes timestamp artifacts from imports (1970-01-01...)
- `supertag embed filter-stats` - New command showing filtering breakdown by docType

#### New CLI Options for embed generate
- `--min-length <n>` - Set minimum name length (default: 10)
- `--include-all` - Bypass all content filters
- `--include-timestamps` - Include timestamp-like nodes
- `--include-system` - Include system docTypes
- `-v, --verbose` - Show detailed filter information

#### Rich Display for Semantic Search Results
- `--show` flag displays full node contents (fields, children, tags) in search results
- `--depth <n>` enables child traversal when using --show (default: 0)
- `-a, --ancestor` / `--no-ancestor` - Enable/disable ancestor resolution (default: enabled)
- Works with both table and JSON output formats
- Reuses display logic from `show node` command for consistent output

### Changed
- `embed generate` now applies smart content filtering by default
- `embed stats` now shows content filter statistics
- MCP server now exposes 8 tools (added `tana_semantic_search`)
- `query search` now shows ancestor context by default (use `--no-ancestor` to disable)
- `tana_search` MCP tool now includes `includeAncestor` parameter (default: true)
- Exported `getNodeContents`, `formatNodeOutput`, and related functions from show.ts for reuse
- Exported `findMeaningfulAncestor` from ancestor-resolution.ts for reuse
- Added `rawDb` getter to TanaQueryEngine for direct SQLite access

---

## [0.9.3] - 2025-12-11

### Added

#### Vector Embeddings for Semantic Search
- New embedding subsystem with provider abstraction layer
- Support for **Ollama** (local server) and **Transformers.js** (serverless local) embedding providers
- `supertag embed config` - Configure embedding provider and model
- `supertag embed generate` - Generate embeddings for indexed nodes
- `supertag embed search <query>` - Semantic similarity search
- `supertag embed stats` - Show embedding statistics and coverage
- Uses sqlite-vec for efficient KNN vector search
- Change detection via text hashing (skips unchanged nodes)
- Batch processing with progress reporting

#### Supported Embedding Models
- **Ollama**: nomic-embed-text (768d), mxbai-embed-large (1024d), all-minilm (384d), bge-m3 (1024d)
- **Transformers.js**: Xenova/all-MiniLM-L6-v2 (384d), Xenova/bge-small-en-v1.5 (384d), Xenova/bge-base-en-v1.5 (768d), and more

### Technical Notes
- Compiled binaries require the sqlite-vec native extension (`vec0.dylib`/`vec0.so`) placed alongside the binary
- Cloud providers (Voyage AI, OpenAI) planned for future release

---

## [0.9.2] - 2025-12-11

### Changed

#### Documentation Improvements
- Added `--quiet` flag to mcphost examples for cleaner output
- Updated model comparison test results with Claude Code baseline
- Documented date awareness differences between Claude Code and local LLMs
- Added guidance for using datetime MCP with local LLMs

---

## [0.9.1] - 2025-12-11

### Added

#### Date Range Filtering for Queries
- New date range options for query commands: `--created-after`, `--created-before`, `--updated-after`, `--updated-before`
- Filter nodes by creation or update date (supports YYYY-MM-DD and ISO 8601 formats)
- Applied to `search`, `nodes`, `tagged`, and `recent` commands
- MCP tools `tana_search` and `tana_tagged` also support date range filtering
- Useful for queries like "meetings in Q1 2024" or "todos created this week"

---

## [0.9.0] - 2025-12-10

### Added

#### MCP Server for AI Tool Integration
- New `supertag-mcp` binary providing Model Context Protocol server
- 7 MCP tools: `tana_search`, `tana_tagged`, `tana_stats`, `tana_supertags`, `tana_node`, `tana_create`, `tana_sync`
- Support for ChatGPT Desktop, Cursor, VS Code Copilot, Claude Code, and Windsurf
- Local execution with stdio JSON-RPC - no cloud, no network exposure
- `tana_create` supports creating nodes with field values and child references
- `tana_sync` enables triggering reindex or checking sync status from AI tools

#### Reference Support in Node Creation
- Added `children` parameter to `tana_create` for proper reference/link creation
- Child nodes with `{name, id}` create clickable links to existing nodes
- Documentation added warning that inline `[[text^nodeId]]` syntax doesn't work in node names

### Fixed

#### Export Format Compatibility
- Handle new Tana export format where data is wrapped in `storeData` object
- Graceful handling of both old and new export formats

#### Configuration Namespace
- Renamed config namespace from `~/.config/tana/` to `~/.config/supertag/`
- Avoids conflicts with official Tana app's configuration

---

## [0.8.0] - 2025-12-08

### Added

#### Release Automation
- New `release.sh` script for automated builds and releases
- Vite build step for optimized bundles
- `--push` option for automatic git tag pushing
- External flags for Playwright in release builds

#### Export Cleanup
- `supertag sync cleanup` command to remove old export files
- Configurable retention with `--keep N` option
- `--dry-run` mode to preview deletions
- Auto-cleanup option in config

#### Depth Traversal
- `supertag show node <id> -d <depth>` for traversing child nodes
- JSON output support with `--json` flag
- Improved export file handling

### Changed

- Config namespace renamed from `tana` to `supertag` for clarity
- LaunchAgent renamed to `ch.invisible.supertag-daily`

---

## [0.7.0] - 2025-12-06

### Added

#### LemonSqueezy License System
- License key activation with `supertag activate <key>`
- Per-device activation with customizable device names
- `supertag license status` to check license state
- `supertag deactivate` to free up activation slots
- 3-day grace period after expiration
- Offline validation with periodic re-validation

#### Cross-Platform Support
- Platform-specific binaries for macOS (ARM/Intel), Linux x64, Windows x64
- XDG Base Directory compliance for config paths
- Portable log directory using XDG_STATE_HOME

### Changed

- Two-tool architecture: `supertag` (main CLI) + `supertag-export` (browser automation)
- Auto-install Chromium browser on first `supertag-export` run

---

## [0.6.0] - 2025-12-04

### Added

#### Multi-Workspace Support
- `supertag workspace add <id> --alias <name>` for managing multiple workspaces
- `supertag workspace list` and `supertag workspace set-default`
- Batch operations with `--all` flag (export, sync, cleanup)
- Per-command workspace selection with `-w <alias>`
- Automatic workspace discovery via `supertag-export discover --add`

#### Unified CLI Architecture
- Consolidated all tools into single `supertag` CLI
- Case-sensitive supertag names
- Multiple supertag support with comma-separated syntax
- Unified create command with inheritance support

### Changed

- Major refactor to CLI-first architecture
- Improved schema registry with field inheritance

---

## [0.5.0] - 2025-12-01

### Added

#### Export Automation
- Browser-based export via Playwright
- Session persistence (login once, export forever)
- `supertag-export login` for initial authentication
- `supertag-export run` for automated exports
- Verbose mode showing authentication method used

#### Query Engine
- SQLite FTS5 full-text search
- `supertag query search <term>` with relevance ranking
- `supertag query tagged <supertag>` for filtering by tag
- `supertag query stats` for database statistics
- `supertag query top-tags` for supertag usage counts

#### Write Capability
- `supertag create <supertag> <name>` for node creation
- Dynamic field support via `--field value` syntax
- JSON input via stdin with `supertag post`
- Tana Paste format output with `supertag format`

#### Webhook Server
- `supertag server start` with daemon mode
- REST API endpoints for search, stats, tags, nodes, refs
- Returns Tana Paste format for seamless integration

### Performance
- 107k nodes/second indexing
- <50ms search latency
- ~500MB database for 1M nodes
