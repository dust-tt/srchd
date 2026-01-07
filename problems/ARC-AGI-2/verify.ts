#!/usr/bin/env node

import { readFile } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

export interface VerifyResult {
  success: boolean;
  passed: number;
  total: number;
  percentage: number;
  error?: string;
}

export async function verifyOutputs(
  problemId: string,
  outputsPath: string,
  problemsBaseDir: string = process.cwd()
): Promise<VerifyResult> {
  try {
    // Check if problem exists
    const problemDir = path.join(problemsBaseDir, "generated", problemId);
    if (!existsSync(problemDir)) {
      return {
        success: false,
        passed: 0,
        total: 0,
        percentage: 0,
        error: `Problem ${problemId} not found in generated/`,
      };
    }

    const testJsonPath = path.join(problemDir, "test.json");
    if (!existsSync(testJsonPath)) {
      return {
        success: false,
        passed: 0,
        total: 0,
        percentage: 0,
        error: `test.json not found for problem ${problemId}`,
      };
    }

    // Check if outputs file exists
    if (!existsSync(outputsPath)) {
      return {
        success: false,
        passed: 0,
        total: 0,
        percentage: 0,
        error: `Outputs file not found: ${outputsPath}`,
      };
    }

    // Load files
    let expectedData, submittedData;

    try {
      expectedData = JSON.parse(await readFile(testJsonPath, "utf-8"));
    } catch (error: any) {
      return {
        success: false,
        passed: 0,
        total: 0,
        percentage: 0,
        error: `Error reading test.json: ${error.message}`,
      };
    }

    try {
      submittedData = JSON.parse(await readFile(outputsPath, "utf-8"));
    } catch (error: any) {
      return {
        success: false,
        passed: 0,
        total: 0,
        percentage: 0,
        error: `Error reading outputs file: ${error.message}`,
      };
    }

    // Validate structure
    if (!submittedData.test || !Array.isArray(submittedData.test)) {
      return {
        success: false,
        passed: 0,
        total: 0,
        percentage: 0,
        error: "Invalid outputs.json format - missing 'test' array",
      };
    }

    if (!expectedData.test || !Array.isArray(expectedData.test)) {
      return {
        success: false,
        passed: 0,
        total: 0,
        percentage: 0,
        error: "Invalid test.json format - missing 'test' array",
      };
    }

    const total = expectedData.test.length;

    // Check count
    if (submittedData.test.length !== total) {
      return {
        success: false,
        passed: 0,
        total,
        percentage: 0,
        error: `Wrong number of outputs: expected ${total}, got ${submittedData.test.length}`,
      };
    }

    // Compare each test case
    let passed = 0;

    for (let i = 0; i < total; i++) {
      const expected = expectedData.test[i].output;
      const submitted = submittedData.test[i]?.output;

      if (!submitted) {
        continue;
      }

      if (JSON.stringify(expected) === JSON.stringify(submitted)) {
        passed++;
      }
    }

    const percentage = Math.round((passed / total) * 100);

    return {
      success: passed === total,
      passed,
      total,
      percentage,
    };
  } catch (error: any) {
    return {
      success: false,
      passed: 0,
      total: 0,
      percentage: 0,
      error: error.message || String(error),
    };
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error("Usage: npx tsx verify.ts <problem-id> <outputs.json>");
    console.error("\nExample: npx tsx verify.ts 1ae2feb7 my-solution.json");
    process.exit(1);
  }

  const [problemId, outputsPath] = args;

  // When run as CLI, use the script's directory as base
  const scriptDir = __dirname;
  const result = await verifyOutputs(problemId, outputsPath, scriptDir);

  if (result.error) {
    console.error(`Error: ${result.error}`);
    process.exit(2);
  }

  // Compare each test case with details
  console.log(`Verifying ${result.total} test case(s)...\n`);

  // Re-do comparison to show details (for CLI)
  const problemDir = path.join(scriptDir, "generated", problemId);
  const testJsonPath = path.join(problemDir, "test.json");
  const expectedData = JSON.parse(await readFile(testJsonPath, "utf-8"));
  const submittedData = JSON.parse(await readFile(outputsPath, "utf-8"));

  for (let i = 0; i < result.total; i++) {
    const expected = expectedData.test[i].output;
    const submitted = submittedData.test[i]?.output;

    if (!submitted) {
      console.log(`✗ Test case ${i + 1}/${result.total}: FAIL`);
      console.log(`  Error: Missing output field`);
      continue;
    }

    if (JSON.stringify(expected) === JSON.stringify(submitted)) {
      console.log(`✓ Test case ${i + 1}/${result.total}: PASS`);
    } else {
      console.log(`✗ Test case ${i + 1}/${result.total}: FAIL`);

      // Show details
      if (Array.isArray(expected) && Array.isArray(submitted)) {
        const expectedShape = `${expected.length}×${expected[0]?.length || 0}`;
        const submittedShape = `${submitted.length}×${submitted[0]?.length || 0}`;
        console.log(`  Expected shape: ${expectedShape}`);
        console.log(`  Got shape:      ${submittedShape}`);

        if (expected.length === submitted.length &&
            expected[0]?.length === submitted[0]?.length) {
          // Same dimensions, show first few differences
          let diffCount = 0;
          for (let row = 0; row < expected.length && diffCount < 3; row++) {
            for (let col = 0; col < expected[row].length && diffCount < 3; col++) {
              if (expected[row][col] !== submitted[row][col]) {
                console.log(`  Difference at [${row}][${col}]: expected ${expected[row][col]}, got ${submitted[row][col]}`);
                diffCount++;
              }
            }
          }

          // Count total differences
          let totalDiff = 0;
          for (let row = 0; row < expected.length; row++) {
            for (let col = 0; col < expected[row].length; col++) {
              if (expected[row][col] !== submitted[row][col]) {
                totalDiff++;
              }
            }
          }
          if (totalDiff > 3) {
            console.log(`  ... and ${totalDiff - 3} more difference(s)`);
          }
        }
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  if (result.success) {
    console.log("✓ All test cases passed!");
    console.log("=".repeat(60));
    process.exit(0);
  } else {
    console.log("✗ Some test cases failed");
    console.log("=".repeat(60));
    process.exit(1);
  }
}

// Only run main if executed directly (not imported)
if (require.main === module) {
  main();
}
