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
 * Discover workspaces via CDP connection to a running browser (Playwright)
 *
 * Used when Playwright's launchPersistentContext fails (Windows).
 * Requires browser to be running with --remote-debugging-port.
 * NOTE: On Windows, prefer discoverWorkspacesViaRawCDP instead (bypasses Playwright).
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

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 30000 });

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
 * The workspace extraction script as a string for raw CDP Runtime.evaluate.
 * This is the same logic as extractWorkspacesScript but as an IIFE string.
 */
const extractWorkspacesScriptString = `
  (function() {
    var appState = window.appState;
    if (!appState || !appState.nodeSpace) return JSON.stringify([]);

    var results = [];
    var openFiles = appState.nodeSpace.openFiles;
    if (!openFiles) return JSON.stringify([]);

    var files = openFiles instanceof Set ? Array.from(openFiles) :
                openFiles instanceof Map ? Array.from(openFiles.values()) :
                Array.isArray(openFiles) ? openFiles : [];

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (!file || !file.fileId) continue;

      var nodeCountData = appState.nodeSpace.nodeCountsFor ? appState.nodeSpace.nodeCountsFor(file) : null;
      var nodeCount = nodeCountData ? (nodeCountData.unpacked + nodeCountData.untouched) : 0;

      var rawName = (file.homeNode && file.homeNode.name) || file.name || 'Unknown';
      var name = rawName.replace(/<[^>]*>/g, '').trim();

      results.push({
        rootFileId: file.fileId,
        homeNodeId: (file.homeNode && file.homeNode.id) || file.homeNodeId || '',
        name: name,
        nodeCount: nodeCount,
        isRootFile: file.isRootFile || false
      });
    }

    return JSON.stringify(results);
  })()
`;

/**
 * Discover workspaces via raw CDP protocol (no Playwright dependency).
 * Bypasses Playwright entirely - uses fetch() for page discovery and native WebSocket
 * for CDP commands. Required on Windows where Playwright fails in Bun-compiled binaries.
 *
 * @param options.port - CDP debug port (default: 19222)
 * @param options.timeout - How long to wait for app to initialize (default: 30000ms)
 * @param options.verbose - Log progress to console
 * @returns Array of discovered workspaces
 */
export async function discoverWorkspacesViaRawCDP(options?: {
  port?: number;
  timeout?: number;
  verbose?: boolean;
}): Promise<DiscoveredWorkspace[]> {
  const port = options?.port ?? 19222;
  const timeout = options?.timeout ?? 30000;
  const verbose = options?.verbose ?? false;

  if (verbose) console.log(`Connecting to browser on port ${port} (raw CDP)...`);

  // 1. Discover pages via CDP HTTP endpoint
  const pagesResponse = await fetch(`http://127.0.0.1:${port}/json`);
  if (!pagesResponse.ok) {
    throw new Error(`CDP endpoint returned status ${pagesResponse.status}`);
  }
  const pages = await pagesResponse.json() as Array<{ url: string; webSocketDebuggerUrl: string; title: string }>;

  // 2. Find the Tana page
  let tanaPage = pages.find(p => p.url?.includes('tana.inc'));

  if (!tanaPage) {
    // Navigate the first page to Tana if needed
    if (pages.length > 0 && pages[0].webSocketDebuggerUrl) {
      if (verbose) console.log('No Tana page found, navigating first tab to Tana...');
      tanaPage = pages[0];

      // Navigate via CDP
      const navigated = await cdpCommand(tanaPage.webSocketDebuggerUrl, 'Page.navigate', {
        url: 'https://app.tana.inc',
      });
      if (!navigated) {
        throw new Error('Could not navigate to Tana');
      }
    } else {
      throw new Error('No browser pages found. Make sure the browser is open.');
    }
  }

  if (!tanaPage?.webSocketDebuggerUrl) {
    throw new Error('No WebSocket debug URL available for the page');
  }

  // 3. Wait for app to initialize
  if (verbose) console.log(`Waiting for app to initialize (${timeout / 1000}s)...`);
  await new Promise(r => setTimeout(r, timeout));

  if (verbose) console.log('Extracting workspace data from appState...');

  // 4. Execute the extraction script via raw CDP
  const wsUrl = tanaPage.webSocketDebuggerUrl.replace('localhost', '127.0.0.1');
  const result = await new Promise<string | null>((resolve) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve(null);
    }, 30000);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: extractWorkspacesScriptString,
          returnByValue: true,
        },
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
        if (msg.id === 1) {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve(msg.result?.result?.value ?? null);
        }
      } catch {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(null);
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
  });

  if (!result) {
    throw new Error('Could not extract workspace data from browser');
  }

  const workspaces: DiscoveredWorkspace[] = typeof result === 'string' ? JSON.parse(result) : result;
  return sortAndLogWorkspaces(workspaces, verbose);
}

/**
 * Send a single CDP command via raw WebSocket and return the result
 */
async function cdpCommand(wsDebuggerUrl: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const wsUrl = wsDebuggerUrl.replace('localhost', '127.0.0.1');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      resolve(null);
    }, 15000);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : '');
        if (msg.id === 1) {
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve(msg.result ?? null);
        }
      } catch {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(null);
      }
    };

    ws.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
  });
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
