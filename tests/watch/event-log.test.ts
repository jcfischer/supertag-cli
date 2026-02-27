/**
 * Event Logger Tests (F-103 T-2.1)
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { EventLogger } from "../../src/watch/event-log";
import type { ChangeEvent } from "../../src/watch/types";

const TEST_LOG_PATH = `/tmp/supertag-test-event-log-${Date.now()}.jsonl`;

function makeEvent(type: 'create' | 'modify' | 'delete', id = 'n1'): ChangeEvent {
  return {
    type,
    timestamp: '2026-02-27T10:00:00.000Z',
    pollCycle: 1,
    node: { id, name: `Node ${id}`, tags: ['meeting'] },
  };
}

beforeEach(() => {
  // Clean up before each test
  if (existsSync(TEST_LOG_PATH)) unlinkSync(TEST_LOG_PATH);
});

afterEach(() => {
  if (existsSync(TEST_LOG_PATH)) unlinkSync(TEST_LOG_PATH);
});

describe("EventLogger - basic operations", () => {
  test("empty array writes nothing", () => {
    const logger = new EventLogger(TEST_LOG_PATH);
    logger.append([]);
    expect(existsSync(TEST_LOG_PATH)).toBe(false);
  });

  test("writes single event as valid JSONL", () => {
    const logger = new EventLogger(TEST_LOG_PATH);
    const event = makeEvent('create');

    logger.append([event]);

    const content = readFileSync(TEST_LOG_PATH, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines.length).toBe(1);

    const parsed = JSON.parse(lines[0]);
    expect(parsed.type).toBe('create');
    expect(parsed.node.id).toBe('n1');
    expect(parsed.pollCycle).toBe(1);
  });

  test("writes multiple events as separate lines", () => {
    const logger = new EventLogger(TEST_LOG_PATH);
    const events = [
      makeEvent('create', 'n1'),
      makeEvent('modify', 'n2'),
      makeEvent('delete', 'n3'),
    ];

    logger.append(events);

    const content = readFileSync(TEST_LOG_PATH, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines.length).toBe(3);

    expect(JSON.parse(lines[0]).type).toBe('create');
    expect(JSON.parse(lines[1]).type).toBe('modify');
    expect(JSON.parse(lines[2]).type).toBe('delete');
  });

  test("appends to existing file", () => {
    const logger = new EventLogger(TEST_LOG_PATH);

    logger.append([makeEvent('create', 'n1')]);
    logger.append([makeEvent('modify', 'n2')]);

    const content = readFileSync(TEST_LOG_PATH, 'utf8');
    const lines = content.split('\n').filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).node.id).toBe('n1');
    expect(JSON.parse(lines[1]).node.id).toBe('n2');
  });

  test("all event fields are preserved in JSONL", () => {
    const logger = new EventLogger(TEST_LOG_PATH);
    const event: ChangeEvent = {
      type: 'modify',
      timestamp: '2026-02-27T10:00:00.000Z',
      pollCycle: 42,
      node: { id: 'abc123', name: 'Test Node', tags: ['meeting', 'project'] },
      changes: {
        name: { before: 'Old Name', after: 'Test Node' },
        tags: { added: ['project'], removed: [] },
      },
    };

    logger.append([event]);

    const content = readFileSync(TEST_LOG_PATH, 'utf8');
    const parsed = JSON.parse(content.trim());
    expect(parsed.type).toBe('modify');
    expect(parsed.pollCycle).toBe(42);
    expect(parsed.node.tags).toEqual(['meeting', 'project']);
    expect(parsed.changes.name.before).toBe('Old Name');
    expect(parsed.changes.tags.added).toContain('project');
  });
});

describe("EventLogger - path resolution", () => {
  test("defaultLogPath includes workspace alias", () => {
    const path = EventLogger.defaultLogPath('main');
    expect(path).toContain('main');
    expect(path).toContain('watch-events.jsonl');
  });

  test("defaultLogPath includes workspaces directory", () => {
    const path = EventLogger.defaultLogPath('books');
    expect(path).toContain('workspaces');
    expect(path).toContain('books');
  });
});
