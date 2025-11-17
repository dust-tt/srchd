import { stat, readFile, readdir } from "fs/promises";
import path from "path";
import { Err, Ok, Result } from "./result";
import { SrchdError } from "./error";
import Docker from "dockerode";
import tar from "tar-stream";
import { COMPUTER_DOCKERFILE_PATH } from "../computer";

export const SRCHD_DOCKERFILE_PATH = path.resolve(
  __dirname,
  "../../Dockerfile",
);

export type Image = "computer" | "srchd";
const IDENTITY_FILES_COPY_PLACEHOLDER = "# IDENTITY_FILES_COPY_PLACEHOLDER";

export async function dockerFile(image: Image): Promise<string> {
  const filePath =
    image === "computer" ? COMPUTER_DOCKERFILE_PATH : SRCHD_DOCKERFILE_PATH;
  return await readFile(filePath, "utf8");
}

export async function dockerFileForIdentity(
  privateKeyPath: string,
): Promise<Result<string, SrchdError>> {
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
    return new Err(
      new SrchdError(
        "image_error",
        `Identity files not found at paths: ${privateKeyPath}, ${publicKeyPath}`,
      ),
    );
  }

  const privateKeyFilename = path.basename(privateKeyPath);
  const publicKeyFilename = path.basename(publicKeyPath);

  const copyCommand = `
COPY --chown=agent:agent ${privateKeyFilename} ${publicKeyFilename} /home/agent/.ssh/
RUN chmod 600 /home/agent/.ssh/${privateKeyFilename} && \\
    chmod 644 /home/agent/.ssh/${publicKeyFilename}
`;

  const df = await dockerFile("computer");

  if (!df.includes(IDENTITY_FILES_COPY_PLACEHOLDER)) {
    return new Err(
      new SrchdError(
        "image_error",
        `Dockerfile is missing identity files placeholder.`,
      ),
    );
  }

  const dfId = df.replace(IDENTITY_FILES_COPY_PLACEHOLDER, copyCommand);

  return new Ok(dfId);
}

async function addDirectoryToTar(
  pack: tar.Pack,
  dirPath: string,
  basePath: string = "",
): Promise<void> {
  const entries = await readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const tarPath = basePath ? path.join(basePath, entry.name) : entry.name;

    if (entry.isDirectory()) {
      await addDirectoryToTar(pack, fullPath, tarPath);
    } else if (entry.isFile()) {
      const content = await readFile(fullPath);
      pack.entry({ name: tarPath }, content);
    }
  }
}

export async function buildImage(
  image: Image,
  privateKeyPath: string | null,
): Promise<Result<void, SrchdError>> {
  let df = await dockerFile(image);

  if (privateKeyPath) {
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
      return new Err(
        new SrchdError(
          "image_error",
          `Identity files not found at paths: ${privateKeyPath}, ${publicKeyPath}`,
        ),
      );
    }

    const dfRes = await dockerFileForIdentity(privateKeyPath);
    if (dfRes.isErr()) {
      return new Err(dfRes.error);
    }
    df = dfRes.value;
  }

  const docker = new Docker();

  const pack = tar.pack();
  pack.entry({ name: "Dockerfile" }, df);

  if (privateKeyPath) {
    const publicKeyPath = privateKeyPath + ".pub";

    const privateKeyFilename = path.basename(privateKeyPath);
    const publicKeyFilename = privateKeyFilename + ".pub";

    const privateKeyContent = await readFile(privateKeyPath);
    const publicKeyContent = await readFile(publicKeyPath);

    pack.entry({ name: privateKeyFilename }, privateKeyContent);
    pack.entry({ name: publicKeyFilename }, publicKeyContent);
  }

  if (image === "srchd") {
    // Add project files needed by the Dockerfile
    const projectRoot = path.resolve(__dirname, "../..");

    // Add package files
    for (const file of [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "drizzle.config.ts",
      "entrypoint.sh",
    ]) {
      const filePath = path.join(projectRoot, file);
      const content = await readFile(filePath);
      pack.entry({ name: file }, content);
    }
    for (const dir of ["src", "prompts", "problems"]) {
      await addDirectoryToTar(pack, path.join(projectRoot, dir), dir);
    }
  }

  pack.finalize();
  const stream = await docker.buildImage(pack, {
    t: image === "computer" ? "agent-computer:base" : "srchd:latest",
  });

  return new Promise((resolve) => {
    docker.modem.followProgress(
      stream,
      (err, res) => {
        if (err) {
          resolve(
            new Err(
              new SrchdError(
                "image_error",
                `Failed to build Docker image: ${err.message}`,
              ),
            ),
          );
        } else {
          if (res.some((r) => r.error)) {
            const error = res.find((r) => r.error);
            resolve(
              new Err(
                new SrchdError(
                  "image_error",
                  `Failed to build Docker image: ${error.error}`,
                ),
              ),
            );
          } else {
            resolve(new Ok(undefined));
          }
        }
      },
      (event) => {
        const output = event.stream ?? event.status ?? "";
        if (output) process.stdout.write(output);
      },
    );
  });
}
