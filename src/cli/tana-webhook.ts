#!/usr/bin/env bun

/**
 * Tana Webhook CLI - Start/stop webhook server for Tana integration
 *
 * Usage:
 *   tana-webhook start                    # Start webhook server
 *   tana-webhook start --port 3000        # Start on specific port
 *   tana-webhook start --daemon           # Start in background
 *   tana-webhook stop                     # Stop daemon server
 *   tana-webhook status                   # Check server status
 */

import { Command } from "commander";
import { TanaWebhookServer } from "../server/tana-webhook-server";
import { existsSync, writeFileSync, readFileSync, unlinkSync } from "fs";
import {
  getDatabasePath,
  PID_FILE,
  SERVER_CONFIG_FILE,
} from "../config/paths";
import { VERSION } from "../version";

const program = new Command();

// Default paths - use centralized XDG-compliant paths
const DEFAULT_DB_PATH = getDatabasePath();
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "localhost";

program
  .name("tana-webhook")
  .description("Webhook server for Tana integration")
  .version(VERSION);

program
  .command("start")
  .description("Start webhook server")
  .option("--port <n>", "Port to listen on", DEFAULT_PORT.toString())
  .option("--host <host>", "Host to bind to", DEFAULT_HOST)
  .option("--db-path <path>", "Database path", DEFAULT_DB_PATH)
  .option("--daemon", "Run in background", false)
  .action(async (options) => {
    const port = parseInt(options.port);
    const host = options.host;
    const dbPath = options.dbPath;

    // Check if database exists
    if (!existsSync(dbPath)) {
      console.error(`❌ Database not found: ${dbPath}`);
      console.error(`   Run 'tana-sync index' first`);
      process.exit(1);
    }

    // Check if already running
    if (existsSync(PID_FILE)) {
      const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
      try {
        process.kill(pid, 0); // Check if process exists
        console.error(`❌ Server already running (PID: ${pid})`);
        console.error(`   Run 'tana-webhook stop' first`);
        process.exit(1);
      } catch (e) {
        // Process doesn't exist, clean up stale PID file
        unlinkSync(PID_FILE);
      }
    }

    if (options.daemon) {
      // Save config for daemon mode
      writeFileSync(
        SERVER_CONFIG_FILE,
        JSON.stringify({ port, host, dbPath }, null, 2)
      );

      // Fork process and exit parent
      const { spawn } = await import("child_process");
      const child = spawn(
        process.execPath,
        [process.argv[1], "start", "--port", port.toString(), "--host", host, "--db-path", dbPath],
        {
          detached: true,
          stdio: "ignore",
        }
      );
      child.unref();

      // Write PID file
      writeFileSync(PID_FILE, child.pid!.toString());

      console.log(`✅ Webhook server started in background`);
      console.log(`   PID: ${child.pid}`);
      console.log(`   Address: http://${host}:${port}`);
      console.log(`   Run 'tana-webhook stop' to stop`);
      process.exit(0);
    }

    console.log(`🚀 Starting Tana webhook server...`);
    console.log(`   Host: ${host}`);
    console.log(`   Port: ${port}`);
    console.log(`   Database: ${dbPath}`);

    const server = new TanaWebhookServer({
      port,
      host,
      workspaces: new Map([['default', dbPath]]),
      defaultWorkspace: 'default',
    });

    try {
      await server.start();
      console.log(`✅ Server running at ${server.getAddress()}`);
      console.log(`\n📡 Available endpoints:`);
      console.log(`   GET  /health                 - Health check`);
      console.log(`   POST /search                 - Full-text search`);
      console.log(`   GET  /stats                  - Database statistics`);
      console.log(`   POST /tags                   - Top supertags`);
      console.log(`   POST /nodes                  - Find nodes`);
      console.log(`   POST /refs                   - Reference graph`);
      console.log(`\n   Press Ctrl+C to stop`);

      // Write PID file for non-daemon mode too
      writeFileSync(PID_FILE, process.pid.toString());

      // Handle shutdown
      const shutdown = async () => {
        console.log(`\n🛑 Shutting down...`);
        await server.stop();
        if (existsSync(PID_FILE)) {
          unlinkSync(PID_FILE);
        }
        if (existsSync(SERVER_CONFIG_FILE)) {
          unlinkSync(SERVER_CONFIG_FILE);
        }
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      // Keep process alive
      await new Promise(() => {});
    } catch (error) {
      console.error(`❌ Failed to start server:`, error);
      process.exit(1);
    }
  });

program
  .command("stop")
  .description("Stop daemon webhook server")
  .action(async () => {
    if (!existsSync(PID_FILE)) {
      console.error(`❌ Server is not running (no PID file found)`);
      process.exit(1);
    }

    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());

    try {
      process.kill(pid, "SIGTERM");
      console.log(`✅ Server stopped (PID: ${pid})`);

      // Clean up files
      unlinkSync(PID_FILE);
      if (existsSync(SERVER_CONFIG_FILE)) {
        unlinkSync(SERVER_CONFIG_FILE);
      }
    } catch (error) {
      console.error(`❌ Failed to stop server (PID: ${pid}):`, error);
      // Clean up stale files
      unlinkSync(PID_FILE);
      if (existsSync(SERVER_CONFIG_FILE)) {
        unlinkSync(SERVER_CONFIG_FILE);
      }
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Check server status")
  .action(async () => {
    if (!existsSync(PID_FILE)) {
      console.log(`❌ Server is not running`);
      process.exit(1);
    }

    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim());

    try {
      process.kill(pid, 0); // Check if process exists

      // Try to read config
      let config = null;
      if (existsSync(SERVER_CONFIG_FILE)) {
        config = JSON.parse(readFileSync(SERVER_CONFIG_FILE, "utf-8"));
      }

      console.log(`✅ Server is running`);
      console.log(`   PID: ${pid}`);
      if (config) {
        console.log(`   Address: http://${config.host}:${config.port}`);
        console.log(`   Database: ${config.dbPath}`);
      }

      // Try to fetch health endpoint
      if (config) {
        try {
          const response = await fetch(`http://${config.host}:${config.port}/health`);
          if (response.ok) {
            const data = await response.json() as { status?: string };
            console.log(`   Health: ${data.status ?? 'unknown'}`);
          }
        } catch (e) {
          console.log(`   Health: unreachable`);
        }
      }
    } catch (error) {
      console.log(`❌ Server is not running (stale PID file)`);
      // Clean up stale files
      unlinkSync(PID_FILE);
      if (existsSync(SERVER_CONFIG_FILE)) {
        unlinkSync(SERVER_CONFIG_FILE);
      }
      process.exit(1);
    }
  });

program.parse();
