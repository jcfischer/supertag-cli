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
