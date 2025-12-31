/**
 * Config Module - Public API
 *
 * Re-exports all configuration-related modules for convenient imports.
 */

// Configuration manager
export { ConfigManager, getConfig, DEFAULT_EMBEDDING_CONFIG } from "./manager";

// Paths and directory utilities
export {
  // Directories
  TANA_CONFIG_DIR,
  TANA_DATA_DIR,
  TANA_CACHE_DIR,
  TANA_LOG_DIR,
  WORKSPACES_DIR,
  BROWSER_DATA_DIR,
  DEFAULT_EXPORT_DIR,
  // Files
  CONFIG_FILE,
  DATABASE_PATH,
  SCHEMA_CACHE_FILE,
  PID_FILE,
  SERVER_CONFIG_FILE,
  // Functions
  ensureDir,
  ensureAllDirs,
  getAllPaths,
  getDatabasePath,
  getWorkspaceDir,
  getWorkspaceDatabasePath,
  getWorkspaceSchemaPath,
  getWorkspaceExportDir,
  ensureWorkspaceDir,
  resolveWorkspace,
  getEnabledWorkspaces,
  needsMigration,
  createSimpleLogger,
  LEGACY_PATHS,
} from "./paths";

// Unified workspace resolver (spec 052)
export {
  // Types
  type ResolvedWorkspace,
  type ResolveOptions,
  // Error classes
  WorkspaceNotFoundError,
  WorkspaceDatabaseMissingError,
  // Functions
  resolveWorkspaceContext,
  listAvailableWorkspaces,
  getDefaultWorkspace,
  withWorkspace,
  clearWorkspaceCache,
} from "./workspace-resolver";

// Batch workspace processor (spec 056)
export {
  // Types
  type BatchOptions,
  type WorkspaceResult,
  type BatchResult,
  type ProgressCallback,
  // Functions
  processWorkspaces,
  resolveWorkspaceList,
  isBatchMode,
  createProgressLogger,
} from "./batch-processor";
