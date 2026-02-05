/**
 * Read Backend Interface & Canonical Types
 * Spec: F-097 Live Read Backend
 * Task: T-1.1
 *
 * Defines the TanaReadBackend interface for read/search operations.
 * Two implementations:
 * - LocalApiReadBackend: Live reads from Tana Desktop Local API
 * - SqliteReadBackend: Indexed reads from SQLite (export-based)
 *
 * Canonical types normalize responses from both backends so consumers
 * don't need to know which backend is active.
 */

// =============================================================================
// Backend Type
// =============================================================================

export type ReadBackendType = 'local-api' | 'sqlite';

// =============================================================================
// Canonical Types
// =============================================================================

/**
 * Canonical search result — normalized from both Local API SearchResultNode
 * and SQLite FTS query rows.
 */
export interface ReadSearchResult {
  id: string;
  name: string;
  tags: string[];          // Tag names (resolved from IDs in both backends)
  rank?: number;           // FTS rank (SQLite only, omitted for Local API)
  description?: string;    // Node description
  created?: string;        // ISO timestamp
  breadcrumb?: string[];   // Path breadcrumb (Local API only, omitted for SQLite)
}

/**
 * Canonical node content — normalized from Local API markdown response
 * and SQLite row + children queries.
 */
export interface ReadNodeContent {
  id: string;
  name: string;
  description?: string;
  markdown: string;        // Full content as markdown
  tags?: string[];
  children?: ReadNodeContent[];  // When depth > 0
}

/**
 * Canonical tag info — same shape from both backends.
 */
export interface ReadTagInfo {
  id: string;
  name: string;
  color?: string;
  instanceCount?: number;  // SQLite can count, Local API may not
}

/**
 * Paginated response wrapper.
 */
export interface PaginatedResult<T> {
  items: T[];
  total?: number;     // Not always available from Local API
  hasMore: boolean;
}

// =============================================================================
// Search Options
// =============================================================================

export interface SearchOptions {
  limit?: number;
  offset?: number;
  createdAfter?: number;   // Epoch ms
  createdBefore?: number;
  updatedAfter?: number;
  updatedBefore?: number;
}

// =============================================================================
// TanaReadBackend Interface
// =============================================================================

/**
 * Unified read backend interface for Tana data.
 *
 * Two implementations:
 * - LocalApiReadBackend: Live reads from Tana Desktop (localhost:8262)
 * - SqliteReadBackend: Reads from indexed SQLite database
 *
 * Consumers use resolveReadBackend() to get the best available backend.
 * The resolver never throws — it falls back to SQLite silently.
 */
export interface TanaReadBackend {
  /** Which backend implementation is active */
  readonly type: ReadBackendType;

  /**
   * Text search across node names.
   * Local API: structured search with textContains
   * SQLite: FTS5 query
   */
  search(query: string, options?: SearchOptions): Promise<ReadSearchResult[]>;

  /**
   * Read a single node's content.
   * Local API: GET /nodes/{id} → markdown
   * SQLite: row + children query → formatted markdown
   */
  readNode(nodeId: string, depth?: number): Promise<ReadNodeContent>;

  /**
   * Get paginated children of a node.
   * Local API: GET /nodes/{id}/children
   * SQLite: direct children query
   */
  getChildren(nodeId: string, options?: { limit?: number; offset?: number }): Promise<PaginatedResult<ReadNodeContent>>;

  /**
   * List available supertags.
   * Local API: GET /workspaces/{id}/tags
   * SQLite: supertag_metadata table
   */
  listTags(options?: { limit?: number }): Promise<ReadTagInfo[]>;

  /**
   * Whether this backend has live (real-time) data.
   * True for Local API, false for SQLite.
   */
  isLive(): boolean;

  /**
   * Clean up resources (close DB connections, etc.)
   */
  close(): void;
}
