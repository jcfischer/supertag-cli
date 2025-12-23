/**
 * Tests for shared types used by CLI harmonization
 */

import { describe, it, expect } from "bun:test";
import type {
  StandardOptions,
  SearchType,
  StatsType,
} from "../src/types";

describe("StandardOptions interface", () => {
  it("should allow valid standard options", () => {
    const options: StandardOptions = {
      workspace: "main",
      limit: 10,
      json: true,
      show: true,
      depth: 2,
    };

    expect(options.workspace).toBe("main");
    expect(options.limit).toBe(10);
    expect(options.json).toBe(true);
    expect(options.show).toBe(true);
    expect(options.depth).toBe(2);
  });

  it("should allow partial options (all optional)", () => {
    const options: StandardOptions = {};
    expect(options.workspace).toBeUndefined();
    expect(options.limit).toBeUndefined();
  });

  it("should work with dbPath for backward compatibility", () => {
    const options: StandardOptions = {
      workspace: "test",
      dbPath: "/path/to/db",
    };
    expect(options.dbPath).toBe("/path/to/db");
  });
});

describe("SearchType", () => {
  it("should accept valid search types", () => {
    const fts: SearchType = "fts";
    const semantic: SearchType = "semantic";
    const tagged: SearchType = "tagged";

    expect(fts).toBe("fts");
    expect(semantic).toBe("semantic");
    expect(tagged).toBe("tagged");
  });
});

describe("StatsType", () => {
  it("should accept valid stats types", () => {
    const all: StatsType = "all";
    const db: StatsType = "db";
    const embed: StatsType = "embed";
    const filter: StatsType = "filter";

    expect(all).toBe("all");
    expect(db).toBe("db");
    expect(embed).toBe("embed");
    expect(filter).toBe("filter");
  });
});
