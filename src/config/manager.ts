/**
 * Configuration Manager
 * Handles loading and merging configuration from multiple sources
 * Priority: CLI flags > Environment variables > Config file > Defaults
 * Supports multi-workspace configuration
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import type { TanaConfig, WorkspaceConfig, CleanupConfig, EmbeddingConfig } from '../types';
import { CONFIG_FILE, TANA_CONFIG_DIR, ensureDir } from './paths';

/**
 * Default cleanup configuration
 */
const DEFAULT_CLEANUP_CONFIG: CleanupConfig = {
  keepCount: 7,
  autoCleanup: false,
};

/**
 * Default embedding configuration
 * bge-m3: 1024 dimensions, 8192 token context (24576 chars)
 * Excellent at both short text (names) and long documents
 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  model: 'bge-m3',
  endpoint: 'http://localhost:11434',
};

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: TanaConfig = {
  apiEndpoint: 'https://europe-west1-tagr-prod.cloudfunctions.net/addToNodeV2',
  defaultTargetNode: 'INBOX',
  cleanup: DEFAULT_CLEANUP_CONFIG,
};

/**
 * Configuration Manager class
 * Singleton pattern for managing Tana configuration
 */
export class ConfigManager {
  private static instance: ConfigManager;
  private config: TanaConfig;

  private constructor() {
    this.config = this.load();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): ConfigManager {
    if (!ConfigManager.instance) {
      ConfigManager.instance = new ConfigManager();
    }
    return ConfigManager.instance;
  }

  /**
   * Load configuration from all sources
   * Priority: Environment variables > Config file > Defaults
   */
  private load(): TanaConfig {
    // Start with defaults
    const config: TanaConfig = { ...DEFAULT_CONFIG };

    // Load from config file (if exists)
    if (existsSync(CONFIG_FILE)) {
      try {
        const fileData = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
        Object.assign(config, fileData);
      } catch (error) {
        console.error(`Warning: Failed to load config file at ${CONFIG_FILE}`);
        console.error(error instanceof Error ? error.message : String(error));
      }
    }

    // Override with environment variables (highest priority after CLI flags)
    if (process.env.TANA_API_TOKEN) {
      config.apiToken = process.env.TANA_API_TOKEN;
    }
    if (process.env.TANA_TARGET_NODE) {
      config.defaultTargetNode = process.env.TANA_TARGET_NODE;
    }
    if (process.env.TANA_API_ENDPOINT) {
      config.apiEndpoint = process.env.TANA_API_ENDPOINT;
    }

    return config;
  }

  /**
   * Get current configuration
   */
  getConfig(): TanaConfig {
    return { ...this.config };
  }

  /**
   * Get API token
   */
  getApiToken(): string | undefined {
    return this.config.apiToken;
  }

  /**
   * Get API endpoint
   */
  getApiEndpoint(): string {
    return this.config.apiEndpoint;
  }

  /**
   * Get default target node
   */
  getDefaultTargetNode(): string {
    return this.config.defaultTargetNode;
  }

  /**
   * Get Firebase API key
   */
  getFirebaseApiKey(): string | undefined {
    return this.config.firebaseApiKey;
  }

  /**
   * Set Firebase API key
   * @param key - Firebase Web API key
   */
  setFirebaseApiKey(key: string): void {
    this.config.firebaseApiKey = key;
    this.save({});
  }

  /**
   * Save configuration to file
   * @param updates Partial configuration to merge and save
   */
  save(updates: Partial<TanaConfig>): void {
    // Merge updates with current config
    Object.assign(this.config, updates);

    // Ensure config directory exists
    ensureDir(TANA_CONFIG_DIR);

    // Write to file
    try {
      writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (error) {
      throw new Error(
        `Failed to save config to ${CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Add or update a workspace
   * @param alias - Friendly name for the workspace
   * @param rootFileId - Primary identifier for API calls (required)
   * @param options - Optional nodeid (for URLs), name, enabled flag
   */
  addWorkspace(alias: string, rootFileId: string, options?: { name?: string; enabled?: boolean; nodeid?: string }): void {
    if (!this.config.workspaces) {
      this.config.workspaces = {};
    }

    this.config.workspaces[alias] = {
      rootFileId,
      nodeid: options?.nodeid,
      name: options?.name,
      enabled: options?.enabled ?? true,
    };

    this.save({});
  }

  /**
   * Update workspace properties
   */
  updateWorkspace(aliasOrId: string, updates: { rootFileId?: string; nodeid?: string; name?: string; enabled?: boolean }): boolean {
    const workspace = this.getWorkspace(aliasOrId);
    if (!workspace) {
      return false;
    }

    const ws = this.config.workspaces![workspace.alias];
    if (updates.rootFileId !== undefined) ws.rootFileId = updates.rootFileId;
    if (updates.nodeid !== undefined) ws.nodeid = updates.nodeid;
    if (updates.name !== undefined) ws.name = updates.name;
    if (updates.enabled !== undefined) ws.enabled = updates.enabled;

    this.save({});
    return true;
  }

  /**
   * Remove a workspace
   */
  removeWorkspace(aliasOrId: string): boolean {
    if (!this.config.workspaces) {
      return false;
    }

    // Try to find by alias first
    if (this.config.workspaces[aliasOrId]) {
      delete this.config.workspaces[aliasOrId];

      // Clear default if it was removed
      if (this.config.defaultWorkspace === aliasOrId) {
        delete this.config.defaultWorkspace;
      }

      this.save({});
      return true;
    }

    // Try to find by rootFileId or nodeid
    for (const [alias, ws] of Object.entries(this.config.workspaces)) {
      if (ws.rootFileId === aliasOrId || ws.nodeid === aliasOrId) {
        delete this.config.workspaces[alias];

        // Clear default if it was removed
        if (this.config.defaultWorkspace === alias) {
          delete this.config.defaultWorkspace;
        }

        this.save({});
        return true;
      }
    }

    return false;
  }

  /**
   * Set default workspace
   */
  setDefaultWorkspace(aliasOrId: string): boolean {
    if (!this.config.workspaces) {
      return false;
    }

    // Check if alias exists
    if (this.config.workspaces[aliasOrId]) {
      this.config.defaultWorkspace = aliasOrId;
      this.save({});
      return true;
    }

    // Check if rootFileId or nodeid exists and get its alias
    for (const [alias, ws] of Object.entries(this.config.workspaces)) {
      if (ws.rootFileId === aliasOrId || ws.nodeid === aliasOrId) {
        this.config.defaultWorkspace = alias;
        this.save({});
        return true;
      }
    }

    return false;
  }

  /**
   * Get a workspace by alias, rootFileId, or nodeid
   */
  getWorkspace(aliasOrId: string): { alias: string; config: WorkspaceConfig } | undefined {
    if (!this.config.workspaces) {
      return undefined;
    }

    // Try alias first
    if (this.config.workspaces[aliasOrId]) {
      return { alias: aliasOrId, config: this.config.workspaces[aliasOrId] };
    }

    // Try rootFileId or nodeid
    for (const [alias, ws] of Object.entries(this.config.workspaces)) {
      if (ws.rootFileId === aliasOrId || ws.nodeid === aliasOrId) {
        return { alias, config: ws };
      }
    }

    return undefined;
  }

  /**
   * Get all workspaces
   */
  getAllWorkspaces(): Record<string, WorkspaceConfig> {
    return this.config.workspaces || {};
  }

  /**
   * Get default workspace alias
   */
  getDefaultWorkspace(): string | undefined {
    return this.config.defaultWorkspace;
  }

  /**
   * Get cleanup configuration with defaults
   */
  getCleanupConfig(): CleanupConfig {
    return {
      ...DEFAULT_CLEANUP_CONFIG,
      ...this.config.cleanup,
    };
  }

  /**
   * Update cleanup configuration
   */
  setCleanupConfig(updates: Partial<CleanupConfig>): void {
    if (!this.config.cleanup) {
      this.config.cleanup = { ...DEFAULT_CLEANUP_CONFIG };
    }
    Object.assign(this.config.cleanup, updates);
    this.save({});
  }

  /**
   * Get embedding configuration with defaults
   */
  getEmbeddingConfig(): EmbeddingConfig {
    return {
      ...DEFAULT_EMBEDDING_CONFIG,
      ...this.config.embeddings,
    };
  }

  /**
   * Update embedding configuration
   */
  setEmbeddingConfig(updates: Partial<EmbeddingConfig>): void {
    if (!this.config.embeddings) {
      this.config.embeddings = { ...DEFAULT_EMBEDDING_CONFIG };
    }
    Object.assign(this.config.embeddings, updates);
    this.save({});
  }

  /**
   * Enable or disable a workspace
   */
  setWorkspaceEnabled(aliasOrWsid: string, enabled: boolean): boolean {
    const workspace = this.getWorkspace(aliasOrWsid);
    if (!workspace) {
      return false;
    }

    this.config.workspaces![workspace.alias].enabled = enabled;
    this.save({});
    return true;
  }

  /**
   * Validate configuration for posting
   * @returns true if valid, throws error otherwise
   */
  validateForPosting(): boolean {
    if (!this.config.apiToken) {
      throw new Error(
        'API token not configured. Set it via:\n' +
        '  - Environment variable: TANA_API_TOKEN\n' +
        '  - Config file: tana config --token YOUR_TOKEN\n' +
        '  - CLI flag: tana post --token YOUR_TOKEN'
      );
    }

    if (!this.config.apiEndpoint) {
      throw new Error('API endpoint not configured');
    }

    return true;
  }

  /**
   * Get configuration file path
   */
  static getConfigPath(): string {
    return CONFIG_FILE;
  }

  /**
   * Check if configuration file exists
   */
  static configExists(): boolean {
    return existsSync(CONFIG_FILE);
  }

  /**
   * Reload configuration from sources
   */
  reload(): void {
    this.config = this.load();
  }
}

/**
 * Get singleton instance (convenience function)
 */
export function getConfig(): ConfigManager {
  return ConfigManager.getInstance();
}
