/**
 * Centralized Path Configuration
 *
 * All paths are relative to user home directory for portability.
 * Uses XDG Base Directory specification where applicable.
 * Supports multi-workspace configuration with per-workspace databases.
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { WorkspaceContext, TanaConfig } from '../types';
import { hasGlobalLogger, getGlobalLogger, createLogger } from '../utils/logger';

/**
 * Base directories following XDG conventions
 */
const HOME = homedir();

// XDG directories with fallbacks
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(HOME, '.config');
const XDG_DATA_HOME = process.env.XDG_DATA_HOME || join(HOME, '.local', 'share');
const XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || join(HOME, '.cache');
const XDG_STATE_HOME = process.env.XDG_STATE_HOME || join(HOME, '.local', 'state');

/**
 * Supertag-specific directories
 * Note: Using 'supertag' namespace to avoid conflicts with official Tana app
 */
export const TANA_CONFIG_DIR = join(XDG_CONFIG_HOME, 'supertag');
export const TANA_DATA_DIR = join(XDG_DATA_HOME, 'supertag');
export const TANA_CACHE_DIR = join(XDG_CACHE_HOME, 'supertag');
export const TANA_LOG_DIR = join(XDG_STATE_HOME, 'supertag', 'logs');

/**
 * Configuration files
 */
export const CONFIG_FILE = join(TANA_CONFIG_DIR, 'config.json');
export const SCHEMA_CACHE_FILE = join(TANA_CACHE_DIR, 'schema-registry.json');

/**
 * Data files
 */
export const DATABASE_PATH = join(TANA_DATA_DIR, 'tana-index.db');
export const PID_FILE = join(TANA_DATA_DIR, '.tana-webhook.pid');
export const SERVER_CONFIG_FILE = join(TANA_DATA_DIR, '.tana-webhook.json');

/**
 * Browser automation data
 */
export const BROWSER_DATA_DIR = join(TANA_CONFIG_DIR, 'browser-data');

/**
 * Default export directory
 * - macOS/Windows: ~/Documents/Tana-Export (user-friendly location)
 * - Linux: ~/.local/share/supertag/exports (XDG compliant)
 */
export const DEFAULT_EXPORT_DIR = process.platform === 'darwin' || process.platform === 'win32'
  ? join(HOME, 'Documents', 'Tana-Export')
  : join(XDG_DATA_HOME, 'supertag', 'exports');

/**
 * Workspaces directory (contains per-workspace data)
 */
export const WORKSPACES_DIR = join(TANA_DATA_DIR, 'workspaces');

/**
 * Ensure a directory exists
 */
export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Ensure all Tana directories exist
 */
export function ensureAllDirs(): void {
  ensureDir(TANA_CONFIG_DIR);
  ensureDir(TANA_DATA_DIR);
  ensureDir(TANA_CACHE_DIR);
  ensureDir(TANA_LOG_DIR);
}

/**
 * Get all paths for display/debugging
 */
export function getAllPaths(): Record<string, string> {
  return {
    configDir: TANA_CONFIG_DIR,
    dataDir: TANA_DATA_DIR,
    cacheDir: TANA_CACHE_DIR,
    logDir: TANA_LOG_DIR,
    configFile: CONFIG_FILE,
    database: DATABASE_PATH,
    schemaCache: SCHEMA_CACHE_FILE,
    exportDir: DEFAULT_EXPORT_DIR,
    browserData: BROWSER_DATA_DIR,
    pidFile: PID_FILE,
  };
}

/**
 * Simple console logger with unified logger integration
 * Uses the global unified logger when available, falls back to console
 */
export function createSimpleLogger(name: string) {
  const getLoggerInstance = () => {
    if (hasGlobalLogger()) {
      return getGlobalLogger().child(name);
    }
    return null;
  };

  return {
    info: (...args: unknown[]) => {
      const logger = getLoggerInstance();
      if (logger) {
        logger.info(args.map(String).join(' '));
      } else {
        console.log(`[${name}]`, ...args);
      }
    },
    warn: (...args: unknown[]) => {
      const logger = getLoggerInstance();
      if (logger) {
        logger.warn(args.map(String).join(' '));
      } else {
        console.warn(`[${name}]`, ...args);
      }
    },
    error: (...args: unknown[]) => {
      const logger = getLoggerInstance();
      if (logger) {
        logger.error(args.map(String).join(' '));
      } else {
        console.error(`[${name}]`, ...args);
      }
    },
    debug: (...args: unknown[]) => {
      const logger = getLoggerInstance();
      if (logger) {
        if (logger.isEnabled('debug')) {
          logger.debug(args.map(String).join(' '));
        }
      } else if (process.env.DEBUG) {
        console.log(`[${name}]`, '[DEBUG]', ...args);
      }
    },
  };
}

/**
 * Legacy path locations (for migration)
 * Includes both old project paths and old 'tana' namespace paths
 */
export const LEGACY_PATHS = {
  database: join(HOME, 'work/DA/KAI/skills/tana/tana-index.db'),
  schemaCache: join(HOME, '.cache/tana/schema-registry.json'),
  // Old 'tana' namespace paths (before rename to 'supertag')
  oldConfigDir: join(XDG_CONFIG_HOME, 'tana'),
  oldDataDir: join(XDG_DATA_HOME, 'tana'),
  oldCacheDir: join(XDG_CACHE_HOME, 'tana'),
  oldLogDir: join(XDG_STATE_HOME, 'tana', 'logs'),
};

/**
 * Check if database exists at XDG location, fall back to legacy
 * Returns the path to use (XDG preferred, legacy as fallback)
 */
export function getDatabasePath(): string {
  if (existsSync(DATABASE_PATH)) {
    return DATABASE_PATH;
  }
  if (existsSync(LEGACY_PATHS.database)) {
    return LEGACY_PATHS.database;
  }
  return DATABASE_PATH; // Return XDG path even if doesn't exist
}

/**
 * Check if migration is needed
 */
export function needsMigration(): { needed: boolean; from?: string; to?: string } {
  const legacyExists = existsSync(LEGACY_PATHS.database);
  const xdgExists = existsSync(DATABASE_PATH);

  if (legacyExists && !xdgExists) {
    return { needed: true, from: LEGACY_PATHS.database, to: DATABASE_PATH };
  }
  return { needed: false };
}

/**
 * Get workspace directory path
 */
export function getWorkspaceDir(aliasOrWsid: string): string {
  return join(WORKSPACES_DIR, aliasOrWsid);
}

/**
 * Get workspace database path
 */
export function getWorkspaceDatabasePath(aliasOrWsid: string): string {
  return join(getWorkspaceDir(aliasOrWsid), 'tana-index.db');
}

/**
 * Get workspace schema cache path
 */
export function getWorkspaceSchemaPath(aliasOrWsid: string): string {
  return join(getWorkspaceDir(aliasOrWsid), 'schema-registry.json');
}

/**
 * Get workspace export directory
 */
export function getWorkspaceExportDir(aliasOrWsid: string): string {
  return join(DEFAULT_EXPORT_DIR, aliasOrWsid);
}

/**
 * Ensure workspace directory exists
 */
export function ensureWorkspaceDir(aliasOrWsid: string): void {
  ensureDir(getWorkspaceDir(aliasOrWsid));
}

/**
 * Resolve workspace context from alias, rootFileId, nodeid, or default
 *
 * Resolution priority:
 * 1. Explicit aliasOrId argument (can be alias, rootFileId, or nodeid)
 * 2. Default workspace from config
 * 3. Legacy single-database mode (no workspaces configured)
 *
 * @param aliasOrId - Workspace alias, rootFileId, or nodeid (optional)
 * @param config - Tana configuration (optional, for testing)
 * @returns WorkspaceContext with all resolved paths
 */
export function resolveWorkspace(aliasOrId?: string, config?: TanaConfig): WorkspaceContext {
  // Priority: explicit arg > default > legacy single DB
  let identifier = aliasOrId;

  if (!identifier && config?.defaultWorkspace) {
    identifier = config.defaultWorkspace;
  }

  // If no identifier and no workspaces configured, use legacy mode
  if (!identifier) {
    return {
      alias: 'default',
      rootFileId: '',
      dbPath: getDatabasePath(),
      schemaPath: SCHEMA_CACHE_FILE,
      exportDir: DEFAULT_EXPORT_DIR,
    };
  }

  // Look up in workspaces config
  const workspace = config?.workspaces?.[identifier];

  if (workspace) {
    // Found by alias
    return {
      alias: identifier,
      nodeid: workspace.nodeid,
      rootFileId: workspace.rootFileId,
      dbPath: getWorkspaceDatabasePath(identifier),
      schemaPath: getWorkspaceSchemaPath(identifier),
      exportDir: getWorkspaceExportDir(identifier),
    };
  }

  // Check if identifier is a nodeid or rootFileId that has an alias
  if (config?.workspaces) {
    for (const [alias, ws] of Object.entries(config.workspaces)) {
      if (ws.nodeid === identifier || ws.rootFileId === identifier) {
        return {
          alias,
          nodeid: ws.nodeid,
          rootFileId: ws.rootFileId,
          dbPath: getWorkspaceDatabasePath(alias),
          schemaPath: getWorkspaceSchemaPath(alias),
          exportDir: getWorkspaceExportDir(alias),
        };
      }
    }
  }

  // Use identifier directly as rootFileId (no alias configured)
  return {
    alias: identifier,
    rootFileId: identifier,
    dbPath: getWorkspaceDatabasePath(identifier),
    schemaPath: getWorkspaceSchemaPath(identifier),
    exportDir: getWorkspaceExportDir(identifier),
  };
}

/**
 * Get all enabled workspaces for batch operations
 */
export function getEnabledWorkspaces(config?: TanaConfig): WorkspaceContext[] {
  if (!config?.workspaces) {
    return [];
  }

  return Object.entries(config.workspaces)
    .filter(([_, ws]) => ws.enabled)
    .map(([alias, ws]) => ({
      alias,
      nodeid: ws.nodeid,
      rootFileId: ws.rootFileId,
      dbPath: getWorkspaceDatabasePath(alias),
      schemaPath: getWorkspaceSchemaPath(alias),
      exportDir: getWorkspaceExportDir(alias),
    }));
}
