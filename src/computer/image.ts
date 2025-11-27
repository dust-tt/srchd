import { readFile, stat } from "fs/promises";
import { Result, err, ok } from "../lib/error";
import path from "path";
import tar from "tar-stream";
import { buildImage } from "../lib/image";

const IDENTITY_FILES_COPY_PLACEHOLDER = "# IDENTITY_FILES_COPY_PLACEHOLDER";

export const COMPUTER_DOCKERFILE_PATH = path.join(__dirname, "Dockerfile");

export async function dockerFile(): Promise<string> {
  return await readFile(COMPUTER_DOCKERFILE_PATH, "utf8");
}

export async function dockerFileForIdentity(
  privateKeyPath: string,
): Promise<Result<string>> {
  const publicKeyPath = privateKeyPath + ".pub";
  // check that both files exist
  const stats = await Promise.all([
    stat(privateKeyPath)
      .then(() => true)
      .catch(() => false),
    stat(publicKeyPath)
      .then(() => true)
      .catch(() => false),
  ]);

  if (stats.some((exists) => !exists)) {
    return err(
      "image_error",
      `Identity files not found at paths: ${privateKeyPath}, ${publicKeyPath}`,
    );
  }

  const privateKeyFilename = path.basename(privateKeyPath);
  const publicKeyFilename = path.basename(publicKeyPath);

  const copyCommand = `
COPY --chown=agent:agent ${privateKeyFilename} ${publicKeyFilename} /home/agent/.ssh/
RUN chmod 600 /home/agent/.ssh/${privateKeyFilename} && \\
    chmod 644 /home/agent/.ssh/${publicKeyFilename}
`;

  const df = await dockerFile();

  if (!df.includes(IDENTITY_FILES_COPY_PLACEHOLDER)) {
    return err(
      "image_error",
      `Dockerfile is missing identity files placeholder.`,
    );
  }

  const dfId = df.replace(IDENTITY_FILES_COPY_PLACEHOLDER, copyCommand);

  return ok(dfId);
}

async function identityFilePacker(
  pack: tar.Pack,
  privateKeyPath: string,
): Promise<void> {
  const publicKeyPath = privateKeyPath + ".pub";

  const privateKeyFilename = path.basename(privateKeyPath);
  const publicKeyFilename = privateKeyFilename + ".pub";

  const privateKeyContent = await readFile(privateKeyPath);
  const publicKeyContent = await readFile(publicKeyPath);

  pack.entry({ name: privateKeyFilename }, privateKeyContent);
  pack.entry({ name: publicKeyFilename }, publicKeyContent);
}

export async function buildComputerImage(
  privateKeyPath: string | null,
): Promise<Result<void>> {
  const df = privateKeyPath
    ? await dockerFileForIdentity(privateKeyPath)
    : ok(await dockerFile());

  if (df.isErr()) {
    return df;
  }

  return buildImage(
    "agent-computer:base",
    df.value,
    privateKeyPath
      ? (pack) => identityFilePacker(pack, privateKeyPath)
      : undefined,
  );
}
