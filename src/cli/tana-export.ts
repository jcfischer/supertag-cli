#!/usr/bin/env bun
// @ts-nocheck - This file uses Playwright with browser context (document API)
/**
 * Tana Export CLI - Automates JSON export from Tana using Playwright
 *
 * Uses persistent browser context to preserve login session between runs.
 * First run requires manual login (Google allows real browser interactions),
 * subsequent runs are fully automated.
 *
 * Supports multi-workspace configuration via --workspace or --nodeid options.
 * Key: Uses channel: 'chromium' without automation flags to avoid Google detection.
 */

import { chromium, type BrowserContext } from 'playwright';
import { parseArgs } from 'util';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';

// Import logger using absolute path
const loggerPath = join(homedir(), 'work/DA/KAI/lib/logger.ts');
const { Logger } = await import(loggerPath);

// Import workspace resolution
import { getConfig } from '../config/manager';
import { resolveWorkspace, getEnabledWorkspaces, ensureWorkspaceDir } from '../config/paths';

// Configuration
const USER_DATA_DIR = join(homedir(), '.config', 'tana', 'browser-data');
const DEFAULT_EXPORT_DIR = join(homedir(), 'Documents', 'Tana-Export');
const TANA_APP_URL = 'https://app.tana.inc';

// Build workspace URL from nodeid
function getTanaWorkspaceUrl(nodeid: string): string {
  return `https://app.tana.inc/?nodeid=${nodeid}`;
}

// Logger
const logger = new Logger('tana-daily');

interface ExportOptions {
  exportDir: string;
  headless: boolean;
  timeout: number;
  verbose: boolean;
  nodeid: string;
}

async function ensureDirectories(exportDir: string): Promise<void> {
  if (!existsSync(USER_DATA_DIR)) {
    mkdirSync(USER_DATA_DIR, { recursive: true });
    logger.info(`Created browser data directory: ${USER_DATA_DIR}`);
  }
  if (!existsSync(exportDir)) {
    mkdirSync(exportDir, { recursive: true });
    logger.info(`Created export directory: ${exportDir}`);
  }
}

async function waitForTanaLoad(context: BrowserContext, verbose: boolean): Promise<boolean> {
  const page = context.pages()[0] || await context.newPage();

  // Check if we're on the Tana app
  const url = page.url();
  if (verbose) logger.debug(`Current URL: ${url}`);

  // Check for login state
  try {
    // Wait for the main Tana UI to be present
    await page.waitForSelector('[data-testid="workspace"]', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

async function performExport(options: ExportOptions): Promise<string | null> {
  const { exportDir, headless, timeout, verbose, nodeid } = options;

  if (!nodeid) {
    logger.error('No workspace node ID provided');
    logger.error('Use --nodeid <id> or configure workspaces with: tana workspace add <nodeid>');
    return null;
  }

  const workspaceUrl = getTanaWorkspaceUrl(nodeid);
  logger.info(`Exporting workspace: ${nodeid}`);
  if (verbose) logger.debug(`Workspace URL: ${workspaceUrl}`);

  await ensureDirectories(exportDir);

  if (verbose) logger.debug('Launching browser with persistent context...');

  // Use persistent context to preserve login (with anti-detection flags)
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    // Set download behavior to avoid "Save As" dialog
    downloadsPath: exportDir,
  });

  try {
    const page = context.pages()[0] || await context.newPage();

    // Override navigator.webdriver to avoid detection
    // Delete showSaveFilePicker so Tana falls back to regular download
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      // Remove File System Access API to force fallback to regular download
      // @ts-ignore
      delete window.showSaveFilePicker;
    });

    // Use CDP to set download behavior to bypass "Save As" dialog
    const client = await context.newCDPSession(page);
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: exportDir,
    });

    // Navigate directly to workspace URL (includes nodeid parameter)
    if (verbose) logger.debug(`Navigating to workspace: ${workspaceUrl}`);
    await page.goto(workspaceUrl, { waitUntil: 'networkidle', timeout });

    // Wait for page to stabilize
    await page.waitForTimeout(2000);

    // Check for interstitial page (Desktop app vs Browser choice)
    const pageText = await page.textContent('body');
    if (pageText?.includes('Desktop app') && pageText?.includes('Browser')) {
      if (verbose) logger.debug('Handling interstitial page...');

      // Click "Browser" button
      const browserBtn = page.locator('button:has-text("Browser")');
      if (await browserBtn.isVisible()) {
        await browserBtn.click();
        await page.waitForTimeout(2000);
      }
    }

    // Check if we need to log in
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('signin')) {
      logger.warn('LOGIN REQUIRED');
      logger.info('Please run: supertag-export --login');
      throw new Error('Not logged in. Run --login first.');
    }

    // Wait for Tana workspace to fully load (not just "Loading main workspace...")
    if (verbose) logger.debug('Waiting for workspace to fully load...');

    // Wait until "Loading" text disappears (max 30 seconds)
    let loadAttempts = 0;
    const maxLoadAttempts = 30;
    while (loadAttempts < maxLoadAttempts) {
      const bodyText = await page.textContent('body');
      if (!bodyText?.includes('Loading main workspace') && !bodyText?.includes('Loading...')) {
        if (verbose) logger.debug('Workspace loaded!');
        break;
      }
      if (verbose && loadAttempts % 5 === 0) logger.debug(`Still loading... (${loadAttempts}s)`);
      await page.waitForTimeout(1000);
      loadAttempts++;
    }

    if (loadAttempts >= maxLoadAttempts) {
      throw new Error('Tana workspace failed to load within 30 seconds');
    }

    // Additional wait for UI to fully stabilize after initial load
    // Tana has multiple loading phases after "Loading main workspace" disappears
    if (verbose) logger.debug('Waiting for UI to fully stabilize...');
    await page.waitForTimeout(8000);

    // Aggressively dismiss any engagement/marketing modals that might be blocking clicks
    if (verbose) logger.debug('Checking for modal overlays...');
    try {
      // Look for Amplitude engagement modal overlay
      const modalOverlay = page.locator('[data-amplitude-engagement-modal-overlay]');
      if (await modalOverlay.isVisible({ timeout: 2000 })) {
        if (verbose) logger.debug('Found modal overlay, forcibly removing it...');

        // Use JavaScript to directly remove the modal and its wrapper from the DOM
        await page.evaluate(() => {
          // Remove Amplitude engagement modal overlay
          const overlay = document.querySelector('[data-amplitude-engagement-modal-overlay]');
          if (overlay) overlay.remove();

          // Remove engagement wrapper
          const wrapper = document.querySelector('[data-engagement="1"]');
          if (wrapper) wrapper.remove();

          // Remove any other modal-like elements
          const modals = document.querySelectorAll('.rc-dialog-mask, .rc-dialog-wrap');
          modals.forEach(modal => modal.remove());
        });

        if (verbose) logger.debug('Modal removed via JavaScript');

        // Also press Escape multiple times to ensure any modal state is cleared
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(1000);

        if (verbose) logger.debug('Modal dismissal complete');
      } else {
        if (verbose) logger.debug('No modal overlay found');
      }
    } catch (modalError) {
      // Modal not present or already dismissed - continue
      if (verbose) logger.debug('Modal dismissal skipped (not present)');
    }

    // Click on the workspace title "Jens-Christian Fischer" in the main content area
    // This ensures the correct context for the export command
    // Note: Title may have an icon prefix, so use partial match
    if (verbose) logger.debug('Setting workspace context by clicking on title...');
    const workspaceTitle = page.locator('text=/Jens-Christian Fischer/').first();
    if (await workspaceTitle.isVisible({ timeout: 5000 })) {
      // Modal should be removed by now, so click normally
      await workspaceTitle.click();
      await page.waitForTimeout(1500);
      if (verbose) logger.debug('Clicked on workspace title - context set');
    } else {
      if (verbose) logger.debug('Workspace title not found, clicking on main content area...');
      // Try to find and click on the main content area
      const mainArea = page.locator('[data-testid="workspace"], .workspace, main, [role="main"]').first();
      if (await mainArea.isVisible({ timeout: 2000 })) {
        await mainArea.click();
        await page.waitForTimeout(1000);
      } else {
        // Last resort - click on body
        await page.click('body');
      }
    }
    await page.waitForTimeout(1000);

    // Step 3: Open command palette with CMD+K
    if (verbose) logger.debug('Opening command palette (CMD+K)...');
    await page.keyboard.press('Meta+k');
    await page.waitForTimeout(1500);

    // Step 4: Type the export command
    if (verbose) logger.debug('Typing "Export workspace as JSON"...');
    await page.keyboard.type('Export workspace as JSON', { delay: 30 });
    await page.waitForTimeout(2500); // Wait for search results to appear

    // Step 5: Select and execute the export option
    if (verbose) logger.debug('Selecting export option with arrow key...');

    // Set up download handler before clicking
    // Large workspaces can take 10-15+ minutes to prepare
    const downloadPromise = page.waitForEvent('download', { timeout: 900000 }); // 15 min for large exports

    // Use ArrowDown to select the first result, then Enter to execute
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    if (verbose) logger.debug('Pressing Enter to execute...');
    await page.keyboard.press('Enter');

    // Wait for download to start
    if (verbose) logger.debug('Waiting for download to start (this may take a while for large workspaces)...');
    const download = await downloadPromise;

    if (verbose) logger.debug('Download started, waiting for completion...');

    // Wait for the download to fully complete by getting the path
    // This blocks until the file is completely downloaded
    const tempPath = await download.path();
    if (!tempPath) {
      throw new Error('Download failed - no file path returned');
    }

    if (verbose) logger.debug(`Download complete: ${tempPath}`);

    // Generate filename with date
    const date = new Date().toISOString().split('T')[0];
    const suggestedFilename = download.suggestedFilename() || `workspace@${date}.json`;
    const filename = suggestedFilename.includes('@') ? suggestedFilename : `workspace@${date}.json`;
    const downloadPath = join(exportDir, filename);

    // Try to save the download. If it fails (because showSaveFilePicker override
    // already triggered the download directly), check if file exists in export dir.
    try {
      await download.saveAs(downloadPath);
      logger.info(`Export saved to: ${downloadPath}`);
    } catch (saveError) {
      // showSaveFilePicker override may have saved file directly with suggested name
      // Check if a file matching the pattern exists in export dir
      const fs = require('fs');
      const files = readdirSync(exportDir)
        .filter(f => f.endsWith('.json') && f.includes('@'))
        .map(f => ({ name: f, path: join(exportDir, f) }));

      // Find the most recent JSON file with actual content (size > 1MB for workspace exports)
      const recent = files
        .map(f => {
          const stats = fs.statSync(f.path);
          return { ...f, mtime: stats.mtime, size: stats.size };
        })
        .filter(f => f.size > 1000000) // Must be > 1MB
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0];

      if (recent && recent.mtime.getTime() > Date.now() - 300000) {
        // File was created in the last 5 minutes and has content - this is our export
        logger.info(`Export saved to: ${recent.path} (${Math.round(recent.size / 1024 / 1024)}MB)`);
        return recent.path;
      } else {
        throw saveError;
      }
    }
    return downloadPath;

  } catch (error) {
    if (error instanceof Error) {
      logger.error('Export failed', error);
    }
    return null;
  } finally {
    await context.close();
  }
}

async function interactiveLogin(): Promise<void> {
  logger.info('Opening Chromium for Tana login...');
  logger.info('');
  logger.info('IMPORTANT: This browser is dedicated for Tana automation.');
  logger.info('1. Log in to Tana (via Google or email)');
  logger.info('2. Once you see the Tana workspace, close the browser');
  logger.info('3. Your session will be saved for future automated exports');
  logger.info('');

  await ensureDirectories(DEFAULT_EXPORT_DIR);

  // Launch with flags that avoid Google's bot detection
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    // Remove automation indicators
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });

  const page = context.pages()[0] || await context.newPage();

  // Override navigator.webdriver to avoid detection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  await page.goto(TANA_APP_URL);

  // Wait for user to close the browser
  await new Promise<void>((resolve) => {
    context.on('close', () => resolve());
  });

  logger.info('Login session saved. You can now run exports automatically.');
}

// Main CLI
async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'export-dir': { type: 'string', short: 'o' },
      'headless': { type: 'boolean', default: true },
      'headed': { type: 'boolean' },
      'timeout': { type: 'string', short: 't' },
      'verbose': { type: 'boolean', short: 'v' },
      'help': { type: 'boolean', short: 'h' },
      'login': { type: 'boolean' },
      'nodeid': { type: 'string' },
      'workspace': { type: 'string', short: 'w' },
      'all': { type: 'boolean' },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Tana Export CLI - Automate JSON exports from Tana

Usage:
  supertag-export [options]
  supertag-export --login              Interactive login (first time setup)
  supertag-export --workspace personal Export specific workspace
  supertag-export --all                Export all enabled workspaces

Options:
  -w, --workspace <alias>      Workspace alias or nodeid
  --nodeid <id>                Direct workspace node ID (overrides --workspace)
  --all                        Export all enabled workspaces
  -o, --export-dir <path>      Export directory (default: ~/Documents/Tana-Export)
  --headless                   Run in headless mode (default)
  --headed                     Run with visible browser window
  -t, --timeout <ms>           Navigation timeout in ms (default: 60000)
  -v, --verbose                Verbose output
  --login                      Open browser for interactive login
  -h, --help                   Show this help

First-time setup:
  1. Run: supertag-export --login
  2. Log in to Tana in the browser window
  3. Close the browser when done
  4. Subsequent exports will use saved session

Workspace Configuration:
  tana workspace add Hf3Gx-AbJx84 --alias personal
  tana workspace set-default personal

Examples:
  supertag-export --login                    # First-time login
  supertag-export --workspace personal       # Export specific workspace
  supertag-export --all                      # Export all enabled workspaces
  supertag-export --nodeid Hf3Gx-AbJx84      # Export by direct nodeid
  supertag-export --headed -v                # Visible browser with verbose output
`);
    process.exit(0);
  }

  if (values.login) {
    await interactiveLogin();
    process.exit(0);
  }

  const verbose = values.verbose || false;

  // Handle --all option for batch export
  if (values.all) {
    const config = getConfig().getConfig();
    const workspaces = getEnabledWorkspaces(config);

    if (workspaces.length === 0) {
      logger.error('No enabled workspaces configured');
      logger.error('Add workspaces with: tana workspace add <nodeid> --alias <name>');
      process.exit(1);
    }

    logger.info(`Exporting ${workspaces.length} enabled workspace(s)...`);
    let successCount = 0;
    let failCount = 0;

    for (const ws of workspaces) {
      logger.info(`\n=== Workspace: ${ws.alias} (${ws.nodeid}) ===`);

      // Ensure export directory exists
      if (!existsSync(ws.exportDir)) {
        mkdirSync(ws.exportDir, { recursive: true });
      }

      const result = await performExport({
        exportDir: ws.exportDir,
        headless: !values.headed,
        timeout: parseInt(values.timeout || '60000', 10),
        verbose,
        nodeid: ws.nodeid,
      });

      if (result) {
        successCount++;
      } else {
        failCount++;
      }
    }

    logger.info(`\n=== Batch Export Complete ===`);
    logger.info(`Success: ${successCount}, Failed: ${failCount}`);
    process.exit(failCount > 0 ? 1 : 0);
  }

  // Resolve workspace from options
  let nodeid = values.nodeid;
  let exportDir = values['export-dir'];

  if (!nodeid) {
    const config = getConfig().getConfig();
    const ctx = resolveWorkspace(values.workspace, config);

    if (!ctx.nodeid) {
      logger.error('No workspace specified and no default workspace configured');
      logger.error('Use --nodeid <id>, --workspace <alias>, or configure a default workspace');
      process.exit(1);
    }

    nodeid = ctx.nodeid;
    exportDir = exportDir || ctx.exportDir;

    if (verbose) {
      logger.debug(`Resolved workspace: ${ctx.alias} (${ctx.nodeid})`);
      logger.debug(`Export directory: ${exportDir}`);
    }
  }

  // Run single export
  const result = await performExport({
    exportDir: exportDir || DEFAULT_EXPORT_DIR,
    headless: !values.headed,
    timeout: parseInt(values.timeout || '60000', 10),
    verbose,
    nodeid,
  });

  process.exit(result ? 0 : 1);
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
