/**
 * Workspace Discovery Module
 *
 * Discovers all Tana workspaces by querying appState.nodeSpace.openFiles
 * in the browser context. This is more reliable than network traffic capture.
 */

import { chromium } from 'playwright';
import { BROWSER_DATA_DIR } from '../../src/config/paths';

export interface DiscoveredWorkspace {
  /** Root file ID for API calls */
  rootFileId: string;
  /** Home node ID (used in URLs) */
  homeNodeId: string;
  /** Workspace display name (HTML stripped) */
  name: string;
  /** Number of nodes in workspace */
  nodeCount: number;
  /** Whether this is the user's root/main workspace */
  isRootFile: boolean;
}

/**
 * The appState evaluation script - shared between standard and CDP discovery
 */
const extractWorkspacesScript = () => {
  // @ts-ignore - appState is a Tana global
  const appState = window.appState;
  if (!appState?.nodeSpace) return [];

  const results: Array<{
    rootFileId: string;
    homeNodeId: string;
    name: string;
    nodeCount: number;
    isRootFile: boolean;
  }> = [];

  // @ts-ignore
  const openFiles = appState.nodeSpace.openFiles;
  if (!openFiles) return [];

  // openFiles can be Set, Map, or Array
  const files = openFiles instanceof Set ? Array.from(openFiles) :
               openFiles instanceof Map ? Array.from(openFiles.values()) :
               Array.isArray(openFiles) ? openFiles : [];

  for (const file of files) {
    if (!file?.fileId) continue;

    // Get node count from nodeSpace
    // @ts-ignore
    const nodeCountData = appState.nodeSpace.nodeCountsFor?.(file);
    const nodeCount = nodeCountData ? (nodeCountData.unpacked + nodeCountData.untouched) : 0;

    // Strip HTML tags from name (e.g., "<i>🏠</i> Name" -> "🏠 Name")
    const rawName = file.homeNode?.name || file.name || 'Unknown';
    const name = rawName.replace(/<[^>]*>/g, '').trim();

    results.push({
      rootFileId: file.fileId,
      homeNodeId: file.homeNode?.id || file.homeNodeId || '',
      name,
      nodeCount,
      isRootFile: file.isRootFile || false,
    });
  }

  return results;
};

/**
 * Sort and log discovered workspaces
 */
function sortAndLogWorkspaces(workspaces: DiscoveredWorkspace[], verbose: boolean): DiscoveredWorkspace[] {
  workspaces.sort((a, b) => {
    if (a.isRootFile && !b.isRootFile) return -1;
    if (!a.isRootFile && b.isRootFile) return 1;
    return b.nodeCount - a.nodeCount;
  });

  if (verbose && workspaces.length > 0) {
    for (const ws of workspaces) {
      const marker = ws.isRootFile ? ' (root)' : '';
      console.log(`  Found: ${ws.name} (${ws.nodeCount.toLocaleString()} nodes)${marker}`);
    }
  }

  return workspaces;
}

/**
 * Discover all workspaces by querying Tana's appState
 *
 * @param options.timeout - How long to wait for app to initialize (default: 30000ms)
 * @param options.verbose - Log progress to console
 * @returns Array of discovered workspaces
 */
export async function discoverWorkspaces(options?: {
  timeout?: number;
  verbose?: boolean;
}): Promise<DiscoveredWorkspace[]> {
  const timeout = options?.timeout ?? 30000;
  const verbose = options?.verbose ?? false;

  if (verbose) console.log('Launching browser to discover workspaces...');

  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: true,
  });

  try {
    const page = context.pages()[0] || await context.newPage();

    if (verbose) console.log('Navigating to Tana...');
    await page.goto('https://app.tana.inc', { waitUntil: 'domcontentloaded', timeout: 60000 });

    if (verbose) console.log(`Waiting for app to initialize (${timeout / 1000}s)...`);
    await page.waitForTimeout(timeout);

    if (verbose) console.log('Extracting workspace data from appState...');

    const workspaces = await page.evaluate(extractWorkspacesScript);
    return sortAndLogWorkspaces(workspaces, verbose);

  } finally {
    await context.close();
  }
}

/**
 * Discover workspaces via CDP connection to a running browser
 *
 * Used when Playwright's launchPersistentContext fails (Windows).
 * Requires browser to be running with --remote-debugging-port.
 *
 * @param options.port - CDP debug port (default: 19222)
 * @param options.timeout - How long to wait for app to initialize (default: 30000ms)
 * @param options.verbose - Log progress to console
 * @returns Array of discovered workspaces
 */
export async function discoverWorkspacesViaCDP(options?: {
  port?: number;
  timeout?: number;
  verbose?: boolean;
}): Promise<DiscoveredWorkspace[]> {
  const port = options?.port ?? 19222;
  const timeout = options?.timeout ?? 30000;
  const verbose = options?.verbose ?? false;

  if (verbose) console.log(`Connecting to browser on port ${port}...`);

  const browser = await chromium.connectOverCDP(`http://localhost:${port}`, { timeout: 30000 });

  try {
    const contexts = browser.contexts();
    const pages = contexts[0]?.pages() || [];

    // Find a Tana page, or navigate the first page to Tana
    let page = pages.find(p => p.url().includes('tana.inc'));

    if (!page) {
      page = pages[0];
      if (!page) {
        throw new Error('No browser pages found. Make sure the browser is open.');
      }
      if (verbose) console.log('Navigating to Tana...');
      await page.goto('https://app.tana.inc', { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    if (verbose) console.log(`Waiting for app to initialize (${timeout / 1000}s)...`);
    await page.waitForTimeout(timeout);

    if (verbose) console.log('Extracting workspace data from appState...');

    const workspaces = await page.evaluate(extractWorkspacesScript);
    return sortAndLogWorkspaces(workspaces, verbose);

  } finally {
    // Disconnect without closing the user's browser
    browser.close().catch(() => {});
  }
}

/**
 * Format workspace size for display
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}
