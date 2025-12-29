#!/usr/bin/env node

import { readFile } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length !== 2) {
    console.error("Usage: npx tsx verify.ts <problem-id> <outputs.json>");
    console.error("\nExample: npx tsx verify.ts 1ae2feb7 my-solution.json");
    process.exit(1);
  }

  const [problemId, outputsPath] = args;

  // Check if problem exists
  const problemDir = path.join(process.cwd(), "generated", problemId);
  if (!existsSync(problemDir)) {
    console.error(`Error: Problem ${problemId} not found in generated/`);
    process.exit(1);
  }

  const testJsonPath = path.join(problemDir, "test.json");
  if (!existsSync(testJsonPath)) {
    console.error(`Error: test.json not found for problem ${problemId}`);
    process.exit(1);
  }

  // Check if outputs file exists
  if (!existsSync(outputsPath)) {
    console.error(`Error: Outputs file not found: ${outputsPath}`);
    process.exit(1);
  }

  // Load files
  let expectedData, submittedData;
  
  try {
    expectedData = JSON.parse(await readFile(testJsonPath, "utf-8"));
  } catch (error: any) {
    console.error(`Error reading test.json: ${error.message}`);
    process.exit(2);
  }

  try {
    submittedData = JSON.parse(await readFile(outputsPath, "utf-8"));
  } catch (error: any) {
    console.error(`Error reading outputs file: ${error.message}`);
    process.exit(2);
  }

  // Validate structure
  if (!submittedData.test || !Array.isArray(submittedData.test)) {
    console.error("Error: Invalid outputs.json format - missing 'test' array");
    process.exit(2);
  }

  if (!expectedData.test || !Array.isArray(expectedData.test)) {
    console.error("Error: Invalid test.json format - missing 'test' array");
    process.exit(2);
  }

  // Check count
  if (submittedData.test.length !== expectedData.test.length) {
    console.error(`Error: Wrong number of outputs`);
    console.error(`  Expected: ${expectedData.test.length} test case(s)`);
    console.error(`  Got:      ${submittedData.test.length} test case(s)`);
    process.exit(1);
  }

  // Compare each test case
  console.log(`Verifying ${expectedData.test.length} test case(s)...\n`);

  let allPassed = true;
  
  for (let i = 0; i < expectedData.test.length; i++) {
    const expected = expectedData.test[i].output;
    const submitted = submittedData.test[i]?.output;

    if (!submitted) {
      console.log(`✗ Test case ${i + 1}/${expectedData.test.length}: FAIL`);
      console.log(`  Error: Missing output field`);
      allPassed = false;
      continue;
    }

    if (JSON.stringify(expected) === JSON.stringify(submitted)) {
      console.log(`✓ Test case ${i + 1}/${expectedData.test.length}: PASS`);
    } else {
      allPassed = false;
      console.log(`✗ Test case ${i + 1}/${expectedData.test.length}: FAIL`);

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
  if (allPassed) {
    console.log("✓ All test cases passed!");
    console.log("=".repeat(60));
    process.exit(0);
  } else {
    console.log("✗ Some test cases failed");
    console.log("=".repeat(60));
    process.exit(1);
  }
}

main();
