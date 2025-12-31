/**
 * Tests for Database Resource Management
 *
 * Higher-order functions that wrap database operations with automatic resource cleanup.
 * Spec: 053-database-resource-management
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Database } from "bun:sqlite";

// Import the module under test
import {
  DatabaseNotFoundError,
  withDatabase,
  withTransaction,
  withQueryEngine,
  type DatabaseContext,
  type QueryContext,
  type DatabaseOptions,
} from "../../src/db/with-database";

// =============================================================================
// T-1.1: Types and Error Classes
// =============================================================================

describe("DatabaseNotFoundError", () => {
  it("should be an instance of Error", () => {
    const error = new DatabaseNotFoundError("/path/to/missing.db");
    expect(error).toBeInstanceOf(Error);
  });

  it("should have name 'DatabaseNotFoundError'", () => {
    const error = new DatabaseNotFoundError("/path/to/missing.db");
    expect(error.name).toBe("DatabaseNotFoundError");
  });

  it("should store dbPath property", () => {
    const dbPath = "/path/to/missing.db";
    const error = new DatabaseNotFoundError(dbPath);
    expect(error.dbPath).toBe(dbPath);
  });

  it("should have descriptive message", () => {
    const dbPath = "/path/to/missing.db";
    const error = new DatabaseNotFoundError(dbPath);
    expect(error.message).toContain("Database not found");
    expect(error.message).toContain(dbPath);
  });
});

describe("DatabaseContext type", () => {
  it("should be usable as a type", () => {
    // Type check - if this compiles, the type exists
    const ctx: DatabaseContext = {
      db: new Database(":memory:"),
      dbPath: ":memory:",
    };
    expect(ctx.db).toBeDefined();
    expect(ctx.dbPath).toBe(":memory:");
    ctx.db.close();
  });
});

describe("QueryContext type", () => {
  it("should extend DatabaseContext", () => {
    // QueryContext should have db, dbPath, and engine
    // This is a compile-time check
    const mockEngine = {} as any;
    const ctx: QueryContext = {
      db: new Database(":memory:"),
      dbPath: ":memory:",
      engine: mockEngine,
    };
    expect(ctx.db).toBeDefined();
    expect(ctx.dbPath).toBe(":memory:");
    expect(ctx.engine).toBe(mockEngine);
    ctx.db.close();
  });
});

describe("DatabaseOptions type", () => {
  it("should accept dbPath only", () => {
    const opts: DatabaseOptions = { dbPath: "/path/to/db" };
    expect(opts.dbPath).toBe("/path/to/db");
  });

  it("should accept optional readonly", () => {
    const opts: DatabaseOptions = { dbPath: "/path/to/db", readonly: true };
    expect(opts.readonly).toBe(true);
  });

  it("should accept optional requireExists", () => {
    const opts: DatabaseOptions = { dbPath: "/path/to/db", requireExists: false };
    expect(opts.requireExists).toBe(false);
  });
});

// =============================================================================
// T-1.2: withDatabase()
// =============================================================================

describe("withDatabase", () => {
  let testDir: string;
  let testDbPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `supertag-with-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");

    // Create a test database
    const db = new Database(testDbPath);
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    db.exec("INSERT INTO test (name) VALUES ('initial')");
    db.close();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should execute callback and close database", async () => {
    let dbFromCallback: Database | null = null;

    const result = await withDatabase({ dbPath: testDbPath }, (ctx) => {
      dbFromCallback = ctx.db;
      expect(ctx.dbPath).toBe(testDbPath);

      // Verify we can query
      const row = ctx.db.query("SELECT name FROM test").get() as { name: string };
      return row.name;
    });

    expect(result).toBe("initial");
    // Database should be closed after withDatabase completes
    expect(() => dbFromCallback!.query("SELECT 1")).toThrow();
  });

  it("should close database even on error", async () => {
    let dbFromCallback: Database | null = null;

    await expect(
      withDatabase({ dbPath: testDbPath }, (ctx) => {
        dbFromCallback = ctx.db;
        throw new Error("Intentional test error");
      })
    ).rejects.toThrow("Intentional test error");

    // Database should be closed after error
    expect(() => dbFromCallback!.query("SELECT 1")).toThrow();
  });

  it("should throw DatabaseNotFoundError for missing file", async () => {
    const missingPath = join(testDir, "nonexistent.db");

    await expect(
      withDatabase({ dbPath: missingPath }, (ctx) => {
        return ctx.db;
      })
    ).rejects.toThrow(DatabaseNotFoundError);
  });

  it("should allow missing database when requireExists=false", async () => {
    const newDbPath = join(testDir, "new.db");
    expect(existsSync(newDbPath)).toBe(false);

    const result = await withDatabase({ dbPath: newDbPath, requireExists: false }, (ctx) => {
      ctx.db.exec("CREATE TABLE test (id INTEGER)");
      return "created";
    });

    expect(result).toBe("created");
    expect(existsSync(newDbPath)).toBe(true);
  });

  it("should support readonly mode", async () => {
    const result = await withDatabase({ dbPath: testDbPath, readonly: true }, (ctx) => {
      // Read should work
      const row = ctx.db.query("SELECT name FROM test").get() as { name: string };
      return row.name;
    });

    expect(result).toBe("initial");
  });

  it("should reject writes in readonly mode", async () => {
    await expect(
      withDatabase({ dbPath: testDbPath, readonly: true }, (ctx) => {
        ctx.db.exec("INSERT INTO test (name) VALUES ('new')");
      })
    ).rejects.toThrow();
  });

  it("should support async callbacks", async () => {
    const result = await withDatabase({ dbPath: testDbPath }, async (ctx) => {
      // Simulate async operation
      await new Promise((resolve) => setTimeout(resolve, 10));
      const row = ctx.db.query("SELECT name FROM test").get() as { name: string };
      return row.name;
    });

    expect(result).toBe("initial");
  });
});

// =============================================================================
// T-1.3: withTransaction()
// =============================================================================

describe("withTransaction", () => {
  let testDir: string;
  let testDbPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `supertag-tx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "test.db");

    // Create a test database
    const db = new Database(testDbPath);
    db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    db.exec("INSERT INTO test (name) VALUES ('initial')");
    db.close();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should commit on success", async () => {
    await withTransaction({ dbPath: testDbPath }, (ctx) => {
      ctx.db.exec("INSERT INTO test (name) VALUES ('new')");
    });

    // Verify changes persisted
    const db = new Database(testDbPath);
    const rows = db.query("SELECT name FROM test ORDER BY name").all() as { name: string }[];
    db.close();

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual(["initial", "new"]);
  });

  it("should rollback on error", async () => {
    await expect(
      withTransaction({ dbPath: testDbPath }, (ctx) => {
        ctx.db.exec("INSERT INTO test (name) VALUES ('new')");
        throw new Error("Intentional rollback");
      })
    ).rejects.toThrow("Intentional rollback");

    // Verify changes were rolled back
    const db = new Database(testDbPath);
    const rows = db.query("SELECT name FROM test").all() as { name: string }[];
    db.close();

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("initial");
  });

  it("should close database after transaction", async () => {
    let dbFromCallback: Database | null = null;

    await withTransaction({ dbPath: testDbPath }, (ctx) => {
      dbFromCallback = ctx.db;
    });

    // Database should be closed
    expect(() => dbFromCallback!.query("SELECT 1")).toThrow();
  });

  it("should handle multiple operations in transaction", async () => {
    await withTransaction({ dbPath: testDbPath }, (ctx) => {
      ctx.db.exec("INSERT INTO test (name) VALUES ('second')");
      ctx.db.exec("INSERT INTO test (name) VALUES ('third')");
      ctx.db.exec("UPDATE test SET name = 'updated' WHERE name = 'initial'");
    });

    const db = new Database(testDbPath);
    const rows = db.query("SELECT name FROM test ORDER BY id").all() as { name: string }[];
    db.close();

    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toEqual(["updated", "second", "third"]);
  });

  it("should support async callbacks", async () => {
    await withTransaction({ dbPath: testDbPath }, async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      ctx.db.exec("INSERT INTO test (name) VALUES ('async')");
    });

    const db = new Database(testDbPath);
    const rows = db.query("SELECT name FROM test").all() as { name: string }[];
    db.close();

    expect(rows).toHaveLength(2);
  });
});

// =============================================================================
// T-2.1: withQueryEngine()
// =============================================================================

/**
 * Create a test database with the schema needed for TanaQueryEngine
 */
function createTestTanaDb(dbPath: string): void {
  const db = new Database(dbPath);

  // Minimal schema for TanaQueryEngine
  db.exec(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY,
      name TEXT,
      parent_id TEXT,
      node_type TEXT,
      created INTEGER,
      updated INTEGER,
      done_at INTEGER,
      raw_data TEXT
    )
  `);

  db.exec(`
    CREATE TABLE supertags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      tag_id TEXT NOT NULL,
      color TEXT
    )
  `);

  db.exec(`
    CREATE TABLE fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_value TEXT
    )
  `);

  db.exec(`
    CREATE TABLE "references" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL
    )
  `);

  // Insert test data
  db.exec("INSERT INTO nodes (id, name) VALUES ('node1', 'Test Node')");
  db.exec("INSERT INTO supertags (node_id, tag_name, tag_id) VALUES ('node1', 'test', 'tag1')");

  db.close();
}

describe("withQueryEngine", () => {
  let testDir: string;
  let testDbPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `supertag-qe-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
    testDbPath = join(testDir, "tana.db");
    createTestTanaDb(testDbPath);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should provide both db and engine in context", async () => {
    const result = await withQueryEngine({ dbPath: testDbPath }, (ctx) => {
      expect(ctx.db).toBeDefined();
      expect(ctx.engine).toBeDefined();
      expect(ctx.dbPath).toBe(testDbPath);
      return "success";
    });

    expect(result).toBe("success");
  });

  it("should close database after callback completes", async () => {
    let dbFromCallback: Database | null = null;

    await withQueryEngine({ dbPath: testDbPath }, (ctx) => {
      dbFromCallback = ctx.db;
    });

    // Database should be closed
    expect(() => dbFromCallback!.query("SELECT 1")).toThrow();
  });

  it("should close engine after callback completes", async () => {
    let engineFromCallback: any = null;

    await withQueryEngine({ dbPath: testDbPath }, (ctx) => {
      engineFromCallback = ctx.engine;
    });

    // Engine should be closed (attempting to query should fail)
    expect(() => engineFromCallback.getStatistics()).toThrow();
  });

  it("should allow querying through engine", async () => {
    const stats = await withQueryEngine({ dbPath: testDbPath }, (ctx) => {
      return ctx.engine.getStatistics();
    });

    expect(stats.totalNodes).toBe(1);
    expect(stats.totalSupertags).toBe(1);
  });

  it("should close on error", async () => {
    let dbFromCallback: Database | null = null;

    await expect(
      withQueryEngine({ dbPath: testDbPath }, (ctx) => {
        dbFromCallback = ctx.db;
        throw new Error("Intentional test error");
      })
    ).rejects.toThrow("Intentional test error");

    // Database should be closed after error
    expect(() => dbFromCallback!.query("SELECT 1")).toThrow();
  });

  it("should throw DatabaseNotFoundError for missing file", async () => {
    const missingPath = join(testDir, "nonexistent.db");

    await expect(
      withQueryEngine({ dbPath: missingPath }, (ctx) => {
        return ctx.engine;
      })
    ).rejects.toThrow(DatabaseNotFoundError);
  });

  it("should support readonly mode", async () => {
    const result = await withQueryEngine({ dbPath: testDbPath, readonly: true }, (ctx) => {
      return ctx.engine.getStatistics();
    });

    expect(result.totalNodes).toBe(1);
  });
});
