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
} from "../services/update";
import { TANA_CACHE_DIR } from "../config/paths";
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
  console.log("  To install, extract the archive and replace the current binary.");
  console.log("");
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

  return update;
}
