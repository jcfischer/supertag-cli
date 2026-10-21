/**
 * supertag-mcp stdout protocol test (Issue #97)
 *
 * stdout is the JSON-RPC channel of the stdio transport. Any log line written
 * there corrupts the stream and the client drops the connection. Runs the real
 * server in an isolated HOME, calls tana_sync index, and checks every stdout
 * line is a JSON-RPC message.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TanaExportWatcher } from "../../src/monitors/tana-export-monitor";
import { createSimpleLogger } from "../../src/config/paths";
import { resetGlobalLogger } from "../../src/utils/logger";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const FIXTURE_PATH = join(REPO_ROOT, "tests", "fixtures", "sample-workspace.json");

describe("supertag-mcp stdout carries only JSON-RPC (#97)", () => {
  let home: string;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "supertag-mcp-stdout-"));
    const configDir = join(home, ".config", "supertag");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        defaultWorkspace: "main",
        workspaces: { main: { rootFileId: "_1liWSdbrpHY", enabled: true } },
      })
    );
    // Mirrors DEFAULT_EXPORT_DIR in src/config/paths.ts for the isolated HOME
    const exportRoot = process.platform === "darwin" || process.platform === "win32"
      ? join(home, "Documents", "Tana-Export")
      : join(home, ".local", "share", "supertag", "exports");
    const exportDir = join(exportRoot, "main");
    mkdirSync(exportDir, { recursive: true });
    copyFileSync(FIXTURE_PATH, join(exportDir, "_1liWSdbrpHY@2026-01-01.json"));
  });

  afterAll(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("keeps stdout parseable through a tana_sync index call", async () => {
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      XDG_DATA_HOME: join(home, ".local", "share"),
      XDG_CACHE_HOME: join(home, ".cache"),
      XDG_STATE_HOME: join(home, ".local", "state"),
    };
    const proc = Bun.spawn(["bun", "run", join(REPO_ROOT, "src", "mcp", "index.ts")], {
      cwd: home,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const send = (message: unknown) => {
      proc.stdin.write(JSON.stringify(message) + "\n");
      proc.stdin.flush();
    };

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "stdout-protocol-test", version: "1.0.0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "tana_sync", arguments: { action: "index" } },
    });

    // Read stdout until the tana_sync response arrives
    const lines: string[] = [];
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let syncResponse: { result?: { content?: Array<{ text: string }>; isError?: boolean } } | undefined;
    while (!syncResponse) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.trim() === "") continue;
        lines.push(line);
        try {
          const message = JSON.parse(line);
          if (message.id === 2) syncResponse = message;
        } catch {
          // Not JSON: recorded in lines and caught by the assertion below
        }
      }
    }

    proc.kill();
    await proc.exited;

    const nonJsonRpc = lines.filter((line) => {
      try {
        return JSON.parse(line).jsonrpc !== "2.0";
      } catch {
        return true;
      }
    });
    expect(nonJsonRpc).toEqual([]);
    expect(syncResponse?.result?.isError).toBeFalsy();
    const payload = JSON.parse(syncResponse!.result!.content![0].text);
    expect(payload.error).toBeUndefined();
    expect(payload.nodesIndexed).toBeGreaterThan(0);
  }, 60000);
});

describe("library fallback loggers stay off stdout (#97)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "supertag-fallback-logger-"));
    mkdirSync(join(dir, "export"));
    copyFileSync(FIXTURE_PATH, join(dir, "export", "_1liWSdbrpHY@2026-01-01.json"));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes nothing to stdout while indexing without a global logger", async () => {
    resetGlobalLogger();
    const stdoutWrites: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    const originalLog = console.log;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutWrites.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    console.log = (...args: unknown[]) => {
      stdoutWrites.push(args.map(String).join(" "));
    };

    try {
      const watcher = new TanaExportWatcher({
        exportDir: join(dir, "export"),
        dbPath: join(dir, "tana-index.db"),
      });
      try {
        const result = await watcher.indexLatest();
        expect(result.nodesIndexed).toBeGreaterThan(0);
      } finally {
        watcher.close();
      }
      createSimpleLogger("probe").info("simple logger info");
    } finally {
      process.stdout.write = originalWrite;
      console.log = originalLog;
    }

    expect(stdoutWrites).toEqual([]);
  }, 60000);
});
