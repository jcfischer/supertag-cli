/**
 * Update Command
 * Check for updates, download, and install new versions
 *
 * Spec: 058-version-update-checker
 */

import { Command } from "commander";
import { join } from "path";
import { existsSync } from "fs";
import {
  checkForUpdate,
  downloadUpdate,
  detectPlatform,
  installUpdate,
  shouldShowNotification,
  markNotificationShown,
} from "../services/update";
import { TANA_CACHE_DIR } from "../config/paths";
import { getConfig } from "../config/manager";
import { version } from "../../package.json";

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Check command - check for available updates
 */
async function checkCommand(options: { force?: boolean; json?: boolean }): Promise<void> {
  const result = await checkForUpdate({
    currentVersion: version,
    forceCheck: options.force ?? false,
  });

  if (!result) {
    if (options.json) {
      console.log(JSON.stringify({ error: "Unable to check for updates" }));
    } else {
      console.log("❌ Unable to check for updates");
    }
    process.exit(1);
  }

  if (options.json) {
    console.log(JSON.stringify({
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      updateAvailable: result.updateAvailable,
      changelog: result.changelog,
      downloadUrl: result.downloadUrl,
      downloadSize: result.downloadSize,
      releaseDate: result.releaseDate.toISOString(),
      fromCache: result.fromCache,
    }, null, 2));
    return;
  }

  console.log("");
  console.log(`  Current version: ${result.currentVersion}`);
  console.log(`  Latest version:  ${result.latestVersion}`);
  console.log("");

  if (result.updateAvailable) {
    console.log("  🎉 Update available!");
    console.log("");

    if (result.changelog.length > 0) {
      console.log("  Changes:");
      for (const change of result.changelog) {
        console.log(`    • ${change}`);
      }
      console.log("");
    }

    console.log(`  Download size: ${formatBytes(result.downloadSize)}`);
    console.log(`  Released: ${result.releaseDate.toLocaleDateString()}`);
    console.log("");
    console.log("  Run 'supertag update download' to download the update");
  } else {
    console.log("  ✅ You're running the latest version!");
  }
  console.log("");
}

/**
 * Download command - download update to local file
 */
async function downloadCommand(options: { output?: string }): Promise<void> {
  const result = await checkForUpdate({
    currentVersion: version,
    forceCheck: false,
  });

  if (!result) {
    console.log("❌ Unable to check for updates");
    process.exit(1);
  }

  if (!result.updateAvailable) {
    console.log("✅ Already running the latest version");
    return;
  }

  if (!result.downloadUrl) {
    const platform = detectPlatform();
    console.log(`❌ No download available for platform: ${platform}`);
    process.exit(1);
  }

  // Default output path
  const outputPath = options.output ?? join(TANA_CACHE_DIR, `supertag-${result.latestVersion}.zip`);

  console.log("");
  console.log(`  Downloading v${result.latestVersion}...`);
  console.log(`  Size: ${formatBytes(result.downloadSize)}`);
  console.log("");

  let lastPercent = 0;
  const downloadResult = await downloadUpdate({
    url: result.downloadUrl,
    outputPath,
    onProgress: (downloaded, total) => {
      if (total > 0) {
        const percent = Math.floor((downloaded / total) * 100);
        if (percent > lastPercent) {
          process.stdout.write(`\r  Progress: ${percent}%`);
          lastPercent = percent;
        }
      }
    },
  });

  console.log(""); // New line after progress

  if (!downloadResult.success) {
    console.log("");
    console.log(`  ❌ Download failed: ${downloadResult.error}`);
    process.exit(1);
  }

  console.log("");
  console.log("  ✅ Download complete!");
  console.log(`  Saved to: ${outputPath}`);
  console.log("");
  console.log("  Run 'supertag update install' to install the update.");
  console.log("");
}

/**
 * Install command - install a downloaded update
 */
async function installCommand(options: { file?: string; yes?: boolean }): Promise<void> {
  // Get current binary path - this is the path to the running executable
  // For compiled binaries, this is the binary itself
  // For development (running via bun), fall back to looking for supertag in cwd
  let binaryPath = process.execPath;

  // If running via Bun in development, try to find the actual binary
  if (binaryPath.includes("bun")) {
    // Try common locations
    const candidates = [
      join(process.cwd(), "supertag"),
      join(process.cwd(), "dist", "supertag"),
    ];
    const found = candidates.find(p => existsSync(p));
    if (found) {
      binaryPath = found;
    } else {
      console.log("");
      console.log("  ❌ Cannot determine binary path when running via Bun");
      console.log("  Please specify the target binary path or run the compiled binary.");
      console.log("");
      process.exit(1);
    }
  }

  // Default zip path
  const zipPath = options.file ?? (() => {
    // Try to find the latest downloaded update
    const result = checkForUpdate({
      currentVersion: version,
      forceCheck: false,
    });
    // For now, just check default location
    const latestZip = join(TANA_CACHE_DIR, "supertag-latest.zip");
    if (existsSync(latestZip)) {
      return latestZip;
    }
    return null;
  })();

  if (!zipPath) {
    console.log("");
    console.log("  ❌ No update file specified");
    console.log("");
    console.log("  Usage:");
    console.log("    supertag update install --file <path-to-zip>");
    console.log("");
    console.log("  Or first download an update:");
    console.log("    supertag update download");
    console.log("");
    process.exit(1);
  }

  if (!existsSync(zipPath)) {
    console.log("");
    console.log(`  ❌ Update file not found: ${zipPath}`);
    console.log("");
    process.exit(1);
  }

  // Show what we're about to do
  console.log("");
  console.log("  🔄 Installing update...");
  console.log("");
  console.log(`  Update file: ${zipPath}`);
  console.log(`  Binary path: ${binaryPath}`);
  console.log("");

  if (!options.yes) {
    console.log("  ⚠️  This will replace your current supertag binary.");
    console.log("  A backup will be created before installation.");
    console.log("");
    console.log("  Use --yes to skip this confirmation.");
    console.log("");
    process.exit(0);
  }

  // Perform installation
  const backupDir = join(TANA_CACHE_DIR, "backups");
  const result = await installUpdate({
    zipPath,
    binaryPath,
    backupDir,
  });

  if (!result.success) {
    console.log("");
    console.log(`  ❌ Installation failed: ${result.message}`);
    console.log("");
    process.exit(1);
  }

  console.log("");
  console.log("  ✅ Update installed successfully!");
  if (result.backupPath) {
    console.log(`  Backup saved to: ${result.backupPath}`);
  }
  console.log("");
  console.log("  Restart supertag to use the new version.");
  console.log("");
}

/**
 * Format a one-line update notification for display during CLI execution
 */
export function formatUpdateNotification(latestVersion: string): string {
  return `💡 Update available: v${latestVersion} - run 'supertag update check' for details`;
}

/**
 * Check if update checking is enabled based on config
 * Returns true if updateCheck is 'enabled' (default) or undefined
 * Returns false if updateCheck is 'disabled' or 'manual'
 */
export function isUpdateCheckEnabled(): boolean {
  const mode = getConfig().getUpdateCheckMode();
  return mode === "enabled";
}

/**
 * Check for updates passively (non-blocking, silent on errors)
 * Called on CLI startup to show a notification if update is available
 * Returns notification message or null if no notification needed
 */
export async function checkForUpdatePassive(): Promise<string | null> {
  try {
    // Check if update checking is enabled in config
    if (!isUpdateCheckEnabled()) {
      return null;
    }

    // First check if we should show a notification (uses cache)
    if (!shouldShowNotification({ currentVersion: version })) {
      return null;
    }

    // Try to get cached version info for the notification
    const result = await checkForUpdate({
      currentVersion: version,
      forceCheck: false, // Always use cache for passive checks
    });

    if (!result || !result.updateAvailable) {
      return null;
    }

    // Mark that we've shown the notification
    markNotificationShown();

    return formatUpdateNotification(result.latestVersion);
  } catch {
    // Fail silently - this is a passive check
    return null;
  }
}

/**
 * Create update command with subcommands
 */
export function createUpdateCommand(): Command {
  const update = new Command("update");
  update.description("Check for and download updates");

  // update check
  update
    .command("check")
    .description("Check for available updates")
    .option("-f, --force", "Bypass cache and check GitHub directly")
    .option("--json", "Output in JSON format")
    .action(async (opts: { force?: boolean; json?: boolean }) => {
      await checkCommand(opts);
    });

  // update download
  update
    .command("download")
    .description("Download the latest update")
    .option("-o, --output <path>", "Output path for downloaded file")
    .action(async (opts: { output?: string }) => {
      await downloadCommand(opts);
    });

  // update install
  update
    .command("install")
    .description("Install a downloaded update")
    .option("-f, --file <path>", "Path to downloaded update zip file")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts: { file?: string; yes?: boolean }) => {
      await installCommand(opts);
    });

  return update;
}
