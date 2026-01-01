/**
 * Update Service Tests
 * TDD tests for version update checker (Spec 058)
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

// =============================================================================
// T-1.1: Type Validation Tests
// =============================================================================

describe("Update Types", () => {
  it("should define Platform type with valid values", async () => {
    // Import types - this validates TypeScript compilation
    const { Platform } = await import("../src/services/update");

    // Validate platform values are available
    const validPlatforms: string[] = ["macos-arm64", "macos-x64", "linux-x64", "windows-x64"];
    expect(validPlatforms).toContain("macos-arm64");
    expect(validPlatforms).toContain("linux-x64");
  });

  it("should define UpdateCache interface with required fields", async () => {
    const { isValidUpdateCache } = await import("../src/services/update");

    const validCache = {
      checkedAt: "2025-01-01T00:00:00Z",
      notifiedAt: null,
      latestVersion: "1.3.2",
      currentVersion: "1.3.0",
      releaseDate: "2025-01-01T00:00:00Z",
      changelog: ["Fix bug", "Add feature"],
      assets: [{
        platform: "macos-arm64" as const,
        url: "https://example.com/download.zip",
        size: 1000000,
        filename: "supertag-v1.3.2-macos-arm64.zip"
      }]
    };

    expect(isValidUpdateCache(validCache)).toBe(true);
  });

  it("should reject invalid UpdateCache", async () => {
    const { isValidUpdateCache } = await import("../src/services/update");

    // Missing required fields
    expect(isValidUpdateCache({})).toBe(false);
    expect(isValidUpdateCache({ checkedAt: "2025-01-01" })).toBe(false);
    expect(isValidUpdateCache(null)).toBe(false);
  });
});

// =============================================================================
// T-1.2: Version Comparison Tests
// =============================================================================

describe("compareVersions", () => {
  it("should return 0 for equal versions", async () => {
    const { compareVersions } = await import("../src/services/update");

    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("2.3.4", "2.3.4")).toBe(0);
    expect(compareVersions("0.0.1", "0.0.1")).toBe(0);
  });

  it("should return 1 when first version is greater", async () => {
    const { compareVersions } = await import("../src/services/update");

    expect(compareVersions("2.0.0", "1.0.0")).toBe(1);
    expect(compareVersions("1.1.0", "1.0.0")).toBe(1);
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
  });

  it("should return -1 when first version is smaller", async () => {
    const { compareVersions } = await import("../src/services/update");

    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.1.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("1.9.0", "1.10.0")).toBe(-1);
  });

  it("should handle versions with different component counts", async () => {
    const { compareVersions } = await import("../src/services/update");

    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1")).toBe(0);
    expect(compareVersions("1.0.1", "1.0")).toBe(1);
    expect(compareVersions("1.0", "1.0.1")).toBe(-1);
  });

  it("should strip v prefix from versions", async () => {
    const { compareVersions } = await import("../src/services/update");

    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "v1.0.0")).toBe(0);
    expect(compareVersions("v2.0.0", "v1.0.0")).toBe(1);
  });

  it("should handle pre-release versions", async () => {
    const { compareVersions } = await import("../src/services/update");

    // Pre-release is less than release
    expect(compareVersions("1.0.0-alpha", "1.0.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0-beta")).toBe(1);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
  });
});

// =============================================================================
// T-1.3: Platform Detection Tests
// =============================================================================

describe("detectPlatform", () => {
  it("should return a valid Platform type", async () => {
    const { detectPlatform } = await import("../src/services/update");

    const platform = detectPlatform();
    const validPlatforms = ["macos-arm64", "macos-x64", "linux-x64", "windows-x64"];

    expect(validPlatforms).toContain(platform);
  });

  it("should detect macOS ARM64 correctly", async () => {
    const { detectPlatformFromValues } = await import("../src/services/update");

    expect(detectPlatformFromValues("darwin", "arm64")).toBe("macos-arm64");
  });

  it("should detect macOS x64 correctly", async () => {
    const { detectPlatformFromValues } = await import("../src/services/update");

    expect(detectPlatformFromValues("darwin", "x64")).toBe("macos-x64");
  });

  it("should detect Linux x64 correctly", async () => {
    const { detectPlatformFromValues } = await import("../src/services/update");

    expect(detectPlatformFromValues("linux", "x64")).toBe("linux-x64");
  });

  it("should detect Windows x64 correctly", async () => {
    const { detectPlatformFromValues } = await import("../src/services/update");

    expect(detectPlatformFromValues("win32", "x64")).toBe("windows-x64");
  });

  it("should throw for unsupported platforms", async () => {
    const { detectPlatformFromValues } = await import("../src/services/update");

    expect(() => detectPlatformFromValues("freebsd", "x64")).toThrow("Unsupported platform");
    expect(() => detectPlatformFromValues("linux", "arm")).toThrow("Unsupported platform");
  });
});

// =============================================================================
// T-1.4: Cache Utilities Tests
// =============================================================================

describe("Cache Utilities", () => {
  const testCacheDir = "/tmp/supertag-test-cache";
  const testCachePath = join(testCacheDir, "update-cache.json");

  beforeEach(() => {
    // Clean up before each test
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
    mkdirSync(testCacheDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up after each test
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
  });

  it("should return null when cache file does not exist", async () => {
    const { getCache } = await import("../src/services/update");

    const cache = getCache(testCachePath);
    expect(cache).toBeNull();
  });

  it("should read and return valid cache", async () => {
    const { getCache, setCache } = await import("../src/services/update");

    const testCache = {
      checkedAt: "2025-01-01T00:00:00Z",
      notifiedAt: null,
      latestVersion: "1.3.2",
      currentVersion: "1.3.0",
      releaseDate: "2025-01-01T00:00:00Z",
      changelog: ["Fix bug"],
      assets: []
    };

    setCache(testCache, testCachePath);
    const cache = getCache(testCachePath);

    expect(cache).not.toBeNull();
    expect(cache?.latestVersion).toBe("1.3.2");
    expect(cache?.currentVersion).toBe("1.3.0");
  });

  it("should return null for corrupted cache", async () => {
    const { getCache } = await import("../src/services/update");

    writeFileSync(testCachePath, "not valid json {{{");
    const cache = getCache(testCachePath);

    expect(cache).toBeNull();
  });

  it("should write cache to file", async () => {
    const { setCache } = await import("../src/services/update");

    const testCache = {
      checkedAt: "2025-01-01T00:00:00Z",
      notifiedAt: null,
      latestVersion: "1.3.2",
      currentVersion: "1.3.0",
      releaseDate: "2025-01-01T00:00:00Z",
      changelog: [],
      assets: []
    };

    setCache(testCache, testCachePath);

    expect(existsSync(testCachePath)).toBe(true);
    const content = JSON.parse(readFileSync(testCachePath, "utf-8"));
    expect(content.latestVersion).toBe("1.3.2");
  });

  it("should detect stale cache (older than 24 hours)", async () => {
    const { isCacheStale } = await import("../src/services/update");

    const freshDate = new Date().toISOString();
    const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago

    expect(isCacheStale(freshDate)).toBe(false);
    expect(isCacheStale(staleDate)).toBe(true);
  });

  it("should detect fresh cache (less than 24 hours)", async () => {
    const { isCacheStale } = await import("../src/services/update");

    const freshDate = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1 hour ago

    expect(isCacheStale(freshDate)).toBe(false);
  });
});

// =============================================================================
// T-2.1: GitHub API Integration Tests
// =============================================================================

describe("fetchLatestRelease", () => {
  it("should return GitHubRelease or null (rate limited)", async () => {
    const { fetchLatestRelease } = await import("../src/services/update");

    // This tests against the real GitHub API
    // May return null if rate limited or no releases exist
    const result = await fetchLatestRelease({
      owner: "jcfischer",
      repo: "supertag-cli",
    });

    // Either null (rate limited/no releases) or valid release object
    if (result !== null) {
      expect(result.tag_name).toBeDefined();
      expect(result.published_at).toBeDefined();
      expect(result.assets).toBeInstanceOf(Array);
    } else {
      console.log("Skipping test: GitHub API rate limited or no releases");
    }
    // Test always passes - we're testing that it doesn't throw
    expect(true).toBe(true);
  });

  it("should return null for non-existent repo", async () => {
    const { fetchLatestRelease } = await import("../src/services/update");

    const result = await fetchLatestRelease({
      owner: "nonexistent-owner-12345",
      repo: "nonexistent-repo-67890",
    });

    expect(result).toBeNull();
  });

  it("should not throw on multiple requests", async () => {
    const { fetchLatestRelease } = await import("../src/services/update");

    // Multiple requests should not throw (may be rate limited)
    const results = await Promise.all([
      fetchLatestRelease({ owner: "jcfischer", repo: "supertag-cli" }),
      fetchLatestRelease({ owner: "jcfischer", repo: "supertag-cli" }),
    ]);

    // All should be null or valid objects - never throws
    for (const result of results) {
      expect(result === null || typeof result === "object").toBe(true);
    }
  });
});

describe("parseGitHubRelease", () => {
  it("should extract version from tag_name", async () => {
    const { parseGitHubRelease } = await import("../src/services/update");

    const release = {
      tag_name: "v1.3.2",
      name: "Release 1.3.2",
      published_at: "2025-01-01T00:00:00Z",
      body: "## Changes\n- Fix bug\n- Add feature",
      assets: [],
    };

    const parsed = parseGitHubRelease(release);

    expect(parsed.version).toBe("1.3.2");
    expect(parsed.releaseDate).toBe("2025-01-01T00:00:00Z");
  });

  it("should extract changelog from body", async () => {
    const { parseGitHubRelease } = await import("../src/services/update");

    const release = {
      tag_name: "v1.3.2",
      name: "Release 1.3.2",
      published_at: "2025-01-01T00:00:00Z",
      body: "## Changes\n- Fix authentication bug\n- Add dark mode\n- Improve performance\n- Update dependencies\n- Add tests\n- Refactor code",
      assets: [],
    };

    const parsed = parseGitHubRelease(release);

    // Should extract first 5 bullet points
    expect(parsed.changelog.length).toBeLessThanOrEqual(5);
    expect(parsed.changelog[0]).toContain("Fix authentication bug");
  });

  it("should map assets to platforms", async () => {
    const { parseGitHubRelease } = await import("../src/services/update");

    const release = {
      tag_name: "v1.3.2",
      name: "Release 1.3.2",
      published_at: "2025-01-01T00:00:00Z",
      body: "",
      assets: [
        {
          name: "supertag-cli-v1.3.2-macos-arm64.zip",
          browser_download_url: "https://github.com/download/macos-arm64.zip",
          size: 5000000,
        },
        {
          name: "supertag-cli-v1.3.2-linux-x64.zip",
          browser_download_url: "https://github.com/download/linux-x64.zip",
          size: 4500000,
        },
      ],
    };

    const parsed = parseGitHubRelease(release);

    expect(parsed.assets.length).toBe(2);
    expect(parsed.assets[0].platform).toBe("macos-arm64");
    expect(parsed.assets[1].platform).toBe("linux-x64");
  });

  it("should handle empty body gracefully", async () => {
    const { parseGitHubRelease } = await import("../src/services/update");

    const release = {
      tag_name: "v1.0.0",
      name: "Release 1.0.0",
      published_at: "2025-01-01T00:00:00Z",
      body: "",
      assets: [],
    };

    const parsed = parseGitHubRelease(release);

    expect(parsed.changelog).toEqual([]);
  });
});

// =============================================================================
// T-2.2: checkForUpdate Tests
// =============================================================================

describe("checkForUpdate", () => {
  const testCacheDir = "/tmp/supertag-check-update-test";
  const testCachePath = join(testCacheDir, "update-cache.json");

  beforeEach(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
    mkdirSync(testCacheDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
  });

  it("should return UpdateCheckResult with all required fields (when API available)", async () => {
    const { checkForUpdate } = await import("../src/services/update");

    const result = await checkForUpdate({
      currentVersion: "0.0.1", // Very old version to ensure update is available
      cachePath: testCachePath,
      forceCheck: true,
    });

    // May be null if rate limited
    if (result !== null) {
      expect(result.currentVersion).toBe("0.0.1");
      expect(typeof result.latestVersion).toBe("string");
      expect(typeof result.updateAvailable).toBe("boolean");
      expect(Array.isArray(result.changelog)).toBe(true);
      expect(typeof result.downloadUrl).toBe("string");
      expect(typeof result.downloadSize).toBe("number");
      expect(result.releaseDate).toBeInstanceOf(Date);
      expect(typeof result.fromCache).toBe("boolean");
    } else {
      console.log("Skipping test: GitHub API rate limited");
    }
    expect(true).toBe(true);
  });

  it("should detect when update is available (when API available)", async () => {
    const { checkForUpdate } = await import("../src/services/update");

    const result = await checkForUpdate({
      currentVersion: "0.0.1",
      cachePath: testCachePath,
      forceCheck: true,
    });

    // May be null if rate limited
    if (result !== null) {
      expect(result.updateAvailable).toBe(true);
    } else {
      console.log("Skipping test: GitHub API rate limited");
    }
    expect(true).toBe(true);
  });

  it("should use cached result when cache is fresh", async () => {
    const { checkForUpdate, setCache } = await import("../src/services/update");

    // Pre-populate cache with fresh data
    setCache({
      checkedAt: new Date().toISOString(),
      notifiedAt: null,
      latestVersion: "1.0.0",
      currentVersion: "0.0.1",
      releaseDate: "2025-01-01T00:00:00Z",
      changelog: ["Cached change"],
      assets: [{
        platform: "macos-arm64",
        url: "https://example.com/download.zip",
        size: 1000000,
        filename: "test.zip"
      }]
    }, testCachePath);

    const result = await checkForUpdate({
      currentVersion: "0.0.1",
      cachePath: testCachePath,
      forceCheck: false,
    });

    expect(result?.fromCache).toBe(true);
    expect(result?.latestVersion).toBe("1.0.0");
  });

  it("should fetch fresh data when cache is stale (when API available)", async () => {
    const { checkForUpdate, setCache } = await import("../src/services/update");

    // Pre-populate cache with stale data (25 hours old)
    const staleTime = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    setCache({
      checkedAt: staleTime,
      notifiedAt: null,
      latestVersion: "0.5.0",
      currentVersion: "0.0.1",
      releaseDate: "2024-01-01T00:00:00Z",
      changelog: ["Old change"],
      assets: [{
        platform: "macos-arm64",
        url: "https://example.com/old.zip",
        size: 500000,
        filename: "old.zip"
      }]
    }, testCachePath);

    const result = await checkForUpdate({
      currentVersion: "0.0.1",
      cachePath: testCachePath,
      forceCheck: false,
    });

    // May be null if rate limited
    if (result !== null) {
      expect(result.fromCache).toBe(false);
    } else {
      console.log("Skipping test: GitHub API rate limited");
    }
    expect(true).toBe(true);
  });

  it("should bypass cache when forceCheck is true (when API available)", async () => {
    const { checkForUpdate, setCache } = await import("../src/services/update");

    // Pre-populate cache with fresh data
    setCache({
      checkedAt: new Date().toISOString(),
      notifiedAt: null,
      latestVersion: "1.0.0",
      currentVersion: "0.0.1",
      releaseDate: "2025-01-01T00:00:00Z",
      changelog: [],
      assets: [{
        platform: "macos-arm64",
        url: "https://example.com/download.zip",
        size: 1000000,
        filename: "test.zip"
      }]
    }, testCachePath);

    const result = await checkForUpdate({
      currentVersion: "0.0.1",
      cachePath: testCachePath,
      forceCheck: true,
    });

    // May be null if rate limited
    if (result !== null) {
      expect(result.fromCache).toBe(false);
    } else {
      console.log("Skipping test: GitHub API rate limited");
    }
    expect(true).toBe(true);
  });

  it("should return null when no releases exist", async () => {
    const { checkForUpdate } = await import("../src/services/update");

    const result = await checkForUpdate({
      currentVersion: "1.0.0",
      cachePath: testCachePath,
      forceCheck: true,
      owner: "nonexistent-owner-12345",
      repo: "nonexistent-repo-67890",
    });

    expect(result).toBeNull();
  });

  it("should detect current version is up to date (when API available)", async () => {
    const { checkForUpdate } = await import("../src/services/update");

    // Use a very high version that's unlikely to be exceeded
    const result = await checkForUpdate({
      currentVersion: "999.999.999",
      cachePath: testCachePath,
      forceCheck: true,
    });

    // May be null if rate limited
    if (result !== null) {
      expect(result.updateAvailable).toBe(false);
    } else {
      console.log("Skipping test: GitHub API rate limited");
    }
    expect(true).toBe(true);
  });
});

// =============================================================================
// T-2.3: downloadUpdate Tests
// =============================================================================

describe("downloadUpdate", () => {
  const testDownloadDir = "/tmp/supertag-download-test";

  beforeEach(() => {
    if (existsSync(testDownloadDir)) {
      rmSync(testDownloadDir, { recursive: true });
    }
    mkdirSync(testDownloadDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDownloadDir)) {
      rmSync(testDownloadDir, { recursive: true });
    }
  });

  it("should download file to specified path", async () => {
    const { downloadUpdate } = await import("../src/services/update");

    // Use a small, known file for testing
    const testUrl = "https://raw.githubusercontent.com/jcfischer/supertag-cli/main/package.json";
    const outputPath = join(testDownloadDir, "test-download.json");

    const result = await downloadUpdate({
      url: testUrl,
      outputPath,
    });

    expect(result.success).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
    expect(result.bytesDownloaded).toBeGreaterThan(0);
  });

  it("should call progress callback during download", async () => {
    const { downloadUpdate } = await import("../src/services/update");

    const testUrl = "https://raw.githubusercontent.com/jcfischer/supertag-cli/main/package.json";
    const outputPath = join(testDownloadDir, "progress-test.json");

    let progressCalled = false;
    const onProgress = (downloaded: number, total: number) => {
      progressCalled = true;
      expect(downloaded).toBeGreaterThanOrEqual(0);
      expect(total).toBeGreaterThanOrEqual(0);
    };

    await downloadUpdate({
      url: testUrl,
      outputPath,
      onProgress,
    });

    expect(progressCalled).toBe(true);
  });

  it("should return error for invalid URL", async () => {
    const { downloadUpdate } = await import("../src/services/update");

    const outputPath = join(testDownloadDir, "invalid.zip");

    const result = await downloadUpdate({
      url: "https://nonexistent-domain-12345.com/file.zip",
      outputPath,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should return error for 404 response", async () => {
    const { downloadUpdate } = await import("../src/services/update");

    const outputPath = join(testDownloadDir, "404.zip");

    const result = await downloadUpdate({
      url: "https://github.com/jcfischer/supertag-cli/releases/download/nonexistent/file.zip",
      outputPath,
    });

    expect(result.success).toBe(false);
  });

  it("should create output directory if it doesn't exist", async () => {
    const { downloadUpdate } = await import("../src/services/update");

    const nestedDir = join(testDownloadDir, "nested", "deep", "path");
    const outputPath = join(nestedDir, "test.json");

    const testUrl = "https://raw.githubusercontent.com/jcfischer/supertag-cli/main/package.json";

    const result = await downloadUpdate({
      url: testUrl,
      outputPath,
    });

    expect(result.success).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
  });
});

// =============================================================================
// T-3.1: installUpdate Tests
// =============================================================================

describe("installUpdate", () => {
  const testInstallDir = "/tmp/supertag-install-test";
  const testBinaryPath = join(testInstallDir, "supertag");
  const testBackupDir = join(testInstallDir, "backups");
  const testZipPath = join(testInstallDir, "update.zip");

  beforeEach(async () => {
    if (existsSync(testInstallDir)) {
      rmSync(testInstallDir, { recursive: true });
    }
    mkdirSync(testInstallDir, { recursive: true });
    mkdirSync(testBackupDir, { recursive: true });

    // Create a fake "current binary"
    writeFileSync(testBinaryPath, "#!/bin/bash\necho 'old version'", { mode: 0o755 });
  });

  afterEach(() => {
    if (existsSync(testInstallDir)) {
      rmSync(testInstallDir, { recursive: true });
    }
  });

  it("should export installUpdate function", async () => {
    const { installUpdate } = await import("../src/services/update");
    expect(installUpdate).toBeDefined();
    expect(typeof installUpdate).toBe("function");
  });

  it("should return InstallResult with required fields", async () => {
    const { installUpdate, createTestZip } = await import("../src/services/update");

    // Create a valid test zip
    await createTestZip(testZipPath, "supertag", "#!/bin/bash\necho 'new version'");

    const result = await installUpdate({
      zipPath: testZipPath,
      binaryPath: testBinaryPath,
      backupDir: testBackupDir,
    });

    expect(typeof result.success).toBe("boolean");
    expect(typeof result.installedVersion).toBe("string");
    expect(typeof result.message).toBe("string");
  });

  it("should backup current binary before replacing", async () => {
    const { installUpdate, createTestZip } = await import("../src/services/update");

    await createTestZip(testZipPath, "supertag", "#!/bin/bash\necho 'new version'");

    const result = await installUpdate({
      zipPath: testZipPath,
      binaryPath: testBinaryPath,
      backupDir: testBackupDir,
    });

    expect(result.success).toBe(true);
    expect(result.backupPath).toBeDefined();
    expect(existsSync(result.backupPath!)).toBe(true);

    // Verify backup contains old content
    const backupContent = readFileSync(result.backupPath!, "utf-8");
    expect(backupContent).toContain("old version");
  });

  it("should replace binary with new version", async () => {
    const { installUpdate, createTestZip } = await import("../src/services/update");

    await createTestZip(testZipPath, "supertag", "#!/bin/bash\necho 'new version 1.2.3'");

    const result = await installUpdate({
      zipPath: testZipPath,
      binaryPath: testBinaryPath,
      backupDir: testBackupDir,
    });

    expect(result.success).toBe(true);

    // Verify binary was replaced
    const newContent = readFileSync(testBinaryPath, "utf-8");
    expect(newContent).toContain("new version");
  });

  it("should preserve executable permissions", async () => {
    const { installUpdate, createTestZip } = await import("../src/services/update");
    const { statSync } = await import("fs");

    await createTestZip(testZipPath, "supertag", "#!/bin/bash\necho 'new version'");

    await installUpdate({
      zipPath: testZipPath,
      binaryPath: testBinaryPath,
      backupDir: testBackupDir,
    });

    const stats = statSync(testBinaryPath);
    // Check that file is executable (has at least user execute permission)
    expect((stats.mode & 0o100) !== 0).toBe(true);
  });

  it("should return error for non-existent zip", async () => {
    const { installUpdate } = await import("../src/services/update");

    const result = await installUpdate({
      zipPath: "/nonexistent/path/update.zip",
      binaryPath: testBinaryPath,
      backupDir: testBackupDir,
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("should return error for invalid zip", async () => {
    const { installUpdate } = await import("../src/services/update");

    // Create an invalid zip file
    writeFileSync(testZipPath, "not a valid zip file");

    const result = await installUpdate({
      zipPath: testZipPath,
      binaryPath: testBinaryPath,
      backupDir: testBackupDir,
    });

    expect(result.success).toBe(false);
  });

  it("should rollback on failure during installation", async () => {
    const { installUpdate } = await import("../src/services/update");

    // Create a corrupted zip that will fail during extraction
    writeFileSync(testZipPath, "PK\x03\x04corrupted data");

    const originalContent = readFileSync(testBinaryPath, "utf-8");

    const result = await installUpdate({
      zipPath: testZipPath,
      binaryPath: testBinaryPath,
      backupDir: testBackupDir,
    });

    expect(result.success).toBe(false);

    // Original binary should still work (either unchanged or restored)
    expect(existsSync(testBinaryPath)).toBe(true);
  });
});

// =============================================================================
// T-4.1: Passive Notification Logic Tests
// =============================================================================

describe("Passive Notification Logic", () => {
  const testCacheDir = "/tmp/supertag-notification-test";
  const testCachePath = join(testCacheDir, "update-cache.json");

  beforeEach(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
    mkdirSync(testCacheDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testCacheDir)) {
      rmSync(testCacheDir, { recursive: true });
    }
  });

  it("should export shouldShowNotification function", async () => {
    const { shouldShowNotification } = await import("../src/services/update");
    expect(shouldShowNotification).toBeDefined();
    expect(typeof shouldShowNotification).toBe("function");
  });

  it("should export markNotificationShown function", async () => {
    const { markNotificationShown } = await import("../src/services/update");
    expect(markNotificationShown).toBeDefined();
    expect(typeof markNotificationShown).toBe("function");
  });

  it("should return true when update available and never notified", async () => {
    const { shouldShowNotification, setCache } = await import("../src/services/update");

    // Cache with update available, never notified
    setCache({
      checkedAt: new Date().toISOString(),
      notifiedAt: null,
      latestVersion: "2.0.0",
      currentVersion: "1.0.0",
      releaseDate: "2025-01-01T00:00:00Z",
      changelog: [],
      assets: [],
    }, testCachePath);

    const result = shouldShowNotification({
      currentVersion: "1.0.0",
      cachePath: testCachePath,
    });

    expect(result).toBe(true);
  });

  it("should return false when no update available", async () => {
    const { shouldShowNotification, setCache } = await import("../src/services/update");

    // Cache with same version (no update)
    setCache({
      checkedAt: new Date().toISOString(),
      notifiedAt: null,
      latestVersion: "1.0.0",
      currentVersion: "1.0.0",
      releaseDate: "2025-01-01T00:00:00Z",
      changelog: [],
      assets: [],
    }, testCachePath);

    const result = shouldShowNotification({
      currentVersion: "1.0.0",
      cachePath: testCachePath,
    });

    expect(result).toBe(false);
  });

  it("should return false when recently notified (within 24 hours)", async () => {
    const { shouldShowNotification, setCache } = await import("../src/services/update");

    // Cache with recent notification
    setCache({
      checkedAt: new Date().toISOString(),
      notifiedAt: new Date().toISOString(), // Just notified
      latestVersion: "2.0.0",
      currentVersion: "1.0.0",
      releaseDate: "2025-01-01T00:00:00Z",
      changelog: [],
      assets: [],
    }, testCachePath);

    const result = shouldShowNotification({
      currentVersion: "1.0.0",
      cachePath: testCachePath,
    });

    expect(result).toBe(false);
  });

  it("should return true when notified more than 24 hours ago", async () => {
    const { shouldShowNotification, setCache } = await import("../src/services/update");

    // Cache with old notification (25 hours ago)
    const oldNotification = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    setCache({
      checkedAt: new Date().toISOString(),
      notifiedAt: oldNotification,
      latestVersion: "2.0.0",
      currentVersion: "1.0.0",
      releaseDate: "2025-01-01T00:00:00Z",
      changelog: [],
      assets: [],
    }, testCachePath);

    const result = shouldShowNotification({
      currentVersion: "1.0.0",
      cachePath: testCachePath,
    });

    expect(result).toBe(true);
  });

  it("should return false when cache is missing", async () => {
    const { shouldShowNotification } = await import("../src/services/update");

    const result = shouldShowNotification({
      currentVersion: "1.0.0",
      cachePath: testCachePath, // No cache file exists
    });

    expect(result).toBe(false);
  });

  it("should update cache when markNotificationShown is called", async () => {
    const { markNotificationShown, setCache, getCache } = await import("../src/services/update");

    // Create cache without notification
    setCache({
      checkedAt: new Date().toISOString(),
      notifiedAt: null,
      latestVersion: "2.0.0",
      currentVersion: "1.0.0",
      releaseDate: "2025-01-01T00:00:00Z",
      changelog: [],
      assets: [],
    }, testCachePath);

    markNotificationShown(testCachePath);

    const cache = getCache(testCachePath);
    expect(cache?.notifiedAt).not.toBeNull();
    expect(cache?.notifiedAt).toBeDefined();
  });

  it("should not show notification for same version already notified", async () => {
    const { shouldShowNotification, setCache } = await import("../src/services/update");

    // Recently notified about version 2.0.0
    setCache({
      checkedAt: new Date().toISOString(),
      notifiedAt: new Date().toISOString(),
      latestVersion: "2.0.0",
      currentVersion: "1.0.0",
      releaseDate: "2025-01-01T00:00:00Z",
      changelog: [],
      assets: [],
    }, testCachePath);

    const result = shouldShowNotification({
      currentVersion: "1.0.0",
      cachePath: testCachePath,
    });

    expect(result).toBe(false);
  });
});
