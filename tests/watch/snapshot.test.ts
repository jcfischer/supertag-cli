/**
 * Snapshot Query Tests (F-103 T-1.2)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { takeSnapshot } from "../../src/watch/snapshot";
import { cleanupSqliteDatabase, getUniqueTestDbPath } from "../test-utils";

let dbPath: string;
let db: Database;

function setupDb(): void {
  dbPath = getUniqueTestDbPath("snapshot");
  db = new Database(dbPath);

  // Minimal schema needed for snapshot queries
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      updated INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tag_applications (
      node_id TEXT NOT NULL,
      tag_name TEXT NOT NULL,
      PRIMARY KEY (node_id, tag_name)
    );
  `);
}

function teardownDb(): void {
  db.close();
  cleanupSqliteDatabase(dbPath);
}

describe("takeSnapshot - empty database", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  test("returns empty map for empty database", () => {
    const snapshot = takeSnapshot(db);
    expect(snapshot.size).toBe(0);
  });

  test("returns empty map with tag filter on empty database", () => {
    const snapshot = takeSnapshot(db, "meeting");
    expect(snapshot.size).toBe(0);
  });
});

describe("takeSnapshot - nodes without tags", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  test("returns nodes with empty tags array", () => {
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'Node One', 1000)`);

    const snapshot = takeSnapshot(db);
    expect(snapshot.size).toBe(1);

    const node = snapshot.get('n1');
    expect(node).toBeDefined();
    expect(node!.id).toBe('n1');
    expect(node!.name).toBe('Node One');
    expect(node!.updatedAt).toBe(1000);
    expect(node!.tags).toEqual([]);
  });

  test("tag filter returns empty map when no nodes have the tag", () => {
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'Node One', 1000)`);

    const snapshot = takeSnapshot(db, "meeting");
    expect(snapshot.size).toBe(0);
  });
});

describe("takeSnapshot - nodes with tags", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  test("returns node with single tag", () => {
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'Meeting 1', 2000)`);
    db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('n1', 'meeting')`);

    const snapshot = takeSnapshot(db);
    const node = snapshot.get('n1');
    expect(node).toBeDefined();
    expect(node!.tags).toEqual(['meeting']);
  });

  test("returns node with multiple tags", () => {
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'Project Alpha', 3000)`);
    db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('n1', 'project')`);
    db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('n1', 'active')`);

    const snapshot = takeSnapshot(db);
    const node = snapshot.get('n1');
    expect(node).toBeDefined();
    expect(node!.tags.sort()).toEqual(['active', 'project']);
  });

  test("tag filter returns only matching nodes", () => {
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'Meeting 1', 1000)`);
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n2', 'Project 1', 2000)`);
    db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('n1', 'meeting')`);
    db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('n2', 'project')`);

    const snapshot = takeSnapshot(db, "meeting");
    expect(snapshot.size).toBe(1);
    expect(snapshot.has('n1')).toBe(true);
    expect(snapshot.has('n2')).toBe(false);
  });

  test("tag filter with multiple nodes having the tag", () => {
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'Meeting 1', 1000)`);
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n2', 'Meeting 2', 2000)`);
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n3', 'Project', 3000)`);
    db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('n1', 'meeting')`);
    db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('n2', 'meeting')`);
    db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('n3', 'project')`);

    const snapshot = takeSnapshot(db, "meeting");
    expect(snapshot.size).toBe(2);
    expect(snapshot.has('n1')).toBe(true);
    expect(snapshot.has('n2')).toBe(true);
    expect(snapshot.has('n3')).toBe(false);
  });

  test("filtered node includes all its tags (not just the filter tag)", () => {
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'Meeting+Project', 1000)`);
    db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('n1', 'meeting')`);
    db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('n1', 'project')`);

    const snapshot = takeSnapshot(db, "meeting");
    const node = snapshot.get('n1');
    expect(node).toBeDefined();
    expect(node!.tags.sort()).toEqual(['meeting', 'project']);
  });
});

describe("takeSnapshot - multiple nodes", () => {
  beforeEach(setupDb);
  afterEach(teardownDb);

  test("returns all nodes", () => {
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'Alpha', 100)`);
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n2', 'Beta', 200)`);
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n3', 'Gamma', 300)`);

    const snapshot = takeSnapshot(db);
    expect(snapshot.size).toBe(3);
    expect(snapshot.has('n1')).toBe(true);
    expect(snapshot.has('n2')).toBe(true);
    expect(snapshot.has('n3')).toBe(true);
  });
});
