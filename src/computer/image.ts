import { stat, readFile } from "fs/promises";
import path from "path";
import { Err, Ok, Result } from "../lib/result";
import { SrchdError } from "../lib/error";
import Docker from "dockerode";
import tar from "tar-stream";

const IDENTITY_FILES_COPY_PLACEHOLDER = "# IDENTITY_FILES_COPY_PLACEHOLDER";

export async function dockerFile() {
  const dockerFile = await readFile(
    path.join(__dirname, "./Dockerfile"),
    "utf8",
  );
  return dockerFile;
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
        "computer_image_error",
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

  const df = await dockerFile();

  if (!df.includes(IDENTITY_FILES_COPY_PLACEHOLDER)) {
    return new Err(
      new SrchdError(
        "computer_image_error",
        `Dockerfile is missing identity files placeholder.`,
      ),
    );
  }

  const dfId = df.replace(IDENTITY_FILES_COPY_PLACEHOLDER, copyCommand);

  return new Ok(dfId);
}

export async function buildImage(
  privateKeyPath: string | null,
): Promise<Result<void, SrchdError>> {
  let df = await dockerFile();

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
          "computer_image_error",
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

  pack.finalize();
  const stream = await docker.buildImage(pack, {
    t: "agent-computer:base",
  });

  return new Promise((resolve) => {
    docker.modem.followProgress(
      stream,
      (err, res) => {
        if (err) {
          resolve(
            new Err(
              new SrchdError(
                "computer_image_error",
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
                  "computer_image_error",
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
