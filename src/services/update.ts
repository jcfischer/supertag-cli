/**
 * Update Service
 * Core update service for version checking, caching, and downloads
 *
 * Spec: 058-version-update-checker
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, unlinkSync, chmodSync } from "fs";
import { dirname, join, basename } from "path";
import { TANA_CACHE_DIR } from "../config/paths";

// =============================================================================
// Types
// =============================================================================

/**
 * Supported platforms for binary downloads
 */
export type Platform = "macos-arm64" | "macos-x64" | "linux-x64" | "windows-x64";

/**
 * GitHub Release response (partial)
 */
export interface GitHubRelease {
  tag_name: string;          // "v1.3.2"
  name: string;              // "Release 1.3.2"
  published_at: string;      // ISO date
  body: string;              // Markdown changelog
  assets: GitHubAsset[];
}

/**
 * GitHub Release Asset
 */
export interface GitHubAsset {
  name: string;              // "supertag-cli-v1.3.2-macos-arm64.zip"
  browser_download_url: string;
  size: number;              // bytes
}

/**
 * Cached update information
 */
export interface UpdateCache {
  checkedAt: string;         // ISO timestamp
  notifiedAt: string | null; // Last time user was notified
  latestVersion: string;     // "1.3.2" (without 'v' prefix)
  currentVersion: string;    // Version at check time
  releaseDate: string;       // ISO timestamp
  changelog: string[];       // First 5 bullet points
  assets: {
    platform: Platform;
    url: string;
    size: number;
    filename: string;
  }[];
}

/**
 * Update check configuration
 */
export interface UpdateConfig {
  checkMode: "enabled" | "disabled" | "manual";
}

/**
 * Result from checkForUpdate
 */
export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  changelog: string[];
  downloadUrl: string;
  downloadSize: number;
  releaseDate: Date;
  fromCache: boolean;
}

/**
 * Result from installUpdate
 */
export interface InstallResult {
  success: boolean;
  backupPath?: string;
  installedVersion: string;
  message: string;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_CACHE_PATH = `${TANA_CACHE_DIR}/update-cache.json`;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// =============================================================================
// T-1.1: Type Validation
// =============================================================================

/**
 * Validate UpdateCache structure
 */
export function isValidUpdateCache(obj: unknown): obj is UpdateCache {
  if (!obj || typeof obj !== "object") return false;

  const cache = obj as Record<string, unknown>;

  return (
    typeof cache.checkedAt === "string" &&
    (cache.notifiedAt === null || typeof cache.notifiedAt === "string") &&
    typeof cache.latestVersion === "string" &&
    typeof cache.currentVersion === "string" &&
    typeof cache.releaseDate === "string" &&
    Array.isArray(cache.changelog) &&
    Array.isArray(cache.assets)
  );
}

// =============================================================================
// T-1.2: Version Comparison
// =============================================================================

/**
 * Compare two semantic versions
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  // Strip 'v' prefix if present
  const cleanA = a.replace(/^v/, "");
  const cleanB = b.replace(/^v/, "");

  // Split into components (version and pre-release)
  const [versionA, preA] = cleanA.split("-");
  const [versionB, preB] = cleanB.split("-");

  // Compare version numbers
  const partsA = versionA.split(".").map(Number);
  const partsB = versionB.split(".").map(Number);

  // Pad shorter version with zeros
  const maxLen = Math.max(partsA.length, partsB.length);
  while (partsA.length < maxLen) partsA.push(0);
  while (partsB.length < maxLen) partsB.push(0);

  // Compare each component
  for (let i = 0; i < maxLen; i++) {
    if (partsA[i] > partsB[i]) return 1;
    if (partsA[i] < partsB[i]) return -1;
  }

  // If version numbers are equal, compare pre-release
  // No pre-release > pre-release (1.0.0 > 1.0.0-alpha)
  if (!preA && preB) return 1;
  if (preA && !preB) return -1;
  if (preA && preB) {
    // Alphabetical comparison for pre-release tags
    if (preA < preB) return -1;
    if (preA > preB) return 1;
  }

  return 0;
}

// =============================================================================
// T-1.3: Platform Detection
// =============================================================================

/**
 * Detect current platform from process values
 */
export function detectPlatformFromValues(platform: string, arch: string): Platform {
  if (platform === "darwin" && arch === "arm64") return "macos-arm64";
  if (platform === "darwin" && arch === "x64") return "macos-x64";
  if (platform === "linux" && arch === "x64") return "linux-x64";
  if (platform === "win32" && arch === "x64") return "windows-x64";

  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

/**
 * Detect current platform
 */
export function detectPlatform(): Platform {
  return detectPlatformFromValues(process.platform, process.arch);
}

// =============================================================================
// T-1.4: Cache Utilities
// =============================================================================

/**
 * Get cached update info
 * @returns Cached data or null if not found/invalid
 */
export function getCache(cachePath: string = DEFAULT_CACHE_PATH): UpdateCache | null {
  if (!existsSync(cachePath)) {
    return null;
  }

  try {
    const content = readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(content);

    if (isValidUpdateCache(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save cache to file
 */
export function setCache(cache: UpdateCache, cachePath: string = DEFAULT_CACHE_PATH): void {
  const dir = dirname(cachePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

/**
 * Check if cache is stale (older than 24 hours)
 */
export function isCacheStale(checkedAt: string): boolean {
  const checkTime = new Date(checkedAt).getTime();
  const now = Date.now();

  return now - checkTime > CACHE_MAX_AGE_MS;
}

// =============================================================================
// T-2.1: GitHub API Integration
// =============================================================================

const GITHUB_API_BASE = "https://api.github.com";

/**
 * Fetch configuration
 */
export interface FetchReleaseOptions {
  owner: string;
  repo: string;
}

/**
 * Parsed release information (internal use)
 */
export interface ParsedRelease {
  version: string;
  releaseDate: string;
  changelog: string[];
  assets: {
    platform: Platform;
    url: string;
    size: number;
    filename: string;
  }[];
}

/**
 * Fetch latest release from GitHub API
 * @returns GitHubRelease or null if not found/error
 */
export async function fetchLatestRelease(
  options: FetchReleaseOptions
): Promise<GitHubRelease | null> {
  const url = `${GITHUB_API_BASE}/repos/${options.owner}/${options.repo}/releases/latest`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "supertag-cli",
      },
    });

    if (!response.ok) {
      // 404 = no releases, rate limit = 403
      return null;
    }

    const data = await response.json();
    return data as GitHubRelease;
  } catch {
    // Network error, timeout, etc.
    return null;
  }
}

/**
 * Extract platform from asset filename
 */
function extractPlatformFromFilename(filename: string): Platform | null {
  if (filename.includes("macos-arm64") || filename.includes("darwin-arm64")) {
    return "macos-arm64";
  }
  if (filename.includes("macos-x64") || filename.includes("darwin-x64")) {
    return "macos-x64";
  }
  if (filename.includes("linux-x64")) {
    return "linux-x64";
  }
  if (filename.includes("windows-x64") || filename.includes("win-x64")) {
    return "windows-x64";
  }
  return null;
}

/**
 * Extract changelog bullet points from markdown body
 */
function extractChangelog(body: string): string[] {
  if (!body) return [];

  const lines = body.split("\n");
  const bullets: string[] = [];

  for (const line of lines) {
    // Match markdown bullet points: - or *
    const match = line.match(/^[-*]\s+(.+)$/);
    if (match && bullets.length < 5) {
      bullets.push(match[1].trim());
    }
  }

  return bullets;
}

/**
 * Parse GitHub release into internal format
 */
export function parseGitHubRelease(release: GitHubRelease): ParsedRelease {
  // Strip 'v' prefix from tag
  const version = release.tag_name.replace(/^v/, "");

  // Extract changelog
  const changelog = extractChangelog(release.body);

  // Map assets to platforms
  const assets: ParsedRelease["assets"] = [];
  for (const asset of release.assets) {
    const platform = extractPlatformFromFilename(asset.name);
    if (platform) {
      assets.push({
        platform,
        url: asset.browser_download_url,
        size: asset.size,
        filename: asset.name,
      });
    }
  }

  return {
    version,
    releaseDate: release.published_at,
    changelog,
    assets,
  };
}

// =============================================================================
// T-2.2: checkForUpdate
// =============================================================================

const DEFAULT_OWNER = "jcfischer";
const DEFAULT_REPO = "supertag-cli";

/**
 * Options for checkForUpdate
 */
export interface CheckForUpdateOptions {
  currentVersion: string;
  cachePath?: string;
  forceCheck?: boolean;
  owner?: string;
  repo?: string;
}

/**
 * Check for available updates
 * Uses cache when available and fresh, otherwise fetches from GitHub
 */
export async function checkForUpdate(
  options: CheckForUpdateOptions
): Promise<UpdateCheckResult | null> {
  const {
    currentVersion,
    cachePath = DEFAULT_CACHE_PATH,
    forceCheck = false,
    owner = DEFAULT_OWNER,
    repo = DEFAULT_REPO,
  } = options;

  // Try cache first (unless forceCheck)
  if (!forceCheck) {
    const cache = getCache(cachePath);
    if (cache && !isCacheStale(cache.checkedAt)) {
      // Find asset for current platform
      const platform = detectPlatform();
      const asset = cache.assets.find((a) => a.platform === platform);

      return {
        currentVersion,
        latestVersion: cache.latestVersion,
        updateAvailable: compareVersions(cache.latestVersion, currentVersion) > 0,
        changelog: cache.changelog,
        downloadUrl: asset?.url || "",
        downloadSize: asset?.size || 0,
        releaseDate: new Date(cache.releaseDate),
        fromCache: true,
      };
    }
  }

  // Fetch from GitHub
  const release = await fetchLatestRelease({ owner, repo });
  if (!release) {
    return null;
  }

  // Parse release
  const parsed = parseGitHubRelease(release);

  // Find asset for current platform
  const platform = detectPlatform();
  const asset = parsed.assets.find((a) => a.platform === platform);

  // Update cache
  const cacheData: UpdateCache = {
    checkedAt: new Date().toISOString(),
    notifiedAt: null,
    latestVersion: parsed.version,
    currentVersion,
    releaseDate: parsed.releaseDate,
    changelog: parsed.changelog,
    assets: parsed.assets,
  };
  setCache(cacheData, cachePath);

  return {
    currentVersion,
    latestVersion: parsed.version,
    updateAvailable: compareVersions(parsed.version, currentVersion) > 0,
    changelog: parsed.changelog,
    downloadUrl: asset?.url || "",
    downloadSize: asset?.size || 0,
    releaseDate: new Date(parsed.releaseDate),
    fromCache: false,
  };
}

// =============================================================================
// T-2.3: downloadUpdate
// =============================================================================

/**
 * Options for downloadUpdate
 */
export interface DownloadUpdateOptions {
  url: string;
  outputPath: string;
  onProgress?: (downloaded: number, total: number) => void;
}

/**
 * Result of downloadUpdate
 */
export interface DownloadResult {
  success: boolean;
  bytesDownloaded: number;
  error?: string;
}

/**
 * Download update file with progress tracking
 */
export async function downloadUpdate(
  options: DownloadUpdateOptions
): Promise<DownloadResult> {
  const { url, outputPath, onProgress } = options;

  try {
    // Ensure output directory exists
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Fetch with streaming
    const response = await fetch(url, {
      headers: {
        "User-Agent": "supertag-cli",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        bytesDownloaded: 0,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    const reader = response.body?.getReader();

    if (!reader) {
      return {
        success: false,
        bytesDownloaded: 0,
        error: "Response body is null",
      };
    }

    // Read stream and write to file
    const chunks: Uint8Array[] = [];
    let downloaded = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      chunks.push(value);
      downloaded += value.length;

      if (onProgress) {
        onProgress(downloaded, contentLength);
      }
    }

    // Combine chunks and write
    const buffer = Buffer.concat(chunks);
    writeFileSync(outputPath, buffer);

    return {
      success: true,
      bytesDownloaded: downloaded,
    };
  } catch (error) {
    return {
      success: false,
      bytesDownloaded: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// =============================================================================
// T-3.1: installUpdate
// =============================================================================

/**
 * Options for installUpdate
 */
export interface InstallUpdateOptions {
  zipPath: string;
  binaryPath: string;
  backupDir: string;
}

/**
 * Create a test zip file for testing (exported for tests)
 * Uses native Bun.spawn to call the zip command
 */
export async function createTestZip(
  zipPath: string,
  binaryName: string,
  content: string
): Promise<void> {
  // Use a unique temp directory to avoid conflicts
  const timestamp = Date.now();
  const tempDir = join(dirname(zipPath), `temp-zip-${timestamp}`);
  mkdirSync(tempDir, { recursive: true });

  const tempBinaryPath = join(tempDir, binaryName);

  // Write the temp binary
  writeFileSync(tempBinaryPath, content, { mode: 0o755 });

  // Create zip using native command
  const proc = Bun.spawn(["zip", "-j", zipPath, tempBinaryPath], {
    cwd: tempDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;

  // Clean up temp directory
  Bun.spawn(["rm", "-rf", tempDir]);
}

/**
 * Install an update from a downloaded zip file
 * 1. Validate zip exists
 * 2. Backup current binary
 * 3. Extract and replace
 * 4. Set executable permissions
 * 5. Rollback on failure
 */
export async function installUpdate(
  options: InstallUpdateOptions
): Promise<InstallResult> {
  const { zipPath, binaryPath, backupDir } = options;

  // Validate zip exists
  if (!existsSync(zipPath)) {
    return {
      success: false,
      installedVersion: "",
      message: `Zip file not found: ${zipPath}`,
    };
  }

  // Generate backup path with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const binaryName = basename(binaryPath);
  const backupPath = join(backupDir, `${binaryName}.${timestamp}.backup`);

  // Ensure backup directory exists
  if (!existsSync(backupDir)) {
    mkdirSync(backupDir, { recursive: true });
  }

  // Backup current binary (if it exists)
  let hadBackup = false;
  if (existsSync(binaryPath)) {
    try {
      copyFileSync(binaryPath, backupPath);
      hadBackup = true;
    } catch (error) {
      return {
        success: false,
        installedVersion: "",
        message: `Failed to backup current binary: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  // Extract zip using unzip command
  const tempExtractDir = join(dirname(zipPath), `extract-${timestamp}`);
  mkdirSync(tempExtractDir, { recursive: true });

  try {
    const proc = Bun.spawn(["unzip", "-o", zipPath, "-d", tempExtractDir], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      // Rollback if we had a backup
      if (hadBackup && existsSync(backupPath)) {
        copyFileSync(backupPath, binaryPath);
      }

      // Clean up temp dir
      if (existsSync(tempExtractDir)) {
        Bun.spawn(["rm", "-rf", tempExtractDir]);
      }

      return {
        success: false,
        installedVersion: "",
        message: `Failed to extract zip file (exit code ${exitCode})`,
      };
    }

    // Find the extracted binary
    const extractedBinaryPath = join(tempExtractDir, binaryName);
    if (!existsSync(extractedBinaryPath)) {
      // Try to find any executable in the extracted dir
      const ls = Bun.spawn(["ls", tempExtractDir], { stdout: "pipe" });
      const output = await new Response(ls.stdout).text();
      const files = output.trim().split("\n").filter(Boolean);

      if (files.length === 0) {
        throw new Error("No files found in zip archive");
      }

      // Use the first file if binaryName not found
      const fallbackPath = join(tempExtractDir, files[0]);
      if (!existsSync(fallbackPath)) {
        throw new Error(`Binary not found in archive: ${binaryName}`);
      }

      // Always try to unlink target first - handles symlinks, sockets, and other
      // special files that copyFileSync cannot overwrite (ENOTSUP fix).
      // existsSync may return false for sockets, so always try unlink.
      try {
        unlinkSync(binaryPath);
      } catch {
        // Ignore errors - file might not exist
      }
      // Copy the fallback
      copyFileSync(fallbackPath, binaryPath);
    } else {
      // Always try to unlink target first - handles symlinks, sockets, and other
      // special files that copyFileSync cannot overwrite (ENOTSUP fix).
      // existsSync may return false for sockets, so always try unlink.
      try {
        unlinkSync(binaryPath);
      } catch {
        // Ignore errors - file might not exist
      }
      // Copy the extracted binary
      copyFileSync(extractedBinaryPath, binaryPath);
    }

    // Set executable permissions
    chmodSync(binaryPath, 0o755);

    // Clean up temp dir
    Bun.spawn(["rm", "-rf", tempExtractDir]);

    return {
      success: true,
      backupPath: hadBackup ? backupPath : undefined,
      installedVersion: "unknown", // Would need to run binary to get version
      message: "Update installed successfully",
    };
  } catch (error) {
    // Rollback on any error
    if (hadBackup && existsSync(backupPath)) {
      try {
        copyFileSync(backupPath, binaryPath);
      } catch {
        // Rollback failed - leave backup in place
      }
    }

    // Clean up temp dir
    if (existsSync(tempExtractDir)) {
      Bun.spawn(["rm", "-rf", tempExtractDir]);
    }

    return {
      success: false,
      installedVersion: "",
      message: `Installation failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// =============================================================================
// T-4.1: Passive Notification Logic
// =============================================================================

const NOTIFICATION_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Options for shouldShowNotification
 */
export interface NotificationOptions {
  currentVersion: string;
  cachePath?: string;
}

/**
 * Check if we should show an update notification
 * Returns true if:
 * - Cache exists and contains newer version
 * - User hasn't been notified in last 24 hours
 */
export function shouldShowNotification(options: NotificationOptions): boolean {
  const { currentVersion, cachePath = DEFAULT_CACHE_PATH } = options;

  // No cache = no notification
  const cache = getCache(cachePath);
  if (!cache) {
    return false;
  }

  // Check if update is available
  const updateAvailable = compareVersions(cache.latestVersion, currentVersion) > 0;
  if (!updateAvailable) {
    return false;
  }

  // Check notification cooldown
  if (cache.notifiedAt) {
    const notifiedTime = new Date(cache.notifiedAt).getTime();
    const now = Date.now();
    if (now - notifiedTime < NOTIFICATION_COOLDOWN_MS) {
      return false;
    }
  }

  return true;
}

/**
 * Mark that we've shown a notification to the user
 * Updates the cache with current timestamp
 */
export function markNotificationShown(cachePath: string = DEFAULT_CACHE_PATH): void {
  const cache = getCache(cachePath);
  if (!cache) {
    return;
  }

  cache.notifiedAt = new Date().toISOString();
  setCache(cache, cachePath);
}
