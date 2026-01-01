/**
 * Unified Workspace Resolver
 *
 * Single entry point for all workspace resolution across CLI, Export CLI, and MCP Server.
 * Provides consistent error handling, database validation, and caching.
 *
 * Spec: 052-unified-workspace-resolver
 * Updated: 073-error-context (T-5.2 - Structured errors)
 */

import { existsSync } from "fs";
import {
  resolveWorkspace,
  getWorkspaceDatabasePath,
  getWorkspaceSchemaPath,
  getWorkspaceExportDir,
} from "./paths";
import { ConfigManager } from "./manager";
import { StructuredError } from "../utils/structured-errors";
import { findSimilarValues, formatSimilarValuesSuggestion } from "../utils/suggestion-generator";
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
  /** Full path to schema cache file */
  schemaPath: string;
  /** Full path to export directory */
  exportDir: string;
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
export class WorkspaceNotFoundError extends StructuredError {
  public readonly requestedWorkspace: string;
  public readonly availableWorkspaces: string[];

  constructor(requestedWorkspace: string, availableWorkspaces: string[]) {
    const available =
      availableWorkspaces.length > 0
        ? `\nAvailable: ${availableWorkspaces.join(", ")}`
        : "\nNo workspaces configured.";

    // Find similar workspace names for suggestion
    const similarWorkspaces = findSimilarValues(requestedWorkspace, availableWorkspaces);
    const similarSuggestion = formatSimilarValuesSuggestion(similarWorkspaces);
    const suggestion =
      similarSuggestion ||
      (availableWorkspaces.length > 0
        ? `Try one of: ${availableWorkspaces.join(", ")}`
        : 'Configure workspaces in supertag config, then run "supertag sync".');

    super("WORKSPACE_NOT_FOUND", `Workspace not found: ${requestedWorkspace}${available}`, {
      details: {
        requestedWorkspace,
        availableWorkspaces,
      },
      suggestion,
      recovery: {
        canRetry: false,
        alternatives: availableWorkspaces,
      },
    });

    this.name = "WorkspaceNotFoundError";
    this.requestedWorkspace = requestedWorkspace;
    this.availableWorkspaces = availableWorkspaces;
  }
}

/**
 * Thrown when workspace exists but database file is missing
 */
export class WorkspaceDatabaseMissingError extends StructuredError {
  public readonly workspace: string;
  public readonly dbPath: string;

  constructor(workspace: string, dbPath: string) {
    const suggestion = `Run 'supertag sync -w ${workspace}' to create the database.`;

    super(
      "DATABASE_NOT_FOUND",
      // Include suggestion in message for backward compatibility
      `Workspace '${workspace}' database not found at: ${dbPath}\n${suggestion}`,
      {
        details: {
          workspace,
          dbPath,
        },
        suggestion,
        recovery: {
          canRetry: false,
          suggestedCommand: `supertag sync -w ${workspace}`,
        },
      }
    );

    this.name = "WorkspaceDatabaseMissingError";
    this.workspace = workspace;
    this.dbPath = dbPath;
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
    const schemaPath = getWorkspaceSchemaPath(foundAlias);
    const exportDir = getWorkspaceExportDir(foundAlias);
    const isDefault = foundAlias === (config.defaultWorkspace ?? "main");

    if (requireDatabase && !existsSync(dbPath)) {
      throw new WorkspaceDatabaseMissingError(foundAlias, dbPath);
    }

    const resolved: ResolvedWorkspace = {
      alias: foundAlias,
      config: foundConfig,
      dbPath,
      schemaPath,
      exportDir,
      isDefault,
      nodeid: foundConfig.nodeid,
      rootFileId: foundConfig.rootFileId,
    };

    cache.set(foundAlias, resolved);
    return resolved;
  }

  // Workspace found by alias
  const dbPath = getWorkspaceDatabasePath(targetAlias);
  const schemaPath = getWorkspaceSchemaPath(targetAlias);
  const exportDir = getWorkspaceExportDir(targetAlias);
  const isDefault = targetAlias === (config.defaultWorkspace ?? "main");

  if (requireDatabase && !existsSync(dbPath)) {
    throw new WorkspaceDatabaseMissingError(targetAlias, dbPath);
  }

  const resolved: ResolvedWorkspace = {
    alias: targetAlias,
    config: workspaceConfig,
    dbPath,
    schemaPath,
    exportDir,
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
