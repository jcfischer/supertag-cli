/**
 * Tests for browser path resolution (fixes #76)
 *
 * Verifies that findBrowserExecutable() resolves browser paths
 * without depending on CWD for Playwright module resolution.
 */
import { describe, expect, it } from 'bun:test';
import { findBrowserExecutable, isBrowserAvailable, findPlaywrightChromium } from '../export/lib/browser-path';
import { existsSync } from 'fs';

describe('browser-path', () => {
  describe('findBrowserExecutable', () => {
    it('should return a valid browser path', () => {
      const result = findBrowserExecutable();
      // On any dev machine, at least one browser should be available
      expect(result).not.toBeNull();
      if (result) {
        expect(result.executablePath).toBeTruthy();
        expect(existsSync(result.executablePath)).toBe(true);
        expect(['system-chrome', 'system-edge', 'system-browser', 'playwright-module', 'playwright-cache']).toContain(result.source);
      }
    });

    it('should return a result with source info', () => {
      const result = findBrowserExecutable();
      if (result) {
        expect(result.source).toBeDefined();
        expect(typeof result.source).toBe('string');
      }
    });
  });

  describe('isBrowserAvailable', () => {
    it('should return true when a browser is available', () => {
      // On any dev machine, at least one browser should be available
      expect(isBrowserAvailable()).toBe(true);
    });
  });

  describe('findPlaywrightChromium', () => {
    it('should return a string or null', () => {
      const result = findPlaywrightChromium();
      if (result !== null) {
        expect(typeof result).toBe('string');
        expect(existsSync(result)).toBe(true);
      }
    });
  });

  describe('path resolution independence from CWD', () => {
    it('should find a browser regardless of CWD', () => {
      // Save current CWD
      const originalCwd = process.cwd();

      try {
        // Change to a directory that definitely has no node_modules
        process.chdir('/tmp');

        // findBrowserExecutable should still work (this is the core of #76)
        const result = findBrowserExecutable();
        expect(result).not.toBeNull();
        if (result) {
          expect(existsSync(result.executablePath)).toBe(true);
        }
      } finally {
        // Restore CWD
        process.chdir(originalCwd);
      }
    });
  });
});
