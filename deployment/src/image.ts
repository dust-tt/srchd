import { readFile } from "fs/promises";
import path from "path";
import tar from "tar-stream";
import { addDirectoryToTar, buildImage } from "../../src/lib/image";
import { Result } from "../../src/lib/result";
import { SrchdError } from "../../src/lib/error";
import { SRCHD_IMAGE } from "./definitions";

export const SRCHD_DOCKERFILE_PATH = path.join(__dirname, "../Dockerfile");

export async function dockerFile(): Promise<string> {
  return await readFile(SRCHD_DOCKERFILE_PATH, "utf8");
}

async function srchdFilePacker(pack: tar.Pack): Promise<void> {
  // Add project files needed by the Dockerfile
  const projectRoot = path.resolve(__dirname, "../..");
  const workspaceDir = path.resolve(__dirname, "..");

  pack.entry(
    { name: "entrypoint.sh" },
    await readFile(path.join(workspaceDir, "entrypoint.sh"), "utf8"),
  );
  // Add package files
  for (const file of [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "drizzle.config.ts",
  ]) {
    const filePath = path.join(projectRoot, file);
    const content = await readFile(filePath);
    pack.entry({ name: file }, content);
  }
  for (const dir of ["src", "prompts", "problems"]) {
    await addDirectoryToTar(pack, path.join(projectRoot, dir), dir);
  }
}

export async function buildSrchdImage(): Promise<Result<void, SrchdError>> {
  const df = await dockerFile();
  return buildImage(SRCHD_IMAGE, df, srchdFilePacker);
}
