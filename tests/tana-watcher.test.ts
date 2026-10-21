/**
 * TDD Test Suite for Tana Export Filesystem Watcher
 *
 * RED phase: These tests will fail until we implement the watcher
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from "bun:test";
import { TanaExportWatcher } from "../src/monitors/tana-export-monitor";
import { TanaIndexer } from "../src/db/indexer";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { cleanupSqliteDatabase } from "./test-utils";

const TEST_EXPORT_DIR = "/tmp/supertag-test-exports";
const TEST_DB_PATH = "/tmp/supertag-test-watcher-index.db";
const TEST_EXPORT_FILE = join(TEST_EXPORT_DIR, "test-workspace@2025-11-30.json");

// Minimal valid Tana export for testing
const MINIMAL_EXPORT = JSON.stringify({
  formatVersion: 1,
  docs: [
    {
      id: "test_node_1",
      props: {
        created: Date.now(),
        name: "Test Node",
      },
      children: [],
    },
  ],
  editors: [],
  workspaces: {},
});

describe("TanaExportWatcher - Basic Setup (🔴 RED)", () => {
  beforeAll(() => {
    // Create test export directory
    try {
      mkdirSync(TEST_EXPORT_DIR, { recursive: true });
    } catch {}
  });

  afterAll(() => {
    // Clean up
    try {
      rmSync(TEST_EXPORT_DIR, { recursive: true, force: true });
    } catch {}
    cleanupSqliteDatabase(TEST_DB_PATH);
  });

  test("should create watcher instance with export directory", () => {
    const watcher = new TanaExportWatcher({
      exportDir: TEST_EXPORT_DIR,
      dbPath: TEST_DB_PATH,
    });

    expect(watcher).toBeDefined();
  });

  test("should validate export directory exists", () => {
    expect(() => {
      new TanaExportWatcher({
        exportDir: "./non-existent-directory",
        dbPath: TEST_DB_PATH,
      });
    }).toThrow();
  });
});

describe("TanaExportWatcher - Manual Index (🔴 RED)", () => {
  let watcher: TanaExportWatcher;

  beforeAll(() => {
    try {
      mkdirSync(TEST_EXPORT_DIR, { recursive: true });
    } catch {}
    try {
      cleanupSqliteDatabase(TEST_DB_PATH);
    } catch {}

    watcher = new TanaExportWatcher({
      exportDir: TEST_EXPORT_DIR,
      dbPath: TEST_DB_PATH,
    });
  });

  afterAll(() => {
    try {
      rmSync(TEST_EXPORT_DIR, { recursive: true, force: true });
    } catch {}
    try {
      cleanupSqliteDatabase(TEST_DB_PATH);
    } catch {}
  });

  test("should find latest export file in directory", () => {
    // Create multiple export files with timestamps
    writeFileSync(
      join(TEST_EXPORT_DIR, "workspace@2025-11-29.json"),
      MINIMAL_EXPORT
    );
    writeFileSync(
      join(TEST_EXPORT_DIR, "workspace@2025-11-30.json"),
      MINIMAL_EXPORT
    );
    writeFileSync(
      join(TEST_EXPORT_DIR, "workspace@2025-11-28.json"),
      MINIMAL_EXPORT
    );

    const latestFile = watcher.findLatestExport();

    expect(latestFile).toBeDefined();
    expect(latestFile).toContain("2025-11-30");
  });

  test("should manually trigger indexing of latest export", async () => {
    writeFileSync(TEST_EXPORT_FILE, MINIMAL_EXPORT);

    const result = await watcher.indexLatest();

    expect(result.success).toBe(true);
    expect(result.nodesIndexed).toBeGreaterThan(0);
    expect(result.exportFile).toContain("2025-11-30");
  });

  test("should return null when no exports found", () => {
    // Clean directory
    try {
      rmSync(TEST_EXPORT_DIR, { recursive: true, force: true });
      mkdirSync(TEST_EXPORT_DIR, { recursive: true });
    } catch {}

    const latestFile = watcher.findLatestExport();
    expect(latestFile).toBeNull();
  });
});

describe("TanaExportWatcher - Automatic Monitoring (🔴 RED)", () => {
  let watcher: TanaExportWatcher;

  beforeAll(() => {
    try {
      mkdirSync(TEST_EXPORT_DIR, { recursive: true });
    } catch {}
    try {
      cleanupSqliteDatabase(TEST_DB_PATH);
    } catch {}
  });

  afterEach(() => {
    // Stop watcher after each test
    if (watcher) {
      watcher.stop();
    }
  });

  afterAll(() => {
    try {
      rmSync(TEST_EXPORT_DIR, { recursive: true, force: true });
    } catch {}
    try {
      cleanupSqliteDatabase(TEST_DB_PATH);
    } catch {}
  });

  test("should start watching directory", () => {
    watcher = new TanaExportWatcher({
      exportDir: TEST_EXPORT_DIR,
      dbPath: TEST_DB_PATH,
    });

    watcher.start();
    expect(watcher.isWatching()).toBe(true);
  });

  test("should stop watching directory", () => {
    watcher = new TanaExportWatcher({
      exportDir: TEST_EXPORT_DIR,
      dbPath: TEST_DB_PATH,
    });

    watcher.start();
    watcher.stop();
    expect(watcher.isWatching()).toBe(false);
  });

  test("should detect new export file and auto-index", async () => {
    watcher = new TanaExportWatcher({
      exportDir: TEST_EXPORT_DIR,
      dbPath: TEST_DB_PATH,
    });

    // Use promise to wait for indexed event
    const indexedPromise = new Promise<string>((resolve) => {
      watcher.on("indexed", (result) => {
        resolve(result.exportFile);
      });
    });

    watcher.start();

    // Wait a bit for watcher to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create new export file
    writeFileSync(
      join(TEST_EXPORT_DIR, "workspace@2025-12-01.json"),
      MINIMAL_EXPORT
    );

    // Wait for indexing to complete (with timeout)
    const indexedFile = await Promise.race([
      indexedPromise,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout waiting for index")), 3000)
      ),
    ]);

    expect(indexedFile).toBeDefined();
    expect(indexedFile).toContain("2025-12-01");
  });

  test("should emit error events on indexing failure", async () => {
    watcher = new TanaExportWatcher({
      exportDir: TEST_EXPORT_DIR,
      dbPath: TEST_DB_PATH,
    });

    let errorReceived: Error | null = null;
    watcher.on("error", (error) => {
      errorReceived = error;
    });

    watcher.start();

    // Wait a bit for watcher to initialize
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Create invalid export file
    writeFileSync(
      join(TEST_EXPORT_DIR, "invalid@2025-12-01.json"),
      "invalid json content"
    );

    // Wait for error
    await new Promise((resolve) => setTimeout(resolve, 1000));

    expect(errorReceived).toBeDefined();
  });

  test("should debounce rapid file changes", async () => {
    watcher = new TanaExportWatcher({
      exportDir: TEST_EXPORT_DIR,
      dbPath: TEST_DB_PATH,
      debounceMs: 500, // 500ms debounce
    });

    let indexCount = 0;
    watcher.on("indexed", () => {
      indexCount++;
    });

    watcher.start();
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Rapidly write same file multiple times
    for (let i = 0; i < 5; i++) {
      writeFileSync(
        join(TEST_EXPORT_DIR, "rapid@2025-12-01.json"),
        MINIMAL_EXPORT
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Wait for debounce + indexing
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Should only index once despite 5 writes
    expect(indexCount).toBe(1);
  });
});

describe("TanaExportWatcher - Status and Statistics (🔴 RED)", () => {
  let watcher: TanaExportWatcher;

  beforeAll(() => {
    try {
      mkdirSync(TEST_EXPORT_DIR, { recursive: true });
    } catch {}
    try {
      cleanupSqliteDatabase(TEST_DB_PATH);
    } catch {}

    watcher = new TanaExportWatcher({
      exportDir: TEST_EXPORT_DIR,
      dbPath: TEST_DB_PATH,
    });
  });

  afterAll(() => {
    watcher.stop();
    try {
      rmSync(TEST_EXPORT_DIR, { recursive: true, force: true });
    } catch {}
    try {
      cleanupSqliteDatabase(TEST_DB_PATH);
    } catch {}
  });

  test("should return watcher status", () => {
    const status = watcher.getStatus();

    expect(status).toHaveProperty("watching");
    expect(status).toHaveProperty("exportDir");
    expect(status).toHaveProperty("dbPath");
    expect(status).toHaveProperty("latestExport");
    expect(status).toHaveProperty("lastIndexed");
  });

  test("should track last indexed timestamp", async () => {
    writeFileSync(TEST_EXPORT_FILE, MINIMAL_EXPORT);
    await watcher.indexLatest();

    const status = watcher.getStatus();
    expect(status.lastIndexed).toBeDefined();
    expect(typeof status.lastIndexed).toBe("number");
  });

  // #105: `sync status` runs in a fresh process, so the in-memory timestamp
  // is always null there; the persisted sync_metadata value must be used.
  test("should report last indexed from the database in a new watcher", async () => {
    writeFileSync(TEST_EXPORT_FILE, MINIMAL_EXPORT);
    await watcher.indexLatest();

    const fresh = new TanaExportWatcher({
      exportDir: TEST_EXPORT_DIR,
      dbPath: TEST_DB_PATH,
    });
    try {
      const status = fresh.getStatus();
      expect(typeof status.lastIndexed).toBe("number");
      expect(status.lastIndexed).toBeGreaterThan(0);
    } finally {
      fresh.close();
    }
  });

  test("should report never indexed for an empty database", () => {
    const emptyDb = `/tmp/supertag-test-watcher-empty-${Date.now()}.db`;
    const fresh = new TanaExportWatcher({
      exportDir: TEST_EXPORT_DIR,
      dbPath: emptyDb,
    });
    try {
      expect(fresh.getStatus().lastIndexed).toBeNull();
    } finally {
      fresh.close();
      cleanupSqliteDatabase(emptyDb);
    }
  });
});
