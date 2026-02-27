/**
 * WatchService Tests (F-103 T-3.1)
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { WatchService, getBackoffMs } from "../../src/watch/watch-service";
import { EventLogger } from "../../src/watch/event-log";
import { HookRunner } from "../../src/watch/hook-runner";
import { StatusReporter } from "../../src/watch/status-reporter";
import type { WatchOptions } from "../../src/watch/types";
import { cleanupSqliteDatabase, getUniqueTestDbPath } from "../test-utils";

// =============================================================================
// Backoff calculation tests (pure logic)
// =============================================================================

describe("getBackoffMs", () => {
  test("1 failure = 5s", () => expect(getBackoffMs(1)).toBe(5_000));
  test("2 failures = 10s", () => expect(getBackoffMs(2)).toBe(10_000));
  test("3 failures = 20s", () => expect(getBackoffMs(3)).toBe(20_000));
  test("4 failures = 40s", () => expect(getBackoffMs(4)).toBe(40_000));
  test("5 failures = 60s (capped)", () => expect(getBackoffMs(5)).toBe(60_000));
  test("10 failures = 60s (capped)", () => expect(getBackoffMs(10)).toBe(60_000));
});

// =============================================================================
// WatchService unit tests with mocked dependencies
// =============================================================================

function makeOptions(overrides: Partial<WatchOptions> = {}): WatchOptions {
  return {
    workspace: 'main',
    interval: 30,
    dryRun: false,
    maxConsecutiveFailures: 10,
    ...overrides,
  };
}

function makeMockDeltaSync(syncFn?: () => Promise<void>) {
  return {
    sync: syncFn ?? (async () => {}),
    close: () => {},
  };
}

function makeSilentStatusReporter(): StatusReporter {
  const reporter = new StatusReporter(999_999);
  // Override to be silent
  reporter.printBanner = () => {};
  reporter.report = () => {};
  reporter.start = () => {};
  reporter.stop = () => {};
  return reporter;
}

function makeSilentEventLogger(): EventLogger {
  return {
    append: () => {},
  } as unknown as EventLogger;
}

let dbPath: string;
let db: Database;

beforeEach(() => {
  dbPath = getUniqueTestDbPath("watch-service");
  db = new Database(dbPath);
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
});

afterEach(() => {
  db.close();
  cleanupSqliteDatabase(dbPath);
});

describe("WatchService - getStatus", () => {
  test("initial state has correct defaults", () => {
    const service = new WatchService(makeOptions(), {
      deltaSyncService: makeMockDeltaSync(),
      db,
      statusReporter: makeSilentStatusReporter(),
      eventLogger: makeSilentEventLogger(),
    });

    const status = service.getStatus();
    expect(status.pollCount).toBe(0);
    expect(status.changesDetected).toBe(0);
    expect(status.hooksExecuted).toBe(0);
    expect(status.hooksFailed).toBe(0);
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastPollAt).toBeNull();
    expect(status.startedAt).toBeDefined();
  });
});

describe("WatchService - poll cycle (via runPollCycle through stop)", () => {
  test("detects created nodes across a sync", async () => {
    // Simulate: before sync = empty, after sync = 1 node
    let syncCallCount = 0;

    const deltaSyncService = {
      sync: async () => {
        syncCallCount++;
        // Add a node to the DB on the first sync
        db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'New Node', 1000)`);
      },
      close: () => {},
    };

    const capturedEvents: Array<{ type: string; id: string }> = [];
    const eventLogger = {
      append: (events: Parameters<EventLogger['append']>[0]) => {
        for (const e of events) {
          capturedEvents.push({ type: e.type, id: e.node.id });
        }
      },
    } as unknown as EventLogger;

    const service = new WatchService(makeOptions({ interval: 0 }), {
      deltaSyncService,
      db,
      statusReporter: makeSilentStatusReporter(),
      eventLogger,
    });

    // Manually trigger one cycle by calling the internal method via a trick:
    // We run start() but stop immediately after one cycle
    let cycleCount = 0;
    const origSync = deltaSyncService.sync.bind(deltaSyncService);
    deltaSyncService.sync = async () => {
      await origSync();
      cycleCount++;
      if (cycleCount >= 1) {
        // Stop after first cycle
        setTimeout(() => service.stop(), 0);
      }
    };

    await service.start();

    expect(syncCallCount).toBeGreaterThanOrEqual(1);
    expect(capturedEvents.length).toBeGreaterThanOrEqual(1);
    expect(capturedEvents[0].type).toBe('create');
    expect(capturedEvents[0].id).toBe('n1');
  }, 10000);

  test("dry-run does not call eventLogger.append", async () => {
    // Insert a node before sync so it will be "deleted" after (empty post-snapshot)
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'Test', 1000)`);

    let appendCalled = false;

    const deltaSyncService = {
      sync: async () => {
        // Remove the node (simulating delete)
        db.exec(`DELETE FROM nodes WHERE id = 'n1'`);
      },
      close: () => {},
    };

    const eventLogger = {
      append: () => {
        appendCalled = true;
      },
    } as unknown as EventLogger;

    let cycleCount = 0;
    const origSync = deltaSyncService.sync.bind(deltaSyncService);
    deltaSyncService.sync = async () => {
      await origSync();
      cycleCount++;
      if (cycleCount >= 1) {
        setTimeout(() => deltaSyncService.close(), 0);
      }
    };

    const service = new WatchService(makeOptions({ dryRun: true, interval: 0 }), {
      deltaSyncService,
      db,
      statusReporter: makeSilentStatusReporter(),
      eventLogger,
    });

    // Run one poll cycle manually
    (service as unknown as { runPollCycle: () => Promise<void> })['runPollCycle'] =
      service['runPollCycle'].bind(service);

    // Direct test of runPollCycle
    await (service as unknown as { runPollCycle: () => Promise<void> })['runPollCycle']();

    expect(appendCalled).toBe(false);
  });
});

describe("WatchService - hook dispatch", () => {
  test("onChangeCmd is called with all events", async () => {
    const calledWith: string[] = [];

    const hookRunner = {
      execute: async (cmd: string) => {
        calledWith.push(cmd);
        return { command: cmd, exitCode: 0, timedOut: false, durationMs: 1 };
      },
    } as unknown as HookRunner;

    const deltaSyncService = {
      sync: async () => {
        db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'New', 1000)`);
      },
      close: () => {},
    };

    const service = new WatchService(
      makeOptions({ onChangeCmd: 'echo "change"', interval: 0 }),
      {
        deltaSyncService,
        db,
        statusReporter: makeSilentStatusReporter(),
        eventLogger: makeSilentEventLogger(),
        hookRunner,
      }
    );

    await (service as unknown as { runPollCycle: () => Promise<void> })['runPollCycle']();

    expect(calledWith).toContain('echo "change"');
  });

  test("onCreateCmd is called only with create events", async () => {
    const capturedEventTypes: string[][] = [];

    const hookRunner = {
      execute: async (cmd: string, events: Parameters<HookRunner['execute']>[1]) => {
        capturedEventTypes.push(events.map(e => e.type));
        return { command: cmd, exitCode: 0, timedOut: false, durationMs: 1 };
      },
    } as unknown as HookRunner;

    const deltaSyncService = {
      sync: async () => {
        db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'New', 1000)`);
      },
      close: () => {},
    };

    const service = new WatchService(
      makeOptions({ onCreateCmd: 'echo "create"', interval: 0 }),
      {
        deltaSyncService,
        db,
        statusReporter: makeSilentStatusReporter(),
        eventLogger: makeSilentEventLogger(),
        hookRunner,
      }
    );

    await (service as unknown as { runPollCycle: () => Promise<void> })['runPollCycle']();

    expect(capturedEventTypes.length).toBe(1);
    expect(capturedEventTypes[0].every(t => t === 'create')).toBe(true);
  });

  test("hooks not dispatched in dry-run mode", async () => {
    let hookCalled = false;

    const hookRunner = {
      execute: async () => {
        hookCalled = true;
        return { command: '', exitCode: 0, timedOut: false, durationMs: 0 };
      },
    } as unknown as HookRunner;

    const deltaSyncService = {
      sync: async () => {
        db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('n1', 'New', 1000)`);
      },
      close: () => {},
    };

    const service = new WatchService(
      makeOptions({ dryRun: true, onChangeCmd: 'echo test', interval: 0 }),
      {
        deltaSyncService,
        db,
        statusReporter: makeSilentStatusReporter(),
        eventLogger: makeSilentEventLogger(),
        hookRunner,
      }
    );

    await (service as unknown as { runPollCycle: () => Promise<void> })['runPollCycle']();

    expect(hookCalled).toBe(false);
  });
});

describe("WatchService - failure handling", () => {
  test("consecutive failures are tracked", async () => {
    const deltaSyncService = {
      sync: async () => {
        throw new Error("API unavailable");
      },
      close: () => {},
    };

    const service = new WatchService(makeOptions(), {
      deltaSyncService,
      db,
      statusReporter: makeSilentStatusReporter(),
      eventLogger: makeSilentEventLogger(),
    });

    await (service as unknown as { runPollCycle: () => Promise<void> })['runPollCycle']();
    expect(service.getStatus().consecutiveFailures).toBe(1);

    await (service as unknown as { runPollCycle: () => Promise<void> })['runPollCycle']();
    expect(service.getStatus().consecutiveFailures).toBe(2);
  });

  test("consecutive failures reset on success", async () => {
    let callCount = 0;
    const deltaSyncService = {
      sync: async () => {
        callCount++;
        if (callCount <= 2) throw new Error("API unavailable");
        // 3rd call succeeds
      },
      close: () => {},
    };

    const service = new WatchService(makeOptions(), {
      deltaSyncService,
      db,
      statusReporter: makeSilentStatusReporter(),
      eventLogger: makeSilentEventLogger(),
    });

    const runCycle = (service as unknown as { runPollCycle: () => Promise<void> })['runPollCycle'].bind(service);

    await runCycle();
    await runCycle();
    expect(service.getStatus().consecutiveFailures).toBe(2);

    await runCycle();
    expect(service.getStatus().consecutiveFailures).toBe(0);
  });
});

describe("WatchService - filter tag", () => {
  test("filterTag limits snapshot to tagged nodes", async () => {
    // Nodes with tag "meeting" and without
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('meeting1', 'Meeting', 1000)`);
    db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('other1', 'Other', 1000)`);
    db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('meeting1', 'meeting')`);

    const capturedEvents: string[] = [];
    const eventLogger = {
      append: (events: Parameters<EventLogger['append']>[0]) => {
        for (const e of events) capturedEvents.push(e.node.id);
      },
    } as unknown as EventLogger;

    let syncCalled = false;
    const deltaSyncService = {
      sync: async () => {
        syncCalled = true;
        // Add a new meeting node
        db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('meeting2', 'Meeting 2', 2000)`);
        db.exec(`INSERT INTO tag_applications (node_id, tag_name) VALUES ('meeting2', 'meeting')`);
        // Add non-meeting node (should be ignored)
        db.exec(`INSERT INTO nodes (id, name, updated) VALUES ('other2', 'Other 2', 2000)`);
      },
      close: () => {},
    };

    const service = new WatchService(
      makeOptions({ filterTag: 'meeting', interval: 0 }),
      {
        deltaSyncService,
        db,
        statusReporter: makeSilentStatusReporter(),
        eventLogger,
      }
    );

    await (service as unknown as { runPollCycle: () => Promise<void> })['runPollCycle']();

    expect(syncCalled).toBe(true);
    // Only meeting2 should appear (meeting1 existed before, other2 is not a meeting)
    expect(capturedEvents).toContain('meeting2');
    expect(capturedEvents).not.toContain('other2');
  });
});
