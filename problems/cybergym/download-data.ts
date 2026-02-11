#!/usr/bin/env npx tsx

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

interface Task {
  task_id: string;
  project_name: string;
  project_homepage: string;
  project_main_repo: string;
  project_language: string;
  vulnerability_description: string;
  task_difficulty: {
    level0: string[];
    level1: string[];
    level2: string[];
    level3: string[];
  };
}

async function downloadTaskData(taskId: string, outputDir: string): Promise<void> {
  const taskDir = path.join(outputDir, taskId);
  const dataDir = path.join(taskDir, "data");

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  console.log(`\n📦 Downloading data for arvo:${taskId}`);

  // Download repo-vul.tar.gz
  const repoUrl = `https://huggingface.co/datasets/sunblaze-ucb/cybergym/resolve/main/data/arvo/${taskId}/repo-vul.tar.gz`;
  const repoPath = path.join(dataDir, "repo-vul.tar.gz");

  try {
    console.log(`  📥 Downloading repo-vul.tar.gz...`);
    execSync(`curl -L -o "${repoPath}" "${repoUrl}"`, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stat = fs.statSync(repoPath);
    const sizeMB = (stat.size / 1024 / 1024).toFixed(2);
    console.log(`  ✓ Downloaded repo-vul.tar.gz (${sizeMB} MB)`);
  } catch (error) {
    console.error(`  ✗ Failed to download repo-vul.tar.gz`);
    throw error;
  }

  // Download description.txt
  const descUrl = `https://huggingface.co/datasets/sunblaze-ucb/cybergym/resolve/main/data/arvo/${taskId}/description.txt`;
  const descPath = path.join(dataDir, "description.txt");

  try {
    console.log(`  📥 Downloading description.txt...`);
    execSync(`curl -L -o "${descPath}" "${descUrl}"`, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log(`  ✓ Downloaded description.txt`);
  } catch (error) {
    console.error(`  ✗ Failed to download description.txt`);
    throw error;
  }
}

async function main() {
  const outputDir = path.resolve("problems/cybergym/arvos");
  const dTasksPath = path.join(outputDir, "problems.json");

  console.log("📊 CyberGym In-Distribution Data Downloader");
  console.log("===========================================");

  if (!fs.existsSync(dTasksPath)) {
    console.error(`\n❌ problems.json not found at ${dTasksPath}`);
    console.error("Please run download-d-tasks.ts first to select tasks.");
    process.exit(1);
  }

  const taskIds: string[] = JSON.parse(fs.readFileSync(dTasksPath, "utf-8"));
  console.log(`Found ${taskIds.length} in-distribution tasks to download`);

  let successCount = 0;
  let failCount = 0;
  let totalSize = 0;

  for (const taskId of taskIds) {
    try {
      await downloadTaskData(taskId, outputDir);

      // Calculate size
      const dataDir = path.join(outputDir, taskId, "data");
      const repoPath = path.join(dataDir, "repo-vul.tar.gz");
      if (fs.existsSync(repoPath)) {
        const stat = fs.statSync(repoPath);
        totalSize += stat.size;
      }

      successCount++;
    } catch (error) {
      console.error(`\n❌ Failed to download task ${taskId}`);
      failCount++;
    }
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ Download Summary:");
  console.log(`   Successful: ${successCount}/${taskIds.length} tasks`);
  console.log(`   Failed: ${failCount}/${taskIds.length} tasks`);
  console.log(`   Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   Average: ${(totalSize / successCount / 1024 / 1024).toFixed(2)} MB per task`);
  console.log("=".repeat(50));
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
