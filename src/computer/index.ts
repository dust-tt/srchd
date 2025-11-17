import Docker, { Container } from "dockerode";
import { Writable } from "stream";
import { Err, Ok, Result } from "../lib/result";
import { normalizeError, SrchdError } from "../lib/error";

const docker = new Docker();
const COMPUTER_IMAGE = "agent-computer:base";
const VOLUME_PREFIX = "srchd_computer_";
const NAME_PREFIX = "srchd-computer-";
const DEFAULT_WORKDIR = "/home/agent";

function containerName(id: string) {
  return `${NAME_PREFIX}${id}`;
}
function volumeName(id: string) {
  return `${VOLUME_PREFIX}${id}`;
}

async function ensureImage(image: string) {
  try {
    await docker.getImage(image).inspect();
  } catch {
    throw new Error(`image not found: ${image}`);
  }
}

async function ensureVolume(name: string) {
  try {
    await docker.getVolume(name).inspect();
  } catch {
    await docker.createVolume({ Name: name });
  }
}

export class Computer {
  private id: string;
  private container: Container;

  private constructor(id: string, container: Container) {
    this.id = id;
    this.container = container;
  }

  static async create(
    computerId: string,
  ): Promise<Result<Computer, SrchdError>> {
    try {
      const name = containerName(computerId);
      const volume = volumeName(computerId);

      await ensureImage(COMPUTER_IMAGE);
      await ensureVolume(volume);

      const privileged = false;
      const usernsMode = "1000:100000:65536";

      const container = await docker.createContainer({
        name,
        Image: COMPUTER_IMAGE,
        WorkingDir: DEFAULT_WORKDIR,
        Env: undefined,
        ExposedPorts: undefined,
        Tty: true,
        User: "agent:agent",
        // ReadonlyRootfs: readonlyRootfs,
        HostConfig: {
          Binds: [`${volume}:${DEFAULT_WORKDIR}:rw`],
          PortBindings: undefined,
          Memory: 512 * 1024 * 1024, // Default 512MB limit
          MemorySwap: 1024 * 1024 * 1024, // Swap limit
          NanoCpus: 1e9, // Default 1 vCPU limit
          CpuShares: 512, // Lower priority
          PidsLimit: 4096, // Limit number of processes
          Ulimits: [
            { Name: "nproc", Soft: 65535, Hard: 65535 },
            { Name: "nofile", Soft: 1048576, Hard: 1048576 },
          ],

          CapAdd: [],
          CapDrop: [],
          SecurityOpt: [],
          Privileged: privileged,
          UsernsMode: usernsMode, // Proper user namespace isolation
          NetworkMode: "bridge", // Isolated network
          IpcMode: "", // Don't share IPC
          PidMode: "", // Don't share PID namespace
          // Prevent access to sensitive host paths
          Tmpfs: {
            "/tmp": "rw,noexec,nosuid,size=100m",
            "/var/tmp": "rw,noexec,nosuid,size=100m",
          },
        },
        Cmd: ["/bin/bash"],
      });

      await container.start();
      await container.inspect();

      return new Ok(new Computer(computerId, container));
    } catch (err) {
      const error = normalizeError(err);
      return new Err(
        new SrchdError(
          "computer_run_error",
          `Failed to create computer: ${error.message}`,
          error,
        ),
      );
    }
  }

  static async findById(computerId: string): Promise<Computer | null> {
    const name = containerName(computerId);
    try {
      const container = docker.getContainer(name);
      // This will raise an error if the container does not exist which will in turn return null.
      await container.inspect();
      return new Computer(computerId, container);
    } catch (_err) {
      return null;
    }
  }

  static async ensure(
    computerId: string,
  ): Promise<Result<Computer, SrchdError>> {
    const c = await Computer.findById(computerId);
    if (c) {
      const status = await c.status();
      if (status !== "running") {
        await c.container.start();
        if ((await c.status()) !== "running") {
          return new Err(
            new SrchdError(
              "computer_run_error",
              "Computer `ensure` failed set the computer as running",
            ),
          );
        }
      }
      return new Ok(c);
    }
    return Computer.create(computerId);
  }

  static async listComputerIds() {
    try {
      const list = await docker.listContainers({
        all: true,
        filters: { name: [NAME_PREFIX] },
      });
      return new Ok(
        list.map((c) => c.Names?.[0]?.slice(NAME_PREFIX.length + 1)),
      );
    } catch (err) {
      const error = normalizeError(err);
      return new Err(
        new SrchdError(
          "computer_run_error",
          `Failed to list computers: ${error.message}`,
          error,
        ),
      );
    }
  }

  async status(): Promise<string> {
    const i = await this.container.inspect();
    return i.State.Status;
  }

  async terminate(removeVolume = true): Promise<Result<boolean, SrchdError>> {
    const volume = volumeName(this.id);

    try {
      try {
        await this.container.stop({ t: 5 });
      } catch (_err) {
        // ignore
      }
      await this.container.remove({ v: removeVolume, force: true });
      if (removeVolume) {
        await docker.getVolume(volume).remove();
      }
      return new Ok(true);
    } catch (err) {
      const error = normalizeError(err);
      return new Err(
        new SrchdError(
          "computer_run_error",
          `Failed to terminate computer: ${error.message}`,
          error,
        ),
      );
    }
  }

  async execute(
    cmd: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<
    Result<
      {
        exitCode: number;
        stdout: string;
        stderr: string;
        durationMs: number;
      },
      SrchdError
    >
  > {
    const timeoutMs = options?.timeoutMs ?? 60000;

    try {
      // Sanitize command to prevent injection
      // const sanitizedCmd = cmd.replace(/[;&|`$(){}[\]\\]/g, "\\$&");
      // const shellCmd = `timeout ${timeout} ${DEFAULT_SHELL} "${sanitizedCmd}" 2>&1`;

      const exec = await this.container.exec({
        Cmd: ["/bin/bash", "-lc", cmd],
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: options?.cwd ?? DEFAULT_WORKDIR,
        Env: options?.env
          ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`)
          : undefined,
        User: "agent:agent", // Force non-root execution
      });

      const startTs = Date.now();
      const stream = await exec.start({ hijack: true, stdin: false });

      let stdout = "";
      let stderr = "";

      try {
        const streamPromise = new Promise<void>((resolve, reject) => {
          if (
            this.container.modem &&
            typeof this.container.modem.demuxStream === "function"
          ) {
            const outChunks: Buffer[] = [];
            const errChunks: Buffer[] = [];

            const outStream = new Writable({
              write(chunk, encoding, callback) {
                outChunks.push(Buffer.from(chunk, encoding));
                callback();
              },
            });

            const errStream = new Writable({
              write(chunk, encoding, callback) {
                errChunks.push(Buffer.from(chunk, encoding));
                callback();
              },
            });

            this.container.modem.demuxStream(stream, outStream, errStream);

            stream.on("end", () => {
              stdout = Buffer.concat(outChunks).toString("utf-8");
              stderr = Buffer.concat(errChunks).toString("utf-8");
              resolve();
            });

            stream.on("error", (e: Error) => {
              reject(e);
            });
          } else {
            // Fallback for non-demuxed streams
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => {
              stdout = Buffer.concat(chunks).toString("utf-8");
              resolve();
            });
            stream.on("error", (e: Error) => {
              reject(e);
            });
          }
        });

        let timeoutHandle: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(() => {
            stream.destroy();
            reject(
              new SrchdError(
                "computer_timeout_error",
                "Command execution interrupted by timeout, the comand is likely still running.",
              ),
            );
          }, timeoutMs);
        });

        try {
          await Promise.race([streamPromise, timeoutPromise]);
        } finally {
          // @ts-ignore tiemeoutHandle is set
          clearTimeout(timeoutHandle);
        }
      } catch (err) {
        // Return the timeout error as is
        if (err instanceof SrchdError) {
          return new Err(err);
        }
        throw err;
      }

      const inspect = await exec.inspect();
      const exitCode = inspect.ExitCode ?? 127;

      return new Ok({
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startTs,
      });
    } catch (err) {
      const error = normalizeError(err);
      return new Err(
        new SrchdError(
          "computer_run_error",
          `Failed to execute on computer: ${error.message}`,
          error,
        ),
      );
    }
  }
}
