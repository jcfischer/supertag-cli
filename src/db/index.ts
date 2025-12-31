/**
 * Database Module Exports
 *
 * Re-exports database utilities and resource management functions.
 */

// Resource management (with-database.ts)
export {
  // Types
  type DatabaseContext,
  type QueryContext,
  type DatabaseOptions,
  type WorkspaceDatabaseOptions,
  type WorkspaceDatabaseContext,
  type WorkspaceQueryContext,
  // Error classes
  DatabaseNotFoundError,
  // Core functions
  withDatabase,
  withTransaction,
  withQueryEngine,
  // Workspace composition functions
  withWorkspaceDatabase,
  withWorkspaceQuery,
} from "./with-database";

// Schema
export * from "./schema";

// Retry utilities
export { withDbRetry, withDbRetrySync } from "./retry";

// Entity detection
export { isEntity, isEntityById, findNearestEntityAncestor } from "./entity";
