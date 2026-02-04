#!/usr/bin/env bun
/**
 * Tana Export CLI - Export Tana workspace data
 *
 * Uses Tana's API for fast exports (primary method).
 * Falls back to browser automation if API fails.
 *
 * Usage:
 *   supertag-export login              First-time login setup (browser)
 *   supertag-export run                Export default workspace
 *   supertag-export run --all          Export all enabled workspaces
 *   supertag-export status             Show export configuration
 */

import { Command } from "commander";
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { spawn, execSync } from "child_process";
import { homedir } from "os";
import { $ } from "bun";

// Import shared config from parent tana package
import { getConfig } from "../src/config/manager";
import {
  resolveWorkspace,
  getEnabledWorkspaces,
  createSimpleLogger,
  BROWSER_DATA_DIR,
  DEFAULT_EXPORT_DIR,
} from "../src/config/paths";
import { VERSION } from "../src/version";

// Import API modules
import { getAuthToken, isTokenValid, getTokenExpiryMinutes, extractTokenFromBrowser, saveCachedToken, type AuthLogger } from "./lib/auth";
import { getAccount, getSnapshotMeta, getSnapshotUrl, downloadSnapshot } from "./lib/api";
import { discoverWorkspaces, discoverWorkspacesViaCDP } from "./lib/discover";

const USER_DATA_DIR = BROWSER_DATA_DIR;
const TANA_APP_URL = "https://app.tana.inc";

const logger = createSimpleLogger("supertag-export");

/**
 * Check if Playwright chromium browser is installed
 */
async function isBrowserInstalled(): Promise<boolean> {
  try {
    // Try to get the executable path - this will throw if not installed
    const execPath = chromium.executablePath();
    return existsSync(execPath);
  } catch {
    return false;
  }
}

/**
 * Install Playwright chromium browser
 */
async function installBrowser(): Promise<boolean> {
  logger.info("Playwright chromium browser not found. Installing...");
  logger.info("This is a one-time setup that may take a few minutes.\n");

  try {
    // Use bunx to run playwright install chromium
    const result = await $`bunx playwright install chromium`.quiet();

    if (result.exitCode === 0) {
      logger.info("Browser installed successfully!\n");
      return true;
    } else {
      logger.error("Browser installation failed");
      logger.error("Try running manually: bunx playwright install chromium");
      return false;
    }
  } catch (error) {
    logger.error("Browser installation failed", error as Error);
    logger.error("Try running manually: bunx playwright install chromium");
    return false;
  }
}

/**
 * Ensure browser is installed before running browser operations
 */
async function ensureBrowser(): Promise<boolean> {
  if (await isBrowserInstalled()) {
    return true;
  }
  return await installBrowser();
}

interface ExportOptions {
  exportDir: string;
  verbose: boolean;
  /** Workspace root file ID for API calls (NOT the nodeid from URLs) */
  rootFileId?: string;
}

interface ExportResult {
  success: boolean;
  path?: string;
  error?: string;
  nodeCount?: number;
  sizeMB?: number;
}

/**
 * Export workspace using API (fast method)
 */
async function exportViaApi(options: ExportOptions): Promise<ExportResult> {
  const { exportDir, verbose } = options;

  // Step 1: Get auth token (cached, API refresh, or browser extraction)
  const authLog: AuthLogger | undefined = verbose ? (msg) => logger.info(msg) : undefined;
  const authResult = await getAuthToken(authLog);

  if (!authResult) {
    return {
      success: false,
      error: "No auth token found. Run 'supertag-export login' first.",
    };
  }

  const { auth, method } = authResult;

  if (!isTokenValid(auth)) {
    return {
      success: false,
      error: "Auth token expired. Please login to Tana in browser to refresh session.",
    };
  }

  const expiresIn = getTokenExpiryMinutes(auth);
  if (verbose) logger.info(`Token valid (expires in ${expiresIn} minutes, method: ${method})`);

  // Step 2: Determine rootFileId - use provided rootFileId or fetch from account
  let rootFileId: string;

  if (options.rootFileId) {
    // Use the explicitly provided rootFileId
    rootFileId = options.rootFileId;
    if (verbose) logger.info(`Using provided rootFileId: ${rootFileId}`);
  } else {
    // Fetch from account (returns primary workspace's rootFileId)
    if (verbose) logger.info("Fetching account info for primary workspace...");
    const account = await getAccount(auth.accessToken);

    if (!account.rootFileId) {
      return {
        success: false,
        error: "Could not find rootFileId in account response",
      };
    }
    rootFileId = account.rootFileId;
    if (verbose) logger.info(`Primary workspace rootFileId: ${rootFileId}`);
  }

  // Step 3: Get snapshot metadata
  if (verbose) logger.info("Fetching snapshot metadata...");
  const meta = await getSnapshotMeta(auth.accessToken, rootFileId);

  const nodeCount = meta.metadata.nodeCount;
  const sizeBytes = meta.metadata.size;
  const homeNodeName = meta.metadata.homeNodeName.replace(/<[^>]*>/g, ''); // Strip HTML
  const lastUpdated = meta.metadata.lastUpdated;

  logger.info(`Workspace: ${homeNodeName}`);
  logger.info(`Nodes: ${nodeCount.toLocaleString()}, Size: ${(sizeBytes / 1024 / 1024).toFixed(1)}MB`);

  // Show snapshot freshness - helps diagnose stale data issues
  if (lastUpdated) {
    const snapshotDate = new Date(lastUpdated);
    const now = new Date();
    const ageHours = Math.round((now.getTime() - snapshotDate.getTime()) / (1000 * 60 * 60));
    const ageDisplay = ageHours < 24 ? `${ageHours}h ago` : `${Math.round(ageHours / 24)}d ago`;
    logger.info(`Snapshot: ${snapshotDate.toISOString().replace('T', ' ').slice(0, 19)} (${ageDisplay})`);
    if (ageHours > 24) {
      logger.warn(`⚠️  Snapshot is ${ageDisplay} old - may be missing recent changes`);
    }
  }

  // Step 4: Get download URL
  if (verbose) logger.info("Getting snapshot download URL...");
  const snapshot = await getSnapshotUrl(auth.accessToken, rootFileId);

  if (!snapshot.url) {
    return {
      success: false,
      error: "No download URL in snapshot response",
    };
  }

  // Step 5: Download snapshot
  logger.info("Downloading snapshot...");
  const buffer = await downloadSnapshot(snapshot.url);

  // Ensure export directory exists
  if (!existsSync(exportDir)) {
    mkdirSync(exportDir, { recursive: true });
  }

  // Save to file
  const date = new Date().toISOString().split("T")[0];
  const filename = `${rootFileId}@${date}.json`;
  const destPath = join(exportDir, filename);

  writeFileSync(destPath, Buffer.from(buffer));

  const sizeMB = buffer.byteLength / 1024 / 1024;
  logger.info(`Saved to: ${destPath} (${sizeMB.toFixed(1)}MB)`);

  return {
    success: true,
    path: destPath,
    nodeCount,
    sizeMB,
  };
}

/**
 * Extract Firebase Web API key from browser context
 * This key is required for token refresh without browser
 */
async function extractFirebaseApiKey(page: any): Promise<string | null> {
  try {
    const apiKey = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const request = indexedDB.open("firebaseLocalStorageDb");
        request.onsuccess = () => {
          const db = request.result;
          try {
            const transaction = db.transaction(["firebaseLocalStorage"], "readonly");
            const store = transaction.objectStore("firebaseLocalStorage");
            const getAllRequest = store.getAll();

            getAllRequest.onsuccess = () => {
              const results = getAllRequest.result;
              // Find the Firebase config entry with apiKey
              for (const entry of results) {
                if (entry?.value?.apiKey) {
                  resolve(entry.value.apiKey);
                  return;
                }
              }
              resolve(null);
            };
            getAllRequest.onerror = () => resolve(null);
          } catch {
            resolve(null);
          }
        };
        request.onerror = () => resolve(null);
      });
    });
    return apiKey;
  } catch {
    return null;
  }
}

interface LoginOptions {
  channel?: 'chrome' | 'msedge';
  timeout?: number;
}

/**
 * Detect which browser type a given executable path represents
 */
function detectBrowserType(browserPath: string): 'chrome' | 'edge' | 'other' {
  const lower = browserPath.toLowerCase();
  if (lower.includes('edge') || lower.includes('msedge')) return 'edge';
  if (lower.includes('chrome') || lower.includes('chromium')) return 'chrome';
  return 'other';
}

/**
 * Check if a browser (Chrome or Edge) is already running
 */
async function isBrowserRunning(browser: 'chrome' | 'edge'): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const imageName = browser === 'edge' ? 'msedge.exe' : 'chrome.exe';
      const result = execSync(`tasklist /FI "IMAGENAME eq ${imageName}" /NH`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      return result.includes(imageName);
    } else if (process.platform === 'darwin') {
      const processName = browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome';
      try {
        execSync(`pgrep -x "${processName}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        return true;
      } catch {
        return false; // pgrep exits non-zero when no match
      }
    } else {
      // Linux
      const processName = browser === 'edge' ? 'msedge' : 'chrome';
      try {
        execSync(`pgrep -x "${processName}"`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        return true;
      } catch {
        return false;
      }
    }
  } catch {
    return false;
  }
}

/**
 * Kill a running browser process
 */
async function killBrowser(browser: 'chrome' | 'edge'): Promise<void> {
  try {
    if (process.platform === 'win32') {
      const imageName = browser === 'edge' ? 'msedge.exe' : 'chrome.exe';
      execSync(`taskkill /IM ${imageName} /F`, { stdio: ['pipe', 'pipe', 'pipe'] });
    } else {
      const processName = process.platform === 'darwin'
        ? (browser === 'edge' ? 'Microsoft Edge' : 'Google Chrome')
        : (browser === 'edge' ? 'msedge' : 'chrome');
      execSync(`pkill -x "${processName}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
    }
  } catch {
    // Process may have already exited
  }

  // Wait for processes to fully exit (up to 5s)
  for (let i = 0; i < 10; i++) {
    if (!(await isBrowserRunning(browser))) return;
    await new Promise(r => setTimeout(r, 500));
  }
}

/**
 * Get the real user profile path for a browser
 * Using the real profile means existing Tana sessions persist - no re-login needed
 */
function getRealProfilePath(browser: 'chrome' | 'edge'): string | null {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) return null;
    const profilePath = browser === 'edge'
      ? join(localAppData, 'Microsoft', 'Edge', 'User Data')
      : join(localAppData, 'Google', 'Chrome', 'User Data');
    return existsSync(profilePath) ? profilePath : null;
  } else if (process.platform === 'darwin') {
    const profilePath = browser === 'edge'
      ? join(homedir(), 'Library', 'Application Support', 'Microsoft Edge')
      : join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
    return existsSync(profilePath) ? profilePath : null;
  } else {
    // Linux
    const profilePath = browser === 'edge'
      ? join(homedir(), '.config', 'microsoft-edge')
      : join(homedir(), '.config', 'google-chrome');
    return existsSync(profilePath) ? profilePath : null;
  }
}

/**
 * Poll for the CDP debug port to become ready
 * Returns true if port is reachable, false on timeout
 */
async function waitForPort(port: number, timeoutMs: number = 15000): Promise<boolean> {
  const start = Date.now();
  const interval = 500;

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}/json/version`);
      if (response.ok) return true;
    } catch {
      // Port not ready yet
    }
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}

/**
 * Manual login mode - spawns browser directly (bypasses Playwright launch issues)
 * Use this when launchPersistentContext fails on Windows
 */
async function manualLogin(timeout: number = 180000): Promise<void> {
  // Use a fixed debug port for CDP token extraction
  const debugPort = 19222;

  // Find browser executable
  let browserPath: string;

  if (process.platform === 'win32') {
    // Try Chrome first, then Edge
    const chromePath = join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe');
    const edgePath = join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    const edgePathX86 = join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe');

    if (existsSync(chromePath)) {
      browserPath = chromePath;
    } else if (existsSync(edgePath)) {
      browserPath = edgePath;
    } else if (existsSync(edgePathX86)) {
      browserPath = edgePathX86;
    } else {
      // Try Playwright's bundled Chromium as fallback
      try {
        browserPath = chromium.executablePath();
      } catch {
        throw new Error("No browser found. Install Chrome or Edge, or run 'supertag-export setup'");
      }
    }
  } else if (process.platform === 'darwin') {
    browserPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!existsSync(browserPath)) {
      try {
        browserPath = chromium.executablePath();
      } catch {
        throw new Error("No browser found. Install Chrome or run 'supertag-export setup'");
      }
    }
  } else {
    // Linux - use Playwright's bundled Chromium
    try {
      browserPath = chromium.executablePath();
    } catch {
      throw new Error("Browser not available. Run 'supertag-export setup' first");
    }
  }

  // Detect browser type and check if already running
  const browserType = detectBrowserType(browserPath);
  let useRealProfile = false;
  let profileDir = USER_DATA_DIR;

  if (browserType !== 'other') {
    const running = await isBrowserRunning(browserType);

    if (running) {
      logger.info(`${browserType === 'edge' ? 'Edge' : 'Chrome'} is already running.`);
      logger.info("Authentication requires restarting it with debugging enabled.");
      logger.info("Your tabs will be restored when the browser reopens.");
      logger.info("");
      logger.info("Press Enter to restart the browser, or Ctrl+C to cancel...");

      await new Promise<void>((resolve) => {
        process.stdin.setRawMode?.(false);
        process.stdin.resume();
        process.stdin.once('data', () => resolve());
      });

      logger.info(`Closing ${browserType === 'edge' ? 'Edge' : 'Chrome'}...`);
      await killBrowser(browserType);
      logger.info("Browser closed.");
    }

    // Use real profile if available (user stays logged in to Tana)
    const realProfile = getRealProfilePath(browserType);
    if (realProfile) {
      useRealProfile = true;
      profileDir = realProfile;
      logger.info("Using existing browser profile (no re-login needed).");
    }
  }

  // Ensure profile directory exists (only needed for custom profile)
  if (!useRealProfile && !existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  logger.info("");
  logger.info("Manual login mode - bypassing Playwright browser launch");
  logger.info("");
  if (useRealProfile) {
    logger.info("1. A browser window will open to Tana");
    logger.info("2. You should already be logged in (existing session)");
    logger.info("3. Wait until you see the Tana workspace");
    logger.info("4. Press Enter here (keep the browser open!)");
  } else {
    logger.info("1. A browser window will open to Tana");
    logger.info("2. Log in to Tana (via Google or email)");
    logger.info("3. Wait until you see the Tana workspace");
    logger.info("4. Press Enter here (keep the browser open!)");
  }
  logger.info("");

  const browserArgs = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    TANA_APP_URL,
  ];

  logger.info(`Launching browser: ${browserPath}`);

  // Spawn browser process directly
  const browserProcess = spawn(browserPath, browserArgs, {
    detached: true,
    stdio: 'ignore',
  });

  browserProcess.unref();

  // Wait for debug port to become ready
  logger.info("Waiting for browser debug port...");
  const portReady = await waitForPort(debugPort);
  if (portReady) {
    logger.info("Debug port ready.");
  } else {
    logger.warn("Debug port did not open within 15 seconds.");
    logger.warn("CDP token extraction may fail. Profile extraction will be attempted as fallback.");
  }

  logger.info("");
  logger.info("Browser launched. Complete login, then press Enter when done...");

  // Wait for user to press Enter (with properly cleared timeout)
  await new Promise<void>((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        logger.warn("Timeout reached, proceeding with token extraction...");
        resolve();
      }
    }, timeout);

    process.stdin.setRawMode?.(false);
    process.stdin.resume();
    process.stdin.once('data', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve();
      }
    });
  });

  // Extract tokens via CDP (connects to the running browser)
  logger.info("");
  logger.info("Extracting authentication tokens...");

  let extracted = false;

  // Method 1: CDP connection to the running browser (most reliable)
  try {
    logger.info("Connecting to browser...");
    const browser = await chromium.connectOverCDP(`http://localhost:${debugPort}`, { timeout: 30000 });
    const contexts = browser.contexts();
    const pages = contexts[0]?.pages() || [];
    const page = pages.find(p => p.url().includes('tana.inc')) || pages[0];

    if (page) {
      // Extract auth tokens from the live browser session
      const firebaseData = await page.evaluate(async () => {
        return new Promise((resolve) => {
          const request = indexedDB.open('firebaseLocalStorageDb');
          request.onsuccess = () => {
            const db = request.result;
            try {
              const tx = db.transaction('firebaseLocalStorage', 'readonly');
              const store = tx.objectStore('firebaseLocalStorage');
              const getAllRequest = store.getAll();
              getAllRequest.onsuccess = () => resolve(getAllRequest.result);
              getAllRequest.onerror = () => resolve([]);
            } catch { resolve([]); }
          };
          request.onerror = () => resolve([]);
        });
      });

      if (Array.isArray(firebaseData)) {
        for (const item of firebaseData as any[]) {
          if (item?.value?.stsTokenManager) {
            const { accessToken, refreshToken, expirationTime } = item.value.stsTokenManager;
            saveCachedToken({ accessToken, refreshToken, expirationTime });
            logger.info("✓ Auth tokens extracted and saved");

            // Also extract Firebase API key
            if (item.value.apiKey) {
              getConfig().setFirebaseApiKey(item.value.apiKey);
              logger.info("✓ Firebase API key saved");
            }
            extracted = true;
            break;
          }
        }
      }
    }

    // Disconnect without closing the user's browser
    browser.close().catch(() => {});
  } catch (cdpError) {
    logger.info("Could not connect via CDP (browser may be closed), trying profile extraction...");
  }

  // Method 2: Fallback to profile-based extraction (original method)
  if (!extracted) {
    try {
      const auth = await extractTokenFromBrowser();
      if (auth) {
        logger.info("✓ Auth tokens extracted from browser profile");
        extracted = true;

        // Try to extract Firebase API key via headless browser
        try {
          const context = await chromium.launchPersistentContext(USER_DATA_DIR, { headless: true });
          try {
            const page = context.pages()[0] || await context.newPage();
            await page.goto(TANA_APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2000);
            const apiKey = await extractFirebaseApiKey(page);
            if (apiKey) {
              const config = getConfig();
              config.setFirebaseApiKey(apiKey);
              logger.info("✓ Firebase API key saved");
            }
          } finally {
            await context.close();
          }
        } catch { /* API key extraction is optional */ }
      }
    } catch (profileError) {
      logger.info("Profile extraction also failed");
    }
  }

  if (extracted) {
    logger.info("");
    logger.info("✓ Login session saved successfully!");
    logger.info("  You can now run: supertag-export run");
  } else {
    logger.warn("Could not extract auth tokens.");
    logger.info("");
    logger.info("Troubleshooting:");
    logger.info("  1. Make sure you logged in and saw the Tana workspace");
    logger.info("  2. Keep the browser open when you press Enter");
    logger.info("  3. Try: supertag-export login --channel chrome");
  }
}

/**
 * Interactive login via browser
 * Extracts and saves Firebase API key for token refresh
 */
async function interactiveLogin(options: LoginOptions = {}): Promise<void> {
  const { channel, timeout = 180000 } = options;

  // Ensure browser is installed (skip for system browser)
  if (!channel && !await ensureBrowser()) {
    throw new Error("Browser not available. Please install manually: bunx playwright install chromium");
  }

  logger.info("Opening browser for Tana login...");
  if (channel) {
    logger.info(`Using system browser: ${channel}`);
  }
  logger.info("");
  logger.info("1. Log in to Tana (via Google or email)");
  logger.info("2. Once you see the Tana workspace, the API key will be extracted");
  logger.info("3. Close the browser when done");
  logger.info("");

  // Ensure browser data directory exists
  if (!existsSync(USER_DATA_DIR)) {
    mkdirSync(USER_DATA_DIR, { recursive: true });
  }

  // Build launch args - add Windows-specific GPU args to avoid rendering issues
  const launchArgs = [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
  ];

  // Windows-specific fixes for Playwright browser launch issues
  if (process.platform === 'win32') {
    launchArgs.push(
      "--disable-gpu",
      "--disable-software-rasterizer",
      "--disable-dev-shm-usage",
    );
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: channel, // Use system Chrome/Edge if specified
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: launchArgs,
    timeout: timeout,
  });

  const page = context.pages()[0] || (await context.newPage());

  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  await page.goto(TANA_APP_URL);

  // Poll for successful login and extract Firebase API key
  let apiKeyExtracted = false;
  const checkInterval = setInterval(async () => {
    try {
      // Check if we're logged in (workspace visible)
      const isLoggedIn = await page.evaluate(() => {
        return document.querySelector("[data-testid=\"workspace\"]") !== null ||
               document.querySelector(".workspace") !== null ||
               !document.body.textContent?.includes("Sign in");
      });

      if (isLoggedIn && !apiKeyExtracted) {
        // Wait a moment for tokens to be stored
        await new Promise(r => setTimeout(r, 2000));

        const apiKey = await extractFirebaseApiKey(page);
        if (apiKey) {
          const config = getConfig();
          config.setFirebaseApiKey(apiKey);
          apiKeyExtracted = true;
          logger.info("");
          logger.info("✓ Firebase API key extracted and saved to config");
          logger.info("  Token refresh will now work without browser interaction");
          logger.info("  You can close the browser.");
        }
      }
    } catch {
      // Page might be navigating, ignore errors
    }
  }, 3000);

  // Wait for user to close browser
  await new Promise<void>((resolve) => {
    context.on("close", () => {
      clearInterval(checkInterval);
      resolve();
    });
  });

  logger.info("Login session saved.");
  if (apiKeyExtracted) {
    logger.info("Firebase API key saved - automated exports are now enabled.");
  } else {
    logger.warn("Firebase API key not extracted - token refresh may not work.");
    logger.warn("Try logging in again and waiting until you see the workspace.");
  }
}

/**
 * Manual workspace discovery - spawns browser directly and connects via CDP
 * Used when Playwright's launchPersistentContext fails (Windows)
 */
async function manualDiscover(options: { timeout?: number } = {}): Promise<import("./lib/discover").DiscoveredWorkspace[]> {
  const debugPort = 19222;
  const timeout = options.timeout ?? 15000;

  // Find browser executable (same logic as manualLogin)
  let browserPath: string;

  if (process.platform === 'win32') {
    const chromePath = join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe');
    const edgePath = join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    const edgePathX86 = join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe');

    if (existsSync(chromePath)) {
      browserPath = chromePath;
    } else if (existsSync(edgePath)) {
      browserPath = edgePath;
    } else if (existsSync(edgePathX86)) {
      browserPath = edgePathX86;
    } else {
      try {
        browserPath = chromium.executablePath();
      } catch {
        throw new Error("No browser found. Install Chrome or Edge, or run 'supertag-export setup'");
      }
    }
  } else if (process.platform === 'darwin') {
    browserPath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    if (!existsSync(browserPath)) {
      try {
        browserPath = chromium.executablePath();
      } catch {
        throw new Error("No browser found. Install Chrome or run 'supertag-export setup'");
      }
    }
  } else {
    try {
      browserPath = chromium.executablePath();
    } catch {
      throw new Error("Browser not available. Run 'supertag-export setup' first");
    }
  }

  // Detect browser type and check if already running
  const browserType = detectBrowserType(browserPath);
  let profileDir = USER_DATA_DIR;

  if (browserType !== 'other') {
    const running = await isBrowserRunning(browserType);

    if (running) {
      logger.info(`${browserType === 'edge' ? 'Edge' : 'Chrome'} is already running.`);
      logger.info("Discovery requires restarting it with debugging enabled.");
      logger.info("Your tabs will be restored when the browser reopens.");
      logger.info("");
      logger.info("Press Enter to restart the browser, or Ctrl+C to cancel...");

      await new Promise<void>((resolve) => {
        process.stdin.setRawMode?.(false);
        process.stdin.resume();
        process.stdin.once('data', () => resolve());
      });

      logger.info(`Closing ${browserType === 'edge' ? 'Edge' : 'Chrome'}...`);
      await killBrowser(browserType);
      logger.info("Browser closed.");
    }

    // Use real profile if available (user stays logged in to Tana)
    const realProfile = getRealProfilePath(browserType);
    if (realProfile) {
      profileDir = realProfile;
      logger.info("Using existing browser profile.");
    }
  }

  // Ensure profile directory exists
  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  const browserArgs = [
    `--user-data-dir=${profileDir}`,
    `--remote-debugging-port=${debugPort}`,
    "--no-first-run",
    "--no-default-browser-check",
    TANA_APP_URL,
  ];

  logger.info(`Launching browser: ${browserPath}`);

  const browserProcess = spawn(browserPath, browserArgs, {
    detached: true,
    stdio: 'ignore',
  });
  browserProcess.unref();

  // Wait for debug port to become ready
  logger.info("Waiting for browser debug port...");
  const portReady = await waitForPort(debugPort);
  if (!portReady) {
    throw new Error("Browser debug port did not open. Make sure the browser launched correctly.");
  }

  logger.info("Debug port ready. Waiting for Tana to load...");

  try {
    const workspaces = await discoverWorkspacesViaCDP({
      port: debugPort,
      timeout: timeout,
      verbose: true,
    });

    return workspaces;
  } finally {
    // Try to close the browser we spawned
    if (browserType !== 'other') {
      await killBrowser(browserType);
    }
  }
}

/**
 * Display discovered workspaces and optionally configure them
 */
function displayAndConfigureWorkspaces(
  workspaces: import("./lib/discover").DiscoveredWorkspace[],
  options: { add?: boolean; update?: boolean },
): void {
  console.log(`\nDiscovered ${workspaces.length} workspace(s):\n`);

  const config = getConfig();
  const existingWorkspaces = config.getAllWorkspaces();

  for (const ws of workspaces) {
    // Check if this workspace is already configured
    let existingAlias: string | undefined;
    for (const [alias, existing] of Object.entries(existingWorkspaces)) {
      if (existing.nodeid === ws.homeNodeId || existing.rootFileId === ws.rootFileId) {
        existingAlias = alias;
        break;
      }
    }

    const status = existingAlias ? `(configured as "${existingAlias}")` : "(not configured)";
    const rootMarker = ws.isRootFile ? " [root]" : "";
    console.log(`  ${ws.name}${rootMarker}`);
    console.log(`    nodeid: ${ws.homeNodeId}`);
    console.log(`    rootFileId: ${ws.rootFileId}`);
    console.log(`    nodes: ${ws.nodeCount.toLocaleString()}`);
    console.log(`    status: ${status}`);
    console.log("");

    // Auto-add if requested
    if (options.add && !existingAlias) {
      const alias = ws.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      config.addWorkspace(alias, ws.rootFileId, {
        name: ws.name,
        nodeid: ws.homeNodeId,
        enabled: true,
      });
      console.log(`    → Added as "${alias}"\n`);
    }

    // Auto-update if requested
    if (options.update && existingAlias) {
      const existing = existingWorkspaces[existingAlias];
      if (!existing.rootFileId || existing.rootFileId !== ws.rootFileId) {
        config.updateWorkspace(existingAlias, { rootFileId: ws.rootFileId });
        console.log(`    → Updated rootFileId for "${existingAlias}"\n`);
      }
    }
  }

  // Auto-add first workspace as 'main' if no workspaces configured
  const hasConfiguredWorkspaces = Object.keys(existingWorkspaces).length > 0;

  if (!hasConfiguredWorkspaces && !options.add && !options.update && workspaces.length > 0) {
    const firstWorkspace = workspaces[0]; // Root workspace (sorted first)
    config.addWorkspace("main", firstWorkspace.rootFileId, {
      name: firstWorkspace.name,
      nodeid: firstWorkspace.homeNodeId,
      enabled: true,
    });
    config.setDefaultWorkspace("main");
    console.log(`\n✓ Automatically added "${firstWorkspace.name}" as workspace "main"\n`);
    console.log("Next steps:");
    console.log("  1. Run: supertag-export run");
    console.log("  2. Then: supertag sync index\n");
  } else if (!options.add && !options.update) {
    console.log("To add a workspace:");
    console.log("  supertag workspace add <rootFileId> --alias <name>\n");
    console.log("Or use --add to automatically add all discovered workspaces:");
    console.log("  supertag-export discover --add\n");
    console.log("Or use --update to update existing workspaces with rootFileIds:");
    console.log("  supertag-export discover --update");
  }
}

/**
 * Show export status
 */
async function showStatus(): Promise<void> {
  console.log("Tana Export Status\n");

  // Check browser session
  console.log("Browser Session:");
  const authResult = await getAuthToken();
  if (authResult) {
    if (isTokenValid(authResult.auth)) {
      const expiresIn = getTokenExpiryMinutes(authResult.auth);
      console.log(`  ✓ Logged in (token expires in ${expiresIn} minutes) [${authResult.method}]`);
    } else {
      console.log("  ⚠ Token expired - run 'supertag-export login' to refresh");
    }
  } else {
    console.log("  ✗ Not logged in - run 'supertag-export login'");
  }

  // Check configured workspaces
  console.log("\nWorkspaces:");
  const config = getConfig().getConfig();
  const workspaces = config.workspaces;

  if (!workspaces || Object.keys(workspaces).length === 0) {
    console.log("  No workspaces configured");
    console.log("  Add one with: tana workspace add <nodeid> --alias <name>");
  } else {
    for (const [alias, ws] of Object.entries(workspaces)) {
      const status = ws.enabled ? "✓" : "○";
      const isDefault = alias === config.defaultWorkspace ? " (default)" : "";
      const hasRootFileId = ws.rootFileId ? "✓" : "✗";
      console.log(`  ${status} ${alias}${isDefault}`);
      console.log(`    nodeid: ${ws.nodeid}`);
      console.log(`    rootFileId: ${ws.rootFileId || "(not set - export will fail)"} ${hasRootFileId}`);
    }
  }

  // Show paths
  console.log("\nPaths:");
  console.log(`  Browser data: ${USER_DATA_DIR}`);
  console.log(`  Default export: ${DEFAULT_EXPORT_DIR}`);
}

// CLI Setup
const program = new Command();

program
  .name("supertag-export")
  .description('Browser automation for Tana workspace exports')
  .version(VERSION);

program
  .command("setup")
  .description("Install Playwright browser (required for login and discover)")
  .action(async () => {
    const installed = await isBrowserInstalled();
    if (installed) {
      logger.info("Playwright chromium browser is already installed.");
      logger.info(`Executable: ${chromium.executablePath()}`);
      return;
    }

    const success = await installBrowser();
    if (success) {
      logger.info(`Executable: ${chromium.executablePath()}`);
    } else {
      process.exit(1);
    }
  });

program
  .command("login")
  .description("Interactive login to Tana (first-time setup)")
  .option("--channel <browser>", "Use system browser: 'chrome' or 'msedge' (Windows fix)")
  .option("--manual", "Manual login mode: opens browser directly, extracts tokens after")
  .option("--timeout <seconds>", "Login timeout in seconds (default: 180)", "180")
  .action(async (options: { channel?: string; manual?: boolean; timeout: string }) => {
    try {
      const timeout = parseInt(options.timeout) * 1000;
      if (options.manual) {
        await manualLogin(timeout);
      } else {
        await interactiveLogin({ channel: options.channel as 'chrome' | 'msedge' | undefined, timeout });
      }
    } catch (error) {
      logger.error("Login failed", error as Error);
      process.exit(1);
    }
  });

program
  .command("run")
  .description("Run export for workspace(s)")
  .option("-w, --workspace <alias>", "Workspace alias")
  .option("--nodeid <id>", "Direct rootFileId for API (e.g., 7e25I56wgQ, NOT the URL nodeid)")
  .option("--all", "Export all enabled workspaces")
  .option("-o, --export-dir <path>", "Export directory (default: ~/Documents/Tana-Export)")
  .option("-v, --verbose", "Verbose output")
  .action(async (options) => {
    const verbose = options.verbose || false;

    // Handle --all option
    if (options.all) {
      const config = getConfig().getConfig();
      const workspaces = getEnabledWorkspaces(config);

      if (workspaces.length === 0) {
        logger.error("No enabled workspaces configured");
        logger.error("Add workspaces with: tana workspace add <nodeid> --alias <name>");
        process.exit(1);
      }

      logger.info(`Exporting ${workspaces.length} workspace(s)...\n`);

      let successCount = 0;
      let failCount = 0;

      for (const ws of workspaces) {
        logger.info(`=== Workspace: ${ws.alias} ===`);

        if (!ws.rootFileId) {
          logger.error(`Skipping: rootFileId not configured for workspace "${ws.alias}"`);
          logger.error(`Add it with: tana workspace update ${ws.alias} --rootfileid <id>`);
          failCount++;
          console.log("");
          continue;
        }

        const result = await exportViaApi({
          exportDir: ws.exportDir,
          verbose,
          rootFileId: ws.rootFileId,
        });

        if (result.success) {
          successCount++;
        } else {
          failCount++;
          logger.error(`Failed: ${result.error}`);
        }
        console.log("");
      }

      logger.info(`Export complete: ${successCount} succeeded, ${failCount} failed`);
      process.exit(failCount > 0 ? 1 : 0);
    }

    // Single workspace export
    const config = getConfig().getConfig();
    const ctx = resolveWorkspace(options.workspace || options.nodeid, config);

    const exportDir = options.exportDir || ctx.exportDir || DEFAULT_EXPORT_DIR;

    // Use rootFileId from workspace context, or the --nodeid option (which should now be rootFileId)
    const rootFileId = ctx.rootFileId || options.nodeid;

    const result = await exportViaApi({
      exportDir,
      verbose,
      rootFileId,
    });

    if (!result.success) {
      logger.error(result.error || "Export failed");
      process.exit(1);
    }

    process.exit(0);
  });

program
  .command("status")
  .description("Show export configuration and browser session status")
  .action(async () => {
    await showStatus();
  });

program
  .command("discover")
  .description("Discover all workspaces by capturing Tana network traffic")
  .option("-t, --timeout <seconds>", "How long to wait for workspace data (default: 15)", "15")
  .option("--add", "Automatically add discovered workspaces to config")
  .option("--update", "Update existing workspaces with discovered rootFileIds")
  .option("--manual", "Use manual browser launch (bypasses Playwright issues on Windows)")
  .action(async (options: { timeout: string; add?: boolean; update?: boolean; manual?: boolean }) => {
    // Manual mode: spawn browser directly and connect via CDP
    if (options.manual) {
      console.log("Discovering Tana workspaces (manual mode)...\n");

      try {
        const workspaces = await manualDiscover({
          timeout: parseInt(options.timeout) * 1000,
        });

        if (workspaces.length === 0) {
          console.log("\nNo workspaces discovered. Make sure you are logged in to Tana.");
          console.log("Run: supertag-export login --manual");
          return;
        }

        displayAndConfigureWorkspaces(workspaces, options);
      } catch (error) {
        console.error("Discovery failed:", error instanceof Error ? error.message : error);
        process.exit(1);
      }
      return;
    }

    // Standard mode: use Playwright's launchPersistentContext
    if (!await ensureBrowser()) {
      console.error("Browser not available. Please install manually: bunx playwright install chromium");
      console.error("Or try: supertag-export discover --manual");
      process.exit(1);
    }

    console.log("Discovering Tana workspaces...\n");

    try {
      const workspaces = await discoverWorkspaces({
        timeout: parseInt(options.timeout) * 1000,
        verbose: true,
      });

      if (workspaces.length === 0) {
        console.log("\nNo workspaces discovered. Make sure you are logged in to Tana.");
        console.log("Run: supertag-export login");
        return;
      }

      displayAndConfigureWorkspaces(workspaces, options);
    } catch (error) {
      console.error("Discovery failed:", error instanceof Error ? error.message : error);
      console.error("\nIf browser launch failed, try: supertag-export discover --manual");
      process.exit(1);
    }
  });

program.parse();
