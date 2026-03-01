/**
 * Browser Path Resolution
 *
 * Resolves browser executable paths robustly across platforms.
 * Fixes issue #76: on Windows, Bun-compiled binaries resolve Playwright's
 * module path relative to CWD, which fails when run from arbitrary directories.
 *
 * Resolution order:
 * 1. System browsers (Chrome, Edge) — most reliable on Windows
 * 2. Playwright's chromium.executablePath() — works when module is resolvable
 * 3. Direct scan of Playwright's browser cache directories — CWD-independent fallback
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Known Playwright browser cache directories per platform.
 * These are the default locations unless PLAYWRIGHT_BROWSERS_PATH is set.
 */
function getPlaywrightCacheDirs(): string[] {
  const dirs: string[] = [];

  // Respect PLAYWRIGHT_BROWSERS_PATH env var first
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    dirs.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  }

  const home = homedir();

  if (process.platform === 'win32') {
    // Windows: %USERPROFILE%\AppData\Local\ms-playwright
    const localAppData = process.env.LOCALAPPDATA || join(home, 'AppData', 'Local');
    dirs.push(join(localAppData, 'ms-playwright'));
  } else if (process.platform === 'darwin') {
    // macOS: ~/Library/Caches/ms-playwright
    dirs.push(join(home, 'Library', 'Caches', 'ms-playwright'));
  } else {
    // Linux: ~/.cache/ms-playwright
    dirs.push(join(home, '.cache', 'ms-playwright'));
  }

  return dirs;
}

/**
 * Find Chromium executable inside a Playwright browser cache directory.
 * Scans for chromium-* directories and returns the executable path.
 */
function findChromiumInCache(cacheDir: string): string | null {
  if (!existsSync(cacheDir)) return null;

  try {
    const entries = readdirSync(cacheDir);
    // Find chromium directories, sorted descending to prefer newest revision
    const chromiumDirs = entries
      .filter(e => e.startsWith('chromium-'))
      .sort()
      .reverse();

    for (const dir of chromiumDirs) {
      const chromiumBase = join(cacheDir, dir);

      if (process.platform === 'win32') {
        // Windows: chromium-XXXX/chrome-win/chrome.exe
        const winPath = join(chromiumBase, 'chrome-win', 'chrome.exe');
        if (existsSync(winPath)) return winPath;
      } else if (process.platform === 'darwin') {
        // macOS: chromium-XXXX/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
        // or: chromium-XXXX/chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing
        // Also older: chromium-XXXX/chrome-mac/Chromium.app/Contents/MacOS/Chromium
        for (const arch of ['chrome-mac-arm64', 'chrome-mac']) {
          const appBase = join(chromiumBase, arch);
          if (!existsSync(appBase)) continue;

          // Google Chrome for Testing (newer Playwright)
          const gctPath = join(appBase, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
          if (existsSync(gctPath)) return gctPath;

          // Chromium (older Playwright)
          const chromiumPath = join(appBase, 'Chromium.app', 'Contents', 'MacOS', 'Chromium');
          if (existsSync(chromiumPath)) return chromiumPath;
        }
      } else {
        // Linux: chromium-XXXX/chrome-linux/chrome
        const linuxPath = join(chromiumBase, 'chrome-linux', 'chrome');
        if (existsSync(linuxPath)) return linuxPath;
      }
    }
  } catch {
    // Permission errors, etc.
  }

  return null;
}

/**
 * Try to get Playwright's chromium executable path via the module API.
 * This may fail in compiled binaries when CWD doesn't contain node_modules.
 */
function tryPlaywrightModuleExecPath(): string | null {
  try {
    // Dynamic import to avoid crashing if playwright isn't resolvable
    const { chromium } = require('playwright');
    const execPath = chromium.executablePath();
    if (execPath && existsSync(execPath)) {
      return execPath;
    }
  } catch {
    // Module not resolvable from CWD — this is the bug we're fixing
  }
  return null;
}

/**
 * Find system browser paths (Chrome, Edge).
 * Returns the first one found, or null.
 */
function findSystemBrowser(): string | null {
  if (process.platform === 'win32') {
    const candidates = [
      join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ];
    for (const path of candidates) {
      if (path && existsSync(path)) return path;
    }
  } else if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
    for (const path of candidates) {
      if (existsSync(path)) return path;
    }
  } else {
    // Linux
    const candidates = [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ];
    for (const path of candidates) {
      if (existsSync(path)) return path;
    }
  }
  return null;
}

export interface BrowserResolution {
  /** Path to the browser executable */
  executablePath: string;
  /** How the browser was found */
  source: 'system-chrome' | 'system-edge' | 'system-browser' | 'playwright-module' | 'playwright-cache';
}

/**
 * Resolve a browser executable path, trying multiple strategies.
 *
 * Resolution order:
 * 1. System browsers (Chrome, Edge) — always works, no module resolution needed
 * 2. Playwright module API (chromium.executablePath()) — works when module is resolvable
 * 3. Direct scan of Playwright browser cache — CWD-independent fallback
 *
 * @returns BrowserResolution with path and source, or null if no browser found
 */
export function findBrowserExecutable(): BrowserResolution | null {
  // 1. System browsers
  const systemBrowser = findSystemBrowser();
  if (systemBrowser) {
    const source = systemBrowser.toLowerCase().includes('edge') ? 'system-edge' as const
      : systemBrowser.toLowerCase().includes('chrome') ? 'system-chrome' as const
      : 'system-browser' as const;
    return { executablePath: systemBrowser, source };
  }

  // 2. Playwright module API
  const playwrightModule = tryPlaywrightModuleExecPath();
  if (playwrightModule) {
    return { executablePath: playwrightModule, source: 'playwright-module' };
  }

  // 3. Direct scan of Playwright cache directories
  for (const cacheDir of getPlaywrightCacheDirs()) {
    const cached = findChromiumInCache(cacheDir);
    if (cached) {
      return { executablePath: cached, source: 'playwright-cache' };
    }
  }

  return null;
}

/**
 * Check if any browser (system or Playwright) is available.
 */
export function isBrowserAvailable(): boolean {
  return findBrowserExecutable() !== null;
}

/**
 * Get the Playwright Chromium executable path specifically.
 * Tries the module API first, then scans cache directories.
 * Does NOT fall back to system browsers.
 */
export function findPlaywrightChromium(): string | null {
  // Try module API first
  const moduleResult = tryPlaywrightModuleExecPath();
  if (moduleResult) return moduleResult;

  // Scan cache directories
  for (const cacheDir of getPlaywrightCacheDirs()) {
    const cached = findChromiumInCache(cacheDir);
    if (cached) return cached;
  }

  return null;
}
