/**
 * Authentication module for Tana API
 *
 * Supports two auth methods:
 * 1. Extract token from browser's IndexedDB (requires browser launch)
 * 2. Refresh token via Firebase API (no browser needed, much faster)
 *
 * Token caching: Tokens are cached to disk and refreshed automatically
 */

import { chromium } from 'playwright';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { BROWSER_DATA_DIR, TANA_CACHE_DIR } from '../../src/config/paths';
import { getConfig } from '../../src/config/manager';

// Tana's Firebase Web API key - required for token refresh
// This is a client-side key (visible in browser network requests), not a secret
// Can be extracted from Tana app network traffic if needed
// Reads from config.json (extracted during login process)
function getFirebaseApiKey(): string {
  return getConfig().getFirebaseApiKey() || process.env.TANA_FIREBASE_API_KEY || '';
}

const TOKEN_CACHE_FILE = join(TANA_CACHE_DIR, 'auth-token.json');

export interface FirebaseAuth {
  accessToken: string;
  refreshToken: string;
  expirationTime: number;
}

export type AuthMethod = 'cached' | 'refreshed' | 'browser';

export interface AuthResult {
  auth: FirebaseAuth;
  method: AuthMethod;
}

/** Optional logger for verbose output */
export type AuthLogger = (message: string) => void;

interface TokenRefreshResponse {
  access_token: string;
  expires_in: string;
  token_type: string;
  refresh_token: string;
  id_token: string;
  user_id: string;
  project_id: string;
}

/**
 * Get auth token - tries cached token first, then refreshes, then falls back to browser
 *
 * Priority:
 * 1. Cached token (if valid)
 * 2. Refresh cached token via API (if refresh token available)
 * 3. Extract from browser session (slowest, but works for initial auth)
 *
 * @param log - Optional logger for verbose output
 * @returns AuthResult with auth data and method used, or null if auth failed
 */
export async function getAuthToken(log?: AuthLogger): Promise<AuthResult | null> {
  // Try cached token first
  const cached = loadCachedToken();

  if (cached) {
    // Check if still valid (with 5 minute buffer)
    if (isTokenValid(cached, 5 * 60 * 1000)) {
      log?.('Using cached token');
      return { auth: cached, method: 'cached' };
    }

    // Try to refresh using the refresh token
    log?.('Cached token expired, refreshing via API...');
    try {
      const refreshed = await refreshAuthToken(cached.refreshToken);
      if (refreshed) {
        saveCachedToken(refreshed);
        log?.('Token refreshed via API');
        return { auth: refreshed, method: 'refreshed' };
      }
    } catch (error) {
      // Refresh failed, fall through to browser extraction
      log?.(`API refresh failed: ${error instanceof Error ? error.message : error}`);
    }
  } else {
    log?.('No cached token found');
  }

  // Fall back to browser extraction
  log?.('Extracting token from browser (this may take a few seconds)...');
  const browserAuth = await extractTokenFromBrowser();
  if (browserAuth) {
    saveCachedToken(browserAuth);
    log?.('Token extracted from browser and cached');
    return { auth: browserAuth, method: 'browser' };
  }
  return null;
}

/**
 * Refresh auth token using Firebase REST API (no browser needed)
 *
 * @see https://firebase.google.com/docs/reference/rest/auth#section-refresh-token
 */
export async function refreshAuthToken(refreshToken: string): Promise<FirebaseAuth | null> {
  const firebaseApiKey = getFirebaseApiKey();
  const tokenRefreshUrl = `https://securetoken.googleapis.com/v1/token?key=${firebaseApiKey}`;

  const response = await fetch(tokenRefreshUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${error}`);
  }

  const data: TokenRefreshResponse = await response.json();

  // Firebase returns expires_in as seconds string
  const expiresInMs = parseInt(data.expires_in) * 1000;

  return {
    accessToken: data.id_token, // Firebase returns id_token as the access token
    refreshToken: data.refresh_token,
    expirationTime: Date.now() + expiresInMs,
  };
}

/**
 * Extract Firebase auth token from browser's IndexedDB
 * This is the slowest method but works for initial authentication
 */
export async function extractTokenFromBrowser(): Promise<FirebaseAuth | null> {
  const context = await chromium.launchPersistentContext(BROWSER_DATA_DIR, {
    headless: true,
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://app.tana.inc', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const firebaseData = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const request = indexedDB.open('firebaseLocalStorageDb');
        request.onsuccess = () => {
          const db = request.result;
          try {
            const tx = db.transaction('firebaseLocalStorage', 'readonly');
            const store = tx.objectStore('firebaseLocalStorage');
            const getAllRequest = store.getAll();
            getAllRequest.onsuccess = () => {
              resolve(getAllRequest.result);
            };
            getAllRequest.onerror = () => resolve([]);
          } catch (e) {
            resolve([]);
          }
        };
        request.onerror = () => resolve([]);
      });
    });

    if (Array.isArray(firebaseData)) {
      for (const item of firebaseData) {
        if (item?.value?.stsTokenManager) {
          const { accessToken, refreshToken, expirationTime } = item.value.stsTokenManager;
          return { accessToken, refreshToken, expirationTime };
        }
      }
    }

    return null;
  } finally {
    await context.close();
  }
}

/**
 * Load cached token from disk
 */
function loadCachedToken(): FirebaseAuth | null {
  try {
    if (existsSync(TOKEN_CACHE_FILE)) {
      const data = JSON.parse(readFileSync(TOKEN_CACHE_FILE, 'utf-8'));
      if (data.accessToken && data.refreshToken && data.expirationTime) {
        return data;
      }
    }
  } catch {
    // Ignore cache read errors
  }
  return null;
}

/**
 * Save token to disk cache
 */
function saveCachedToken(auth: FirebaseAuth): void {
  try {
    const dir = dirname(TOKEN_CACHE_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
  } catch (error) {
    console.error('Failed to cache auth token:', error);
  }
}

/**
 * Clear cached token (useful for forcing re-authentication)
 */
export function clearCachedToken(): void {
  try {
    if (existsSync(TOKEN_CACHE_FILE)) {
      const { unlinkSync } = require('fs');
      unlinkSync(TOKEN_CACHE_FILE);
    }
  } catch {
    // Ignore
  }
}

/**
 * Check if token is still valid
 * @param auth - Firebase auth object
 * @param bufferMs - Buffer time in milliseconds (default: 60 seconds)
 */
export function isTokenValid(auth: FirebaseAuth, bufferMs: number = 60000): boolean {
  return auth.expirationTime > Date.now() + bufferMs;
}

/**
 * Get minutes until token expires
 */
export function getTokenExpiryMinutes(auth: FirebaseAuth): number {
  return Math.round((auth.expirationTime - Date.now()) / 1000 / 60);
}

/**
 * Force refresh the token (for testing or manual refresh)
 * @param log - Optional logger for verbose output
 */
export async function forceRefreshToken(log?: AuthLogger): Promise<AuthResult | null> {
  const cached = loadCachedToken();
  if (!cached?.refreshToken) {
    // No cached refresh token, must use browser
    log?.('No refresh token available, extracting from browser...');
    const browserAuth = await extractTokenFromBrowser();
    if (browserAuth) {
      saveCachedToken(browserAuth);
      log?.('Token extracted from browser and cached');
      return { auth: browserAuth, method: 'browser' };
    }
    return null;
  }

  log?.('Force refreshing token via API...');
  const refreshed = await refreshAuthToken(cached.refreshToken);
  if (refreshed) {
    saveCachedToken(refreshed);
    log?.('Token refreshed via API');
    return { auth: refreshed, method: 'refreshed' };
  }
  return null;
}
