/**
 * Tests for Config Delta-Sync Extensions (T-1.1, F-095)
 *
 * Verifies delta-sync interval and MCP tool mode configuration
 * including defaults, config file values, and environment variable overrides.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ConfigManager } from '../../src/config/manager';
import { readFileSync, writeFileSync } from 'fs';
import { CONFIG_FILE } from '../../src/config/paths';

// Reset singleton between tests
function resetConfigManager(): void {
  // @ts-expect-error - accessing private static for testing
  ConfigManager.instance = undefined;
}

describe('Config Delta-Sync Extensions (T-1.1)', () => {
  const originalEnv = { ...process.env };
  let savedConfig: string;

  beforeEach(() => {
    resetConfigManager();
    // Backup the real config file
    savedConfig = readFileSync(CONFIG_FILE, 'utf-8');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    // Restore the real config file
    writeFileSync(CONFIG_FILE, savedConfig, 'utf-8');
    resetConfigManager();
  });

  describe('getDeltaSyncInterval', () => {
    it('returns 5 by default when localApi has no deltaSyncInterval', () => {
      // Write config without deltaSyncInterval
      const config = JSON.parse(savedConfig);
      if (config.localApi) {
        delete config.localApi.deltaSyncInterval;
      }
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
      resetConfigManager();

      const mgr = ConfigManager.getInstance();
      expect(mgr.getDeltaSyncInterval()).toBe(5);
    });

    it('returns configured value from localApi config', () => {
      const config = JSON.parse(savedConfig);
      if (!config.localApi) {
        config.localApi = { enabled: true, endpoint: 'http://localhost:8262' };
      }
      config.localApi.deltaSyncInterval = 10;
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
      resetConfigManager();

      const mgr = ConfigManager.getInstance();
      expect(mgr.getDeltaSyncInterval()).toBe(10);
    });

    it('returns 0 when delta-sync is disabled via config', () => {
      const config = JSON.parse(savedConfig);
      if (!config.localApi) {
        config.localApi = { enabled: true, endpoint: 'http://localhost:8262' };
      }
      config.localApi.deltaSyncInterval = 0;
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
      resetConfigManager();

      const mgr = ConfigManager.getInstance();
      expect(mgr.getDeltaSyncInterval()).toBe(0);
    });
  });

  describe('getMcpToolMode', () => {
    it('returns full by default when mcp is not configured', () => {
      const config = JSON.parse(savedConfig);
      delete config.mcp;
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
      resetConfigManager();

      const mgr = ConfigManager.getInstance();
      expect(mgr.getMcpToolMode()).toBe('full');
    });

    it('returns slim when configured', () => {
      const config = JSON.parse(savedConfig);
      config.mcp = { toolMode: 'slim' };
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
      resetConfigManager();

      const mgr = ConfigManager.getInstance();
      expect(mgr.getMcpToolMode()).toBe('slim');
    });

    it('returns full for invalid values', () => {
      const config = JSON.parse(savedConfig);
      config.mcp = { toolMode: 'invalid' };
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
      resetConfigManager();

      const mgr = ConfigManager.getInstance();
      expect(mgr.getMcpToolMode()).toBe('full');
    });
  });

  describe('environment variable overrides', () => {
    it('TANA_DELTA_SYNC_INTERVAL overrides config', () => {
      process.env.TANA_DELTA_SYNC_INTERVAL = '15';
      resetConfigManager();
      const mgr = ConfigManager.getInstance();
      expect(mgr.getDeltaSyncInterval()).toBe(15);
    });

    it('TANA_DELTA_SYNC_INTERVAL=0 disables delta-sync', () => {
      process.env.TANA_DELTA_SYNC_INTERVAL = '0';
      resetConfigManager();
      const mgr = ConfigManager.getInstance();
      expect(mgr.getDeltaSyncInterval()).toBe(0);
    });

    it('ignores negative TANA_DELTA_SYNC_INTERVAL', () => {
      // First remove deltaSyncInterval from config so default applies
      const config = JSON.parse(savedConfig);
      if (config.localApi) {
        delete config.localApi.deltaSyncInterval;
      }
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

      process.env.TANA_DELTA_SYNC_INTERVAL = '-5';
      resetConfigManager();
      const mgr = ConfigManager.getInstance();
      // Should fall back to default since -5 is out of range
      expect(mgr.getDeltaSyncInterval()).toBe(5);
    });

    it('ignores non-numeric TANA_DELTA_SYNC_INTERVAL', () => {
      const config = JSON.parse(savedConfig);
      if (config.localApi) {
        delete config.localApi.deltaSyncInterval;
      }
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

      process.env.TANA_DELTA_SYNC_INTERVAL = 'abc';
      resetConfigManager();
      const mgr = ConfigManager.getInstance();
      // Should fall back to default since NaN
      expect(mgr.getDeltaSyncInterval()).toBe(5);
    });

    it('ignores TANA_DELTA_SYNC_INTERVAL exceeding max (60)', () => {
      const config = JSON.parse(savedConfig);
      if (config.localApi) {
        delete config.localApi.deltaSyncInterval;
      }
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

      process.env.TANA_DELTA_SYNC_INTERVAL = '120';
      resetConfigManager();
      const mgr = ConfigManager.getInstance();
      // Should fall back to default since 120 > 60
      expect(mgr.getDeltaSyncInterval()).toBe(5);
    });

    it('TANA_MCP_TOOL_MODE=slim overrides config', () => {
      process.env.TANA_MCP_TOOL_MODE = 'slim';
      resetConfigManager();
      const mgr = ConfigManager.getInstance();
      expect(mgr.getMcpToolMode()).toBe('slim');
    });

    it('TANA_MCP_TOOL_MODE=full overrides config', () => {
      process.env.TANA_MCP_TOOL_MODE = 'full';
      resetConfigManager();
      const mgr = ConfigManager.getInstance();
      expect(mgr.getMcpToolMode()).toBe('full');
    });

    it('ignores invalid TANA_MCP_TOOL_MODE values', () => {
      const config = JSON.parse(savedConfig);
      delete config.mcp;
      writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

      process.env.TANA_MCP_TOOL_MODE = 'invalid';
      resetConfigManager();
      const mgr = ConfigManager.getInstance();
      // Should fall back to default since 'invalid' is not valid
      expect(mgr.getMcpToolMode()).toBe('full');
    });
  });
});
