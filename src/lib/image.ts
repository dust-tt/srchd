import { Result, err, ok } from "./error";
import { readFile, readdir } from "fs/promises";
import path from "path";
import Docker from "dockerode";
import tar from "tar-stream";

export async function addDirectoryToTar(
  pack: tar.Pack,
  dirPath: string,
  basePath?: string,
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
  imageName: string,
  dockerFile: string,
  filePacker?: (pack: tar.Pack) => Promise<void>,
): Promise<Result<void>> {
  const docker = new Docker();

  const pack = tar.pack();
  pack.entry({ name: "Dockerfile" }, dockerFile);

  if (filePacker) {
    await filePacker(pack);
  }

  pack.finalize();
  const stream = await docker.buildImage(pack, { t: imageName });

  return new Promise((resolve) => {
    docker.modem.followProgress(
      stream,
      (e, res) => {
        if (e) {
          resolve(
            err("image_error", `Failed to build Docker image: ${e.message}`),
          );
        } else {
          if (res.some((r) => r.error)) {
            const error = res.find((r) => r.error);
            resolve(
              err(
                "image_error",
                `Failed to build Docker image: ${error.error}`,
              ),
            );
          } else {
            resolve(ok(undefined));
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
