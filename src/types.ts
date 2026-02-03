/**
 * Type definitions for Tana integration
 */

/**
 * Tana Paste Node structure (for formatting)
 * Represents a node in the Tana Paste hierarchical format
 */
export interface TanaNode {
  /** The node's name/title */
  name: string;
  /** Optional supertag (e.g., "meeting", "task", "note") */
  supertag?: string;
  /** Optional fields as key-value pairs */
  fields?: Record<string, string | string[] | TanaNode[]>;
  /** Optional child nodes */
  children?: TanaNode[];
}

/**
 * Tana Input API Payload
 * Structure for sending data to the Tana Input API
 */
export interface TanaApiPayload {
  /** Target node ID (INBOX, SCHEMA, or specific node ID) */
  targetNodeId: string;
  /** Array of nodes to create */
  nodes: TanaApiNode[];
}

/**
 * Tana Input API Node
 * Individual node structure for the Input API
 */
export interface TanaApiNode {
  /** Node name/title */
  name: string;
  /** Optional description */
  description?: string;
  /** Optional supertags with IDs */
  supertags?: Array<{ id: string }>;
  /** Optional child nodes (can be regular nodes or field nodes) */
  children?: (TanaApiNode | TanaApiFieldNode | TanaApiDateNode | TanaApiReferenceNode)[];
  /** Optional type for special node types */
  type?: 'field';
  /** Optional attribute ID for field nodes */
  attributeId?: string;
  /** Optional data type for typed fields */
  dataType?: 'date' | 'reference' | 'url' | 'email' | 'number' | 'checkbox';
  /** Optional ID for reference nodes */
  id?: string;
}

/**
 * Tana Input API Field Node
 * Field node with attributeId
 */
export interface TanaApiFieldNode {
  /** Type must be 'field' */
  type: 'field';
  /** Attribute ID for the field */
  attributeId: string;
  /** Child nodes (values for the field) */
  children: (TanaApiNode | TanaApiDateNode | TanaApiReferenceNode)[];
}

/**
 * Tana Input API Date Node
 * Date field value
 */
export interface TanaApiDateNode {
  /** Data type must be 'date' */
  dataType: 'date';
  /** Date string value (YYYY-MM-DD or ISO format) */
  name: string;
}

/**
 * Tana Input API Reference Node
 * Reference field value
 */
export interface TanaApiReferenceNode {
  /** Data type must be 'reference' */
  dataType: 'reference';
  /** Reference ID */
  id: string;
}

/**
 * Tana API Response
 * Response structure from the Input API
 */
export interface TanaApiResponse {
  /** Success status */
  success: boolean;
  /** Created node IDs */
  nodeIds?: string[];
  /** Error message if failed */
  error?: string;
}

/**
 * Cleanup configuration for export retention
 */
export interface CleanupConfig {
  /** Number of export files to keep (default: 7) */
  keepCount?: number;
  /** Whether to run cleanup automatically after sync (default: false) */
  autoCleanup?: boolean;
}

/**
 * Embedding configuration for semantic search
 */
export interface EmbeddingConfig {
  /** Embedding model name (e.g., "mxbai-embed-large", "nomic-embed-text") */
  model: string;
  /** Ollama endpoint URL (default: "http://localhost:11434") */
  endpoint?: string;
}

/**
 * Configuration for Tana CLI
 * Loaded from env vars, config file, or defaults
 */
/**
 * Output configuration (Spec 060)
 */
export interface OutputConfigSettings {
  /** Default output format: json, table, csv, ids, minimal, jsonl */
  format?: 'json' | 'table' | 'csv' | 'ids' | 'minimal' | 'jsonl';
  /** Enable pretty formatting by default */
  pretty?: boolean;
  /** Enable human-readable dates by default */
  humanDates?: boolean;
}

export interface TanaConfig {
  /** API token for authentication */
  apiToken?: string;
  /** API endpoint URL */
  apiEndpoint: string;
  /** Default target node for posting */
  defaultTargetNode: 'INBOX' | 'SCHEMA' | string;
  /** Default workspace alias for all operations */
  defaultWorkspace?: string;
  /** Configured workspaces (alias → WorkspaceConfig) */
  workspaces?: Record<string, WorkspaceConfig>;
  /** Cleanup configuration for export retention */
  cleanup?: CleanupConfig;
  /** Embedding configuration for semantic search */
  embeddings?: EmbeddingConfig;
  /** Firebase Web API key for token refresh (public client-side key) */
  firebaseApiKey?: string;
  /** Update check mode: enabled (default), disabled, or manual */
  updateCheck?: 'enabled' | 'disabled' | 'manual';
  /** Output formatting configuration (Spec 060) */
  output?: OutputConfigSettings;
  /** Local API configuration (F-094) */
  localApi?: {
    /** Whether local API is enabled (default: true) */
    enabled: boolean;
    /** Bearer token from Tana Desktop > Settings > Local API */
    bearerToken?: string;
    /** API endpoint URL (default: http://localhost:8262) */
    endpoint: string;
    /** Minutes between automatic delta-syncs (0 = disabled, default: 5) */
    deltaSyncInterval?: number;
  };
  /** Use Input API as fallback when local API is unavailable (F-094) */
  useInputApiFallback?: boolean;
  /** MCP server configuration (F-095) */
  mcp?: {
    /** Tool registration mode: 'full' (all tools), 'slim' (semantic + mutations), or 'lite' (complement tana-local) */
    toolMode?: 'full' | 'slim' | 'lite';
  };
}

/**
 * Format command options
 */
export interface FormatOptions {
  /** Output format (only tana-paste for MVP) */
  format?: 'tana-paste';
  /** Pretty print JSON input before conversion */
  pretty?: boolean;
}

/**
 * Post command options
 */
export interface PostOptions {
  /** Target node ID (overrides config) */
  target?: string;
  /** API token (overrides config) */
  token?: string;
  /** Dry run - validate but don't post */
  dryRun?: boolean;
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Config command options
 */
export interface ConfigOptions {
  /** Show current configuration */
  show?: boolean;
  /** Set API token */
  token?: string;
  /** Set default target node */
  target?: string;
  /** Set API endpoint */
  endpoint?: string;
}

/**
 * Generic JSON structure for conversion
 * Flexible structure that can be converted to TanaNode
 */
export type GenericJson = Record<string, unknown>;

/**
 * Validation result
 */
export interface ValidationResult {
  /** Is valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Warnings (non-blocking) */
  warnings: string[];
}

/**
 * Todo command options
 */
export interface TodoOptions {
  /** Target node ID (overrides config) */
  target?: string;
  /** API token (overrides config) */
  token?: string;
  /** Dry run - validate but don't post */
  dryRun?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Do Date (YYYY-MM-DD format) */
  doDate?: string;
  /** Focus area (reference ID or name) */
  focus?: string;
  /** Vault (reference ID or name) */
  vault?: string;
  /** Parent task (reference ID or name) */
  parent?: string;
  /** Status (active, next-up, in-review, later, complete, cancelled, waiting) */
  status?: string;
  /** Due Date (YYYY-MM-DD format) */
  dueDate?: string;
}

/**
 * Todo input structure
 */
export interface TodoInput {
  /** Todo name/title (required) */
  name: string;
  /** Description */
  description?: string;
  /** Do Date (YYYY-MM-DD or ISO format) */
  doDate?: string;
  /** Focus area (reference ID or name) */
  focus?: string;
  /** Vault (reference ID or name) */
  vault?: string;
  /** Parent task (reference ID or name) */
  parent?: string;
  /** Status (active, next-up, in-review, later, complete, cancelled, waiting) */
  status?: string;
  /** Due Date (YYYY-MM-DD or ISO format) */
  dueDate?: string;
}

/**
 * Video command options
 */
export interface VideoOptions {
  /** Target node ID (overrides config) */
  target?: string;
  /** API token (overrides config) */
  token?: string;
  /** Dry run - validate but don't post */
  dryRun?: boolean;
  /** Verbose output */
  verbose?: boolean;
  /** Video URL */
  url?: string;
  /** Video summary */
  summary?: string;
  /** Video transcript */
  transcript?: string;
  /** Add towatch tag (for videos to watch later) */
  towatch?: boolean;
}

/**
 * Video input structure
 */
export interface VideoInput {
  /** Video title (required) */
  name: string;
  /** Video URL (required) */
  url: string;
  /** Summary of the video content */
  summary?: string;
  /** Full transcript (optional) */
  transcript?: string;
  /** Add towatch tag */
  towatch?: boolean;
  /** Description */
  description?: string;
}

/**
 * Workspace configuration
 * Defines a single workspace with its nodeid and optional settings
 */
export interface WorkspaceConfig {
  /** Workspace root file ID for API calls - PRIMARY IDENTIFIER (e.g., "7e25I56wgQ") */
  rootFileId: string;
  /** Workspace node ID from Tana URLs - optional, used for deep links (e.g., "CNNkCtMjEo") */
  nodeid?: string;
  /** Human-readable display name */
  name?: string;
  /** Whether this workspace is enabled for batch operations */
  enabled: boolean;
  /** Optional workspace-specific API token override */
  apiToken?: string;
  /** Optional workspace-specific target node override */
  targetNode?: string;
}

/**
 * Resolved workspace context
 * Contains all paths and identifiers needed to work with a workspace
 */
export interface WorkspaceContext {
  /** Alias key (from config) or rootFileId if no alias */
  alias: string;
  /** Workspace root file ID for API calls - PRIMARY IDENTIFIER */
  rootFileId: string;
  /** Workspace node ID for Tana URLs (optional, for deep links) */
  nodeid?: string;
  /** Path to workspace database */
  dbPath: string;
  /** Path to workspace schema cache */
  schemaPath: string;
  /** Path to workspace export directory */
  exportDir: string;
}

// ============================================================================
// Node Builder Types (shared between CLI and MCP)
// ============================================================================

/**
 * Child node input - unified format for both CLI and MCP
 * Used when creating nodes with children via the Input API
 */
export interface ChildNodeInput {
  /** Child node name (may contain inline refs with <span data-inlineref-node="ID">) */
  name: string;
  /** Optional node ID for reference type (creates dataType: 'reference') */
  id?: string;
  /** Data type: 'url' for clickable links, 'reference' for node refs */
  dataType?: 'url' | 'reference';
  /** Nested child nodes for hierarchical structures */
  children?: ChildNodeInput[];
}

/**
 * Node creation input - unified options for both CLI and MCP
 * Provides a common interface for creating nodes via the Input API
 */
export interface CreateNodeInput {
  /** Supertag name(s) - single name or comma-separated list */
  supertag: string;
  /** Node name/title */
  name: string;
  /** Field values as key-value pairs */
  fields?: Record<string, string | string[]>;
  /** Child nodes (plain text, URLs, or references) */
  children?: ChildNodeInput[];
  /** Target node ID (INBOX, SCHEMA, or specific node ID) */
  target?: string;
  /** Validate only, don't post to API */
  dryRun?: boolean;
  /** Override database path (for testing) - internal use only */
  _dbPathOverride?: string;
}

/**
 * Node creation result - unified response for both CLI and MCP
 * Returned after creating a node or validating in dry-run mode
 */
export interface CreateNodeResult {
  /** Was operation successful */
  success: boolean;
  /** Created node ID (only present if not dry run and API call succeeded) */
  nodeId?: string;
  /** Validated payload (always present) */
  payload: TanaApiNode;
  /** Resolved target node ID */
  target: string;
  /** Was this a dry run */
  dryRun: boolean;
  /** Error message if operation failed */
  error?: string;
}

// ============================================================================
// CLI Harmonization Types
// ============================================================================

/**
 * Standard flag options shared across commands
 * Used for CLI harmonization to ensure consistent flags
 */
export interface StandardOptions {
  /** Workspace alias or nodeid (-w, --workspace) */
  workspace?: string;
  /** Database path override (--db-path) */
  dbPath?: string;
  /** Result limit (-l, --limit) - NOT -k */
  limit?: number;
  /** JSON output (--json) - NOT --format json */
  json?: boolean;
  /** Show full content (-s, --show) */
  show?: boolean;
  /** Child traversal depth (-d, --depth) */
  depth?: number;
  // Output formatting options (T-2.1)
  /** Human-friendly output with emojis and tables */
  pretty?: boolean;
  /** Use human-readable date format instead of ISO */
  humanDates?: boolean;
  /** Include technical details (IDs, timing, etc.) */
  verbose?: boolean;
}

/**
 * Search type for unified search command
 * Determines which search engine to use
 */
export type SearchType = "fts" | "semantic" | "tagged";

/**
 * Stats type for unified stats command
 * Determines which statistics to display
 */
export type StatsType = "all" | "db" | "embed" | "filter";

/**
 * Update check mode for controlling automatic update notifications
 * - enabled: Check for updates on CLI startup (default)
 * - disabled: Never check for updates automatically
 * - manual: Only check when explicitly requested via 'supertag update check'
 */
export type UpdateCheckMode = "enabled" | "disabled" | "manual";

// Runtime constant for UpdateCheckMode values (for runtime validation)
export const UpdateCheckMode = {
  ENABLED: "enabled" as const,
  DISABLED: "disabled" as const,
  MANUAL: "manual" as const,
};
