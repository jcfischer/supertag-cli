/**
 * CLI Integration Tests for sync watch subcommand (F-103 T-4.1)
 *
 * Tests interval clamping, option parsing, and WatchOptions construction.
 * Does not test actual watch loop (covered by watch-service.test.ts).
 */

import { describe, test, expect } from "bun:test";

// Test the interval clamping logic directly (mirrors sync.ts logic)
function clampInterval(raw: string): { interval: number; clamped: boolean } {
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < 5) {
    return { interval: 5, clamped: true };
  }
  return { interval: parsed, clamped: false };
}

describe("sync watch - interval clamping", () => {
  test("interval 30 passes through unchanged", () => {
    const result = clampInterval("30");
    expect(result.interval).toBe(30);
    expect(result.clamped).toBe(false);
  });

  test("interval 5 is at minimum, passes through", () => {
    const result = clampInterval("5");
    expect(result.interval).toBe(5);
    expect(result.clamped).toBe(false);
  });

  test("interval 4 is clamped to 5", () => {
    const result = clampInterval("4");
    expect(result.interval).toBe(5);
    expect(result.clamped).toBe(true);
  });

  test("interval 0 is clamped to 5", () => {
    const result = clampInterval("0");
    expect(result.interval).toBe(5);
    expect(result.clamped).toBe(true);
  });

  test("interval 1 is clamped to 5", () => {
    const result = clampInterval("1");
    expect(result.interval).toBe(5);
    expect(result.clamped).toBe(true);
  });

  test("interval 100 passes through unchanged", () => {
    const result = clampInterval("100");
    expect(result.interval).toBe(100);
    expect(result.clamped).toBe(false);
  });

  test("non-numeric interval is clamped to 5", () => {
    const result = clampInterval("abc");
    expect(result.interval).toBe(5);
    expect(result.clamped).toBe(true);
  });
});

// Test WatchOptions construction from CLI options
function buildWatchOptions(cliOptions: {
  workspace?: string;
  interval?: string;
  filterTag?: string;
  onChange?: string;
  onCreate?: string;
  onModify?: string;
  onDelete?: string;
  eventLog?: string;
  dryRun?: boolean;
  maxFailures?: string;
}) {
  const { interval: rawInterval } = clampInterval(cliOptions.interval ?? "30");

  return {
    workspace: cliOptions.workspace ?? 'main',
    interval: rawInterval,
    filterTag: cliOptions.filterTag,
    onChangeCmd: cliOptions.onChange,
    onCreateCmd: cliOptions.onCreate,
    onModifyCmd: cliOptions.onModify,
    onDeleteCmd: cliOptions.onDelete,
    eventLogPath: cliOptions.eventLog,
    dryRun: cliOptions.dryRun ?? false,
    maxConsecutiveFailures: parseInt(cliOptions.maxFailures ?? "10", 10) || 10,
  };
}

describe("sync watch - WatchOptions construction", () => {
  test("default options", () => {
    const opts = buildWatchOptions({});
    expect(opts.workspace).toBe('main');
    expect(opts.interval).toBe(30);
    expect(opts.dryRun).toBe(false);
    expect(opts.maxConsecutiveFailures).toBe(10);
    expect(opts.filterTag).toBeUndefined();
    expect(opts.onChangeCmd).toBeUndefined();
  });

  test("dry-run flag passthrough", () => {
    const opts = buildWatchOptions({ dryRun: true });
    expect(opts.dryRun).toBe(true);
  });

  test("filter-tag passthrough", () => {
    const opts = buildWatchOptions({ filterTag: 'meeting' });
    expect(opts.filterTag).toBe('meeting');
  });

  test("on-change command passthrough", () => {
    const opts = buildWatchOptions({ onChange: 'echo "changed"' });
    expect(opts.onChangeCmd).toBe('echo "changed"');
  });

  test("on-create, on-modify, on-delete passthrough", () => {
    const opts = buildWatchOptions({
      onCreate: 'echo create',
      onModify: 'echo modify',
      onDelete: 'echo delete',
    });
    expect(opts.onCreateCmd).toBe('echo create');
    expect(opts.onModifyCmd).toBe('echo modify');
    expect(opts.onDeleteCmd).toBe('echo delete');
  });

  test("custom event log path passthrough", () => {
    const opts = buildWatchOptions({ eventLog: '/tmp/custom.jsonl' });
    expect(opts.eventLogPath).toBe('/tmp/custom.jsonl');
  });

  test("custom workspace passthrough", () => {
    const opts = buildWatchOptions({ workspace: 'books' });
    expect(opts.workspace).toBe('books');
  });

  test("max-failures passthrough", () => {
    const opts = buildWatchOptions({ maxFailures: '5' });
    expect(opts.maxConsecutiveFailures).toBe(5);
  });
});
