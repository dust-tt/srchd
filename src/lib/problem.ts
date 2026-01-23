import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";
import * as os from "os";

import { Result, err, ok } from "./error";

// Base directory for problems (relative to cwd)
const PROBLEMS_DIR = "problems";

/**
 * Resolves a problem input (ID, relative path, or absolute path) to a normalized problem ID.
 * The problem ID is the relative path from the problems/ directory.
 *
 * @param input - Problem ID, relative path, or absolute path
 * @returns The normalized problem ID (e.g., "security/rootme/cracking/24")
 */
export function resolveProblemId(input: string): Result<string> {
  // Expand ~ to home directory
  const expandedInput = input.startsWith("~")
    ? path.join(os.homedir(), input.slice(1))
    : input;

  const problemsDir = path.resolve(PROBLEMS_DIR);

  let absolutePath: string;

  if (path.isAbsolute(expandedInput)) {
    // Absolute path
    absolutePath = expandedInput;
  } else {
    // Try as relative path from cwd first
    const cwdRelativePath = path.resolve(expandedInput);
    if (fsSync.existsSync(cwdRelativePath)) {
      absolutePath = cwdRelativePath;
    } else {
      // Fall back to problem ID (relative to problems/)
      absolutePath = path.join(problemsDir, expandedInput);
    }
  }

  // Check if the path exists
  if (!fsSync.existsSync(absolutePath)) {
    return err("not_found_error", `Problem not found at: ${absolutePath}`);
  }

  // Normalize the path
  absolutePath = path.normalize(absolutePath);

  // Extract the problem ID (relative path from problems/)
  if (absolutePath.startsWith(problemsDir + path.sep)) {
    return ok(absolutePath.slice(problemsDir.length + 1));
  } else if (absolutePath.startsWith(problemsDir)) {
    return ok(absolutePath.slice(problemsDir.length + 1));
  }

  // Path is outside problems/ directory - use the absolute path as the ID
  // This allows problems from anywhere on the filesystem
  return ok(absolutePath);
}

/**
 * Resolves a problem ID to its absolute path.
 */
export function problemIdToAbsolutePath(problemId: string): string {
  if (path.isAbsolute(problemId)) {
    return problemId;
  }
  return path.resolve(PROBLEMS_DIR, problemId);
}

/**
 * Checks if a problem is a directory (vs a single file).
 */
export function isProblemDirectory(problemId: string): boolean {
  const absolutePath = problemIdToAbsolutePath(problemId);
  return fsSync.statSync(absolutePath).isDirectory();
}

/**
 * Reads the problem content from a problem ID.
 * - If it's a file, reads the file content
 * - If it's a directory, reads problem.md from it
 */
export async function readProblemContent(
  problemId: string,
): Promise<Result<string>> {
  const absolutePath = problemIdToAbsolutePath(problemId);

  try {
    const stat = await fs.stat(absolutePath);

    if (stat.isFile()) {
      const content = await fs.readFile(absolutePath, "utf-8");
      return ok(content);
    }

    if (stat.isDirectory()) {
      const problemMdPath = path.join(absolutePath, "problem.md");
      if (!fsSync.existsSync(problemMdPath)) {
        return err(
          "not_found_error",
          `Problem directory must contain problem.md: ${problemMdPath}`,
        );
      }
      const content = await fs.readFile(problemMdPath, "utf-8");
      return ok(content);
    }

    return err(
      "reading_file_error",
      `Problem path is neither a file nor a directory: ${absolutePath}`,
    );
  } catch (error) {
    return err(
      "reading_file_error",
      `Failed to read problem at ${absolutePath}`,
      error,
    );
  }
}

/**
 * Gets the data directory path for a problem, if it exists.
 * Returns null if the problem doesn't have a data/ directory.
 */
export function getProblemDataPath(problemId: string): string | null {
  const absolutePath = problemIdToAbsolutePath(problemId);

  // Only directories can have data/
  if (!fsSync.statSync(absolutePath).isDirectory()) {
    return null;
  }

  const dataPath = path.join(absolutePath, "data");
  if (fsSync.existsSync(dataPath) && fsSync.statSync(dataPath).isDirectory()) {
    return dataPath;
  }

  return null;
}
