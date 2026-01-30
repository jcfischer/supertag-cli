/**
 * tana_sync Tool
 *
 * Trigger reindex of Tana exports, check sync status, or run delta-sync.
 * Wraps the sync commands from the CLI.
 *
 * Actions:
 * - index: Full reindex from Tana export files
 * - status: Check sync status (including delta-sync info)
 * - delta: Incremental sync via tana-local API (F-095)
 */

import { existsSync } from 'fs';
import { TanaExportWatcher } from '../../monitors/tana-export-monitor.js';
import { resolveWorkspaceContext } from '../../config/workspace-resolver.js';
import { ensureWorkspaceDir } from '../../config/paths.js';
import { ConfigManager } from '../../config/manager.js';
import { LocalApiClient } from '../../api/local-api-client.js';
import { DeltaSyncService } from '../../services/delta-sync.js';
import type { SyncInput } from '../schemas.js';
import type { DeltaSyncResult, DeltaSyncStatus } from '../../types/local-api.js';

export interface SyncResult {
  workspace: string;
  action: 'index' | 'status' | 'delta';
  exportDir: string;
  dbPath: string;
  latestExport?: string | null;
  lastIndexed?: number | null;
  nodesIndexed?: number;
  supertagsIndexed?: number;
  fieldsIndexed?: number;
  referencesIndexed?: number;
  durationMs?: number;
  error?: string;
  /** Delta-sync result (present when action is 'delta') */
  deltaResult?: DeltaSyncResult;
  /** Delta-sync status info (present when action is 'status') */
  deltaSyncStatus?: DeltaSyncStatus;
}

export async function sync(input: SyncInput): Promise<SyncResult> {
  const workspace = resolveWorkspaceContext({
    workspace: input.workspace,
    requireDatabase: input.action === 'delta', // Delta needs existing database
  });

  const baseResult: SyncResult = {
    workspace: workspace.alias,
    action: input.action,
    exportDir: workspace.exportDir,
    dbPath: workspace.dbPath,
  };

  // Delta-sync mode (F-095)
  if (input.action === 'delta') {
    return handleDeltaSync(baseResult, workspace.dbPath);
  }

  // Check if export directory exists (required for index and status)
  if (!existsSync(workspace.exportDir)) {
    return {
      ...baseResult,
      error: `Export directory does not exist: ${workspace.exportDir}`,
    };
  }

  // Ensure workspace directory exists for database storage
  ensureWorkspaceDir(workspace.alias);

  const watcher = new TanaExportWatcher({
    exportDir: workspace.exportDir,
    dbPath: workspace.dbPath,
  });

  try {
    if (input.action === 'status') {
      const status = watcher.getStatus();
      const result: SyncResult = {
        ...baseResult,
        latestExport: status.latestExport || null,
        lastIndexed: status.lastIndexed || null,
      };

      // Add delta-sync status if database exists
      if (existsSync(workspace.dbPath)) {
        try {
          const deltaSyncService = new DeltaSyncService({
            dbPath: workspace.dbPath,
            localApiClient: { searchNodes: async () => [], health: async () => false },
          });
          result.deltaSyncStatus = deltaSyncService.getStatus();
          deltaSyncService.close();
        } catch {
          // Delta-sync status is optional, ignore errors
        }
      }

      return result;
    }

    // action === 'index'
    const result = await watcher.indexLatest();
    return {
      ...baseResult,
      latestExport: result.exportFile,
      nodesIndexed: result.nodesIndexed,
      supertagsIndexed: result.supertagsIndexed,
      fieldsIndexed: result.fieldsIndexed,
      referencesIndexed: result.referencesIndexed,
      durationMs: result.durationMs,
    };
  } catch (error) {
    return {
      ...baseResult,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    watcher.close();
  }
}

/**
 * Handle delta-sync action via Local API.
 *
 * 1. Get config and verify bearer token
 * 2. Create LocalApiClient and check health
 * 3. Create DeltaSyncService and run sync
 * 4. Return result
 */
async function handleDeltaSync(
  baseResult: SyncResult,
  dbPath: string,
): Promise<SyncResult> {
  // Step 1: Get Local API config and verify bearer token
  const config = ConfigManager.getInstance();
  const localApiConfig = config.getLocalApiConfig();

  if (!localApiConfig.bearerToken) {
    return {
      ...baseResult,
      error: 'No bearer token configured for Local API. Set localApi.bearerToken in config.',
    };
  }

  // Step 2: Create client and check health
  const client = new LocalApiClient({
    endpoint: localApiConfig.endpoint,
    bearerToken: localApiConfig.bearerToken,
  });

  try {
    const healthy = await client.health();
    if (!healthy) {
      return {
        ...baseResult,
        error: 'Tana Desktop is not running or Local API is disabled. Start Tana Desktop and enable Settings > Local API.',
      };
    }
  } catch (error) {
    return {
      ...baseResult,
      error: `Local API unreachable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Step 3: Create DeltaSyncService and run sync
  const deltaSyncService = new DeltaSyncService({
    dbPath,
    localApiClient: client,
  });

  try {
    const deltaResult = await deltaSyncService.sync();
    return {
      ...baseResult,
      deltaResult,
      durationMs: deltaResult.durationMs,
    };
  } catch (error) {
    return {
      ...baseResult,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    deltaSyncService.close();
  }
}
