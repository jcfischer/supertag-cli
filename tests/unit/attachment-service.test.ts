/**
 * Attachment Service Tests
 * TDD tests for the unified attachment service
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { Database } from "bun:sqlite";
import { AttachmentService } from "../../src/services/attachment-service";
import type { Attachment, AttachmentOptions } from "../../src/types/attachment";

const TEST_DIR = "/tmp/supertag-attachment-service-test";
const TEST_DB = join(TEST_DIR, "test.db");

describe("AttachmentService", () => {
  let db: Database;

  beforeAll(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }

    // Create test database with minimal schema
    db = new Database(TEST_DB);
    db.run(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        name TEXT,
        parent_id TEXT,
        created INTEGER
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS tag_applications (
        id INTEGER PRIMARY KEY,
        node_id TEXT,
        tag_name TEXT
      )
    `);

    // Insert test attachment nodes
    db.run(`INSERT INTO nodes (id, name, parent_id, created) VALUES (?, ?, ?, ?)`, [
      "attach1",
      "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2F2025-01-01T12%3A00%3A00.000Z-image.png?alt=media&token=xyz",
      "parent1",
      Date.now(),
    ]);
    db.run(`INSERT INTO nodes (id, name, parent_id) VALUES (?, ?, ?)`, [
      "attach2",
      "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2Fdocument.pdf?alt=media&token=abc",
      "parent2",
    ]);
    db.run(`INSERT INTO nodes (id, name, parent_id) VALUES (?, ?, ?)`, [
      "attach3",
      "https://firebasestorage.googleapis.com/v0/b/tagr-prod.appspot.com/o/notespace%2Fuser%40example.com%2Fuploads%2Faudio.m4a?alt=media&token=def",
      "parent1",
    ]);

    // Insert parent nodes
    db.run(`INSERT INTO nodes (id, name) VALUES (?, ?)`, ["parent1", "Parent Node 1"]);
    db.run(`INSERT INTO nodes (id, name) VALUES (?, ?)`, ["parent2", "Parent Node 2"]);

    // Insert tag applications
    db.run(`INSERT INTO tag_applications (node_id, tag_name) VALUES (?, ?)`, ["parent1", "#photo"]);
    db.run(`INSERT INTO tag_applications (node_id, tag_name) VALUES (?, ?)`, ["parent2", "#document"]);

    // Insert a non-attachment node
    db.run(`INSERT INTO nodes (id, name) VALUES (?, ?)`, ["regular", "Just a regular node"]);
  });

  afterAll(() => {
    db.close();
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("list", () => {
    test("lists all attachments from database", () => {
      const service = new AttachmentService(db);
      const attachments = service.list();

      expect(attachments.length).toBe(3);
      expect(attachments.every((a) => a.url.includes("firebasestorage"))).toBe(true);
    });

    test("filters attachments by extension", () => {
      const service = new AttachmentService(db);
      const attachments = service.list({ extensions: ["pdf"] });

      expect(attachments.length).toBe(1);
      expect(attachments[0].extension).toBe("pdf");
    });

    test("filters attachments by tag", () => {
      const service = new AttachmentService(db);
      const attachments = service.list({ tags: ["#photo"] });

      // parent1 has #photo tag, which has attach1 and attach3
      expect(attachments.length).toBe(2);
    });

    test("limits results", () => {
      const service = new AttachmentService(db);
      const attachments = service.list({ limit: 1 });

      expect(attachments.length).toBe(1);
    });
  });

  describe("get", () => {
    test("gets single attachment by nodeId", () => {
      const service = new AttachmentService(db);
      const attachment = service.get("attach1");

      expect(attachment).not.toBeNull();
      expect(attachment?.nodeId).toBe("attach1");
      expect(attachment?.extension).toBe("png");
    });

    test("returns null for non-existent nodeId", () => {
      const service = new AttachmentService(db);
      const attachment = service.get("nonexistent");

      expect(attachment).toBeNull();
    });

    test("returns null for non-attachment node", () => {
      const service = new AttachmentService(db);
      const attachment = service.get("regular");

      expect(attachment).toBeNull();
    });
  });

  describe("stats", () => {
    test("returns attachment statistics", () => {
      const service = new AttachmentService(db);
      const stats = service.stats();

      expect(stats.total).toBe(3);
      expect(stats.byExtension).toBeDefined();
      expect(stats.byExtension["png"]).toBe(1);
      expect(stats.byExtension["pdf"]).toBe(1);
      expect(stats.byExtension["m4a"]).toBe(1);
    });
  });
});
