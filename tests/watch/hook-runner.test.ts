/**
 * Hook Runner Tests (F-103 T-2.2)
 */

import { describe, test, expect } from "bun:test";
import { HookRunner } from "../../src/watch/hook-runner";
import type { ChangeEvent } from "../../src/watch/types";

function makeEvent(type: 'create' | 'modify' | 'delete' = 'create'): ChangeEvent {
  return {
    type,
    timestamp: '2026-02-27T10:00:00.000Z',
    pollCycle: 1,
    node: { id: 'n1', name: 'Test Node', tags: ['meeting'] },
  };
}

describe("HookRunner - successful execution", () => {
  test("successful command returns exit code 0", async () => {
    const runner = new HookRunner();
    const result = await runner.execute('echo "hello"', [makeEvent()]);

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.command).toBe('echo "hello"');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("failing command returns non-zero exit code", async () => {
    const runner = new HookRunner();
    const result = await runner.execute('exit 42', [makeEvent()]);

    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  test("never throws on error", async () => {
    const runner = new HookRunner();
    // This should not throw even if the command fails
    const result = await runner.execute('exit 1', [makeEvent()]);
    expect(result).toBeDefined();
  });
});

describe("HookRunner - stdin receives events", () => {
  test("stdin receives valid JSON array", async () => {
    const runner = new HookRunner();
    const events = [makeEvent('create'), makeEvent('modify')];

    // Use a command that reads stdin and counts events via jq (if available) or python
    // Use a simpler approach: read stdin and write to a temp file
    const tmpFile = `/tmp/supertag-hook-test-${Date.now()}.json`;
    const result = await runner.execute(`cat > ${tmpFile}`, events);

    expect(result.exitCode).toBe(0);

    // Verify the file contains valid JSON
    const content = await Bun.file(tmpFile).text();
    const parsed = JSON.parse(content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
    expect(parsed[0].type).toBe('create');
    expect(parsed[1].type).toBe('modify');

    // Cleanup
    await Bun.file(tmpFile).arrayBuffer(); // just to verify it exists
    const { execSync } = await import('child_process');
    try { execSync(`rm -f ${tmpFile}`); } catch { /* ignore */ }
  });
});

describe("HookRunner - environment variables", () => {
  test("SUPERTAG_WATCH_EVENT_COUNT is set", async () => {
    const runner = new HookRunner();
    const events = [makeEvent(), makeEvent(), makeEvent()];
    const tmpFile = `/tmp/supertag-hook-env-${Date.now()}.txt`;

    await runner.execute(`echo "$SUPERTAG_WATCH_EVENT_COUNT" > ${tmpFile}`, events);

    const content = (await Bun.file(tmpFile).text()).trim();
    expect(content).toBe('3');

    const { execSync } = await import('child_process');
    try { execSync(`rm -f ${tmpFile}`); } catch { /* ignore */ }
  });

  test("SUPERTAG_WATCH_EVENT_TYPE is set for single type", async () => {
    const runner = new HookRunner();
    const events = [makeEvent('create'), makeEvent('create')];
    const tmpFile = `/tmp/supertag-hook-env-type-${Date.now()}.txt`;

    await runner.execute(`echo "$SUPERTAG_WATCH_EVENT_TYPE" > ${tmpFile}`, events);

    const content = (await Bun.file(tmpFile).text()).trim();
    expect(content).toBe('create');

    const { execSync } = await import('child_process');
    try { execSync(`rm -f ${tmpFile}`); } catch { /* ignore */ }
  });

  test("SUPERTAG_WATCH_EVENT_TYPE is 'mixed' for multiple types", async () => {
    const runner = new HookRunner();
    const events = [makeEvent('create'), makeEvent('delete')];
    const tmpFile = `/tmp/supertag-hook-env-mixed-${Date.now()}.txt`;

    await runner.execute(`echo "$SUPERTAG_WATCH_EVENT_TYPE" > ${tmpFile}`, events);

    const content = (await Bun.file(tmpFile).text()).trim();
    expect(content).toBe('mixed');

    const { execSync } = await import('child_process');
    try { execSync(`rm -f ${tmpFile}`); } catch { /* ignore */ }
  });
});

describe("HookRunner - timeout", () => {
  test("timeout sets timedOut flag", async () => {
    const runner = new HookRunner({ timeoutMs: 100 });
    const result = await runner.execute('sleep 10', [makeEvent()]);

    expect(result.timedOut).toBe(true);
  }, 5000); // Allow up to 5s for this test

  test("timeout returns null exit code", async () => {
    const runner = new HookRunner({ timeoutMs: 100 });
    const result = await runner.execute('sleep 10', [makeEvent()]);

    expect(result.exitCode).toBeNull();
  }, 5000);
});
