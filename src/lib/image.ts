import { Err, Ok, Result } from "./result";
import { SrchdError } from "./error";
import Docker from "dockerode";
import tar from "tar-stream";

export async function buildImage(
  imageName: string,
  dockerFile: string,
  filePacker?: (pack: tar.Pack) => Promise<void>,
): Promise<Result<void, SrchdError>> {
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
