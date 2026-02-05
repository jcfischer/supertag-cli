/**
 * Read Backend Resolver
 * Spec: F-097 Live Read Backend
 * Task: T-2.3
 *
 * Resolves which TanaReadBackend to use based on configuration and availability.
 * Key difference from write resolver: NEVER throws. Always falls back to SQLite.
 *
 * Resolution order:
 * 1. --offline flag → SqliteReadBackend
 * 2. Cached backend (unless forceRefresh)
 * 3. Local API configured + healthy → LocalApiReadBackend
 * 4. Fallback → SqliteReadBackend
 */

import { ConfigManager } from '../config/manager';
import { resolveWorkspaceContext } from '../config/workspace-resolver';
import { LocalApiClient } from './local-api-client';
import { LocalApiReadBackend } from './local-api-read-backend';
import { SqliteReadBackend } from './sqlite-read-backend';
import type { TanaReadBackend } from './read-backend';

// =============================================================================
// Cache
// =============================================================================

let cachedReadBackend: TanaReadBackend | null = null;

// =============================================================================
// Options
// =============================================================================

export interface ReadBackendOptions {
  /** Workspace alias (resolved via workspace resolver) */
  workspace?: string;
  /** Force SQLite backend regardless of Local API availability */
  offline?: boolean;
  /** Bypass cache and re-resolve */
  forceRefresh?: boolean;
  /** Direct database path (overrides workspace resolution) */
  dbPath?: string;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Resolve which read backend to use.
 *
 * Resolution order:
 * 1. --offline flag → SqliteReadBackend
 * 2. Cached backend (unless forceRefresh)
 * 3. Local API configured + healthy → LocalApiReadBackend
 * 4. Fallback → SqliteReadBackend
 *
 * **Never throws** — always returns a usable backend.
 * If Local API is unavailable, silently falls back to SQLite.
 *
 * @param options - Resolution options
 * @returns Resolved TanaReadBackend instance
 */
export async function resolveReadBackend(
  options?: ReadBackendOptions,
): Promise<TanaReadBackend> {
  // 1. Offline flag forces SQLite
  if (options?.offline) {
    const backend = createSqliteBackend(options);
    // Don't cache offline backends — user may switch back
    return backend;
  }

  // 2. Return cached backend if available
  if (cachedReadBackend && !options?.forceRefresh) {
    return cachedReadBackend;
  }

  // 3. Try Local API if configured
  try {
    const configManager = ConfigManager.getInstance();
    const localApiConfig = configManager.getLocalApiConfig();

    if (localApiConfig.enabled && localApiConfig.bearerToken) {
      const client = new LocalApiClient({
        endpoint: localApiConfig.endpoint,
        bearerToken: localApiConfig.bearerToken,
      });

      // Health check — is Tana Desktop running?
      const healthy = await client.health();
      if (healthy) {
        // Get workspace ID for listTags
        const workspaceId = resolveWorkspaceId(options);
        const backend = new LocalApiReadBackend(client, workspaceId);
        cachedReadBackend = backend;
        return backend;
      }
    }
  } catch {
    // Any error in Local API resolution → fall through to SQLite
  }

  // 4. Fallback to SQLite
  const backend = createSqliteBackend(options);
  cachedReadBackend = backend;
  return backend;
}

// =============================================================================
// Cache Management
// =============================================================================

/**
 * Clear the cached read backend.
 * Call this after config changes or for testing.
 */
export function clearReadBackendCache(): void {
  if (cachedReadBackend) {
    try {
      cachedReadBackend.close();
    } catch {
      // Ignore close errors
    }
  }
  cachedReadBackend = null;
}

// =============================================================================
// Internal Helpers
// =============================================================================

/**
 * Create a SqliteReadBackend from options.
 */
function createSqliteBackend(options?: ReadBackendOptions): SqliteReadBackend {
  if (options?.dbPath) {
    return new SqliteReadBackend(options.dbPath);
  }

  const ws = resolveWorkspaceContext({
    workspace: options?.workspace,
    requireDatabase: false,
  });
  return new SqliteReadBackend(ws.dbPath);
}

/**
 * Resolve workspace ID (Tana node ID) for Local API operations.
 */
function resolveWorkspaceId(options?: ReadBackendOptions): string {
  try {
    const ws = resolveWorkspaceContext({
      workspace: options?.workspace,
      requireDatabase: false,
    });
    return ws.nodeid || ws.rootFileId || ws.alias;
  } catch {
    return 'main';
  }
}
