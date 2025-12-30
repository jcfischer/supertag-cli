/**
 * Unified Workspace Resolver
 *
 * Single entry point for all workspace resolution across CLI, Export CLI, and MCP Server.
 * Provides consistent error handling, database validation, and caching.
 *
 * Spec: 052-unified-workspace-resolver
 */

import { existsSync } from "fs";
import { resolveWorkspace, getWorkspaceDatabasePath } from "./paths";
import { ConfigManager } from "./manager";
import type { TanaConfig, WorkspaceConfig, WorkspaceContext } from "../types";

// =============================================================================
// Types
// =============================================================================

/**
 * Resolved workspace context with all paths and metadata
 */
export interface ResolvedWorkspace {
  /** Workspace alias (e.g., 'main', 'books') */
  alias: string;
  /** Workspace configuration from config file */
  config: WorkspaceConfig;
  /** Full path to SQLite database */
  dbPath: string;
  /** Whether this is the default workspace */
  isDefault: boolean;
  /** Original nodeid (for API calls) */
  nodeid?: string;
  /** Original rootFileId (for API calls) */
  rootFileId: string;
}

/**
 * Options for workspace resolution
 */
export interface ResolveOptions {
  /** Workspace alias, nodeid, or rootFileId */
  workspace?: string;
  /** Require database file to exist (default: true) */
  requireDatabase?: boolean;
  /** Override config for testing */
  config?: TanaConfig;
}

// =============================================================================
// Error Classes
// =============================================================================

/**
 * Thrown when workspace alias/id not found in configuration
 */
export class WorkspaceNotFoundError extends Error {
  public readonly name = "WorkspaceNotFoundError";

  constructor(
    public readonly requestedWorkspace: string,
    public readonly availableWorkspaces: string[]
  ) {
    const available =
      availableWorkspaces.length > 0
        ? `\nAvailable: ${availableWorkspaces.join(", ")}`
        : "\nNo workspaces configured.";
    super(`Workspace not found: ${requestedWorkspace}${available}`);
  }
}

/**
 * Thrown when workspace exists but database file is missing
 */
export class WorkspaceDatabaseMissingError extends Error {
  public readonly name = "WorkspaceDatabaseMissingError";

  constructor(
    public readonly workspace: string,
    public readonly dbPath: string
  ) {
    super(
      `Workspace '${workspace}' database not found at: ${dbPath}\n` +
        `Run 'supertag sync' to create the database.`
    );
  }
}

// =============================================================================
// Cache
// =============================================================================

/** Cache for resolved workspaces */
const cache = new Map<string, ResolvedWorkspace>();

/**
 * Clear the workspace cache
 * Call this at MCP request boundaries to prevent stale data
 */
export function clearWorkspaceCache(): void {
  cache.clear();
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Resolve workspace alias to full context
 *
 * @param options - Resolution options
 * @returns Resolved workspace context
 * @throws WorkspaceNotFoundError if alias doesn't exist
 * @throws WorkspaceDatabaseMissingError if requireDatabase and DB missing
 *
 * @example
 * // Use default workspace
 * const ws = resolveWorkspaceContext();
 *
 * @example
 * // Resolve specific workspace
 * const ws = resolveWorkspaceContext({ workspace: 'books' });
 *
 * @example
 * // Allow missing database (for sync command)
 * const ws = resolveWorkspaceContext({
 *   workspace: 'new-workspace',
 *   requireDatabase: false
 * });
 */
export function resolveWorkspaceContext(options?: ResolveOptions): ResolvedWorkspace {
  const config = options?.config ?? ConfigManager.getInstance().getConfig();
  const requireDatabase = options?.requireDatabase ?? true;

  // Determine target workspace
  const targetAlias = options?.workspace ?? config.defaultWorkspace ?? "main";

  // Check cache first
  const cacheKey = targetAlias;
  const cached = cache.get(cacheKey);
  if (cached) {
    // Even if cached, we need to re-check database if required
    if (requireDatabase && !existsSync(cached.dbPath)) {
      throw new WorkspaceDatabaseMissingError(cached.alias, cached.dbPath);
    }
    return cached;
  }

  // Get available workspaces for error messages
  const availableWorkspaces = listAvailableWorkspaces(config);

  // Check if workspace exists in config
  const workspaceConfig = config.workspaces?.[targetAlias];

  if (!workspaceConfig) {
    // Try resolving by nodeid or rootFileId
    let foundAlias: string | undefined;
    let foundConfig: WorkspaceConfig | undefined;

    if (config.workspaces) {
      for (const [alias, ws] of Object.entries(config.workspaces)) {
        if (ws.nodeid === targetAlias || ws.rootFileId === targetAlias) {
          foundAlias = alias;
          foundConfig = ws;
          break;
        }
      }
    }

    if (!foundAlias || !foundConfig) {
      throw new WorkspaceNotFoundError(targetAlias, availableWorkspaces);
    }

    // Use found workspace
    const dbPath = getWorkspaceDatabasePath(foundAlias);
    const isDefault = foundAlias === (config.defaultWorkspace ?? "main");

    if (requireDatabase && !existsSync(dbPath)) {
      throw new WorkspaceDatabaseMissingError(foundAlias, dbPath);
    }

    const resolved: ResolvedWorkspace = {
      alias: foundAlias,
      config: foundConfig,
      dbPath,
      isDefault,
      nodeid: foundConfig.nodeid,
      rootFileId: foundConfig.rootFileId,
    };

    cache.set(foundAlias, resolved);
    return resolved;
  }

  // Workspace found by alias
  const dbPath = getWorkspaceDatabasePath(targetAlias);
  const isDefault = targetAlias === (config.defaultWorkspace ?? "main");

  if (requireDatabase && !existsSync(dbPath)) {
    throw new WorkspaceDatabaseMissingError(targetAlias, dbPath);
  }

  const resolved: ResolvedWorkspace = {
    alias: targetAlias,
    config: workspaceConfig,
    dbPath,
    isDefault,
    nodeid: workspaceConfig.nodeid,
    rootFileId: workspaceConfig.rootFileId,
  };

  cache.set(targetAlias, resolved);
  return resolved;
}

/**
 * Get all configured workspace aliases
 *
 * @param config - Optional config override (uses ConfigManager if not provided)
 * @returns Array of workspace aliases
 */
export function listAvailableWorkspaces(config?: TanaConfig): string[] {
  const cfg = config ?? ConfigManager.getInstance().getConfig();
  if (!cfg.workspaces) {
    return [];
  }
  return Object.keys(cfg.workspaces);
}

/**
 * Get the default workspace alias
 *
 * @param config - Optional config override (uses ConfigManager if not provided)
 * @returns Default workspace alias (usually 'main')
 */
export function getDefaultWorkspace(config?: TanaConfig): string {
  const cfg = config ?? ConfigManager.getInstance().getConfig();
  return cfg.defaultWorkspace ?? "main";
}

/**
 * Execute a function with resolved workspace context
 *
 * @param options - Resolution options
 * @param fn - Function to execute with workspace context
 * @returns Result of the function
 *
 * @example
 * const result = await withWorkspace({ workspace: 'main' }, async (ws) => {
 *   const db = new Database(ws.dbPath);
 *   try {
 *     return await queryDatabase(db);
 *   } finally {
 *     db.close();
 *   }
 * });
 */
export async function withWorkspace<T>(
  options: ResolveOptions | undefined,
  fn: (workspace: ResolvedWorkspace) => T | Promise<T>
): Promise<T> {
  const workspace = resolveWorkspaceContext(options);
  return fn(workspace);
}
