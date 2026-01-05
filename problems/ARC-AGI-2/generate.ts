#!/usr/bin/env node

// To be run from the root of the srchd repository

import { readdir, readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

(async () => {
  if (!process.cwd().endsWith("/srchd-arc-agi")) {
    console.error(
      "Run this script from the root of the srchd-arc-agi repository",
      process.cwd(),
    );
    process.exit(1);
  }
  if (
    !(
      await readdir(path.join(process.cwd(), "problems/ARC-AGI-2/vendor"))
    ).includes("readme.md")
  ) {
    console.error(
      "problems/ARC-AGI-2/vendor not found. Run `git submodule update --init --recursive`",
    );
    process.exit(1);
  }

  const evaluationProblems = (
    await readFile(
      path.join(process.cwd(), "problems/ARC-AGI-2/vendor/data/evaluation.txt"),
      "utf-8",
    )
  ).split("\n").filter(p => p.trim().length > 0);

  const template = await readFile(
    path.join(process.cwd(), "problems/ARC-AGI-2/template.md"),
    "utf-8",
  );

  console.log(`Found ${evaluationProblems.length} evaluation problems\n`);

  for (const problem of evaluationProblems) {
    const problemData = JSON.parse(
      await readFile(
        path.join(
          process.cwd(),
          "problems/ARC-AGI-2/vendor/data/evaluation",
          `${problem}.json`,
        ),
        "utf-8",
      ),
    );

    // Create problem directory
    const problemDir = path.join(process.cwd(), "problems/ARC-AGI-2/generated", problem);
    if (!existsSync(problemDir)) {
      await mkdir(problemDir, { recursive: true });
    }

    // Generate problem description
    const training = [];
    for (const example of problemData.train) {
      let t = "INPUT:\n";
      t += example.input.map((row: number[]) => row.join(" ")).join("\n");
      t += "\nOUTPUT:\n";
      t += example.output.map((row: number[]) => row.join(" ")).join("\n");
      training.push(t);
    }

    const test = [];
    for (const example of problemData.test) {
      let t = "INPUT:\n";
      t += example.input.map((row: number[]) => row.join(" ")).join("\n");
      test.push(t);
    }

    const problemDescription = template
      .replace("{{PROBLEM}}", problem)
      .replace("{{TRAINING}}", training.join("\n\n"))
      .replace("{{TEST}}", test.join("\n\n"));

    // Write problem description file
    await writeFile(
      path.join(problemDir, "problem"),
      problemDescription,
      "utf-8",
    );

    // Create problem.json (train + test inputs only - visible to agents)
    const testInputs = problemData.test.map((t: any) => ({ input: t.input }));
    await writeFile(
      path.join(problemDir, "problem.json"),
      JSON.stringify({ train: problemData.train, test: testInputs }),
      "utf-8",
    );

    // Create test.json (test with outputs for grading - hidden)
    await writeFile(
      path.join(problemDir, "test.json"),
      JSON.stringify({ test: problemData.test }),
      "utf-8",
    );

    console.log(`✓ Generated ${problem}/`);
  }

  console.log(`\n✓ Generated ${evaluationProblems.length} problems`);
})();
