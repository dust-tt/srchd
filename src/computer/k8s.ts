import { K8S_NAMESPACE, kc, podName, timeout } from "@app/lib/k8s";
import { ensure, k8sApi } from "@app/lib/k8s";
import { err, Err, ok, Result } from "@app/lib/error";
import { defineComputerPod, defineComputerVolume, computerVolumeName } from "./definitions";
import { Readable, Writable } from "stream";
import * as k8s from "@kubernetes/client-node";
import fs from "fs";
import tar from "tar-stream";
import p from "path";
import { readFile } from "fs/promises";
import { addDirectoryToTar } from "@app/lib/image";
import { Env } from "@app/agent_profile";
import { Process } from "./process";


const MIN_TIMEOUT_MS = 1000;

async function ensureComputerVolume(
  namespace: string,
  computerId: string,
): Promise<Result<void>> {
  const name = computerVolumeName(namespace, computerId);
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPersistentVolumeClaim({
        name,
        namespace,
      });
    },
    async () => {
      await k8sApi.createNamespacedPersistentVolumeClaim({
        namespace,
        body: defineComputerVolume(namespace, computerId),
      });
    },
    "PVC",
    name,
  );
}

export async function deleteComputerVolume(
  namespace: string,
  computerId: string,
): Promise<Result<void>> {
  const name = computerVolumeName(namespace, computerId);
  try {
    await k8sApi.deleteNamespacedPersistentVolumeClaim({
      name,
      namespace,
    });
    return ok(undefined);
  } catch (e: any) {
    if (e.code === 404) {
      // PVC already deleted
      return ok(undefined);
    }
    return err("pvc_deletion_error", `Failed to delete PVC ${name}`, e);
  }
}

export async function ensureComputerPod(
  namespace: string,
  computerId: string,
  imageName?: string,
  env: Env[] = [],
): Promise<Result<void>> {
  // Ensure PVC exists first
  const volumeResult = await ensureComputerVolume(namespace, computerId);
  if (volumeResult.isErr()) {
    return volumeResult;
  }

  const name = podName(namespace, computerId);
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPod({
        namespace,
        name,
      });
    },
    async () => {
      await k8sApi.createNamespacedPod({
        namespace,
        body: defineComputerPod(namespace, computerId, imageName, env),
      });
    },
    "Pod",
    name,
  );
}

/**
 * Creates an exec promise that executes a command in a Kubernetes pod.
 * This is a low-level helper used by both execute() and spawn().
 */
function createExecPromise(
  namespace: string,
  computerId: string,
  cmd: string[],
  streams: {
    stdoutStream?: Writable,
    stderrStream?: Writable,
    stdinStream?: Readable,
  },
  tty: boolean,
): {
  promise: Promise<{ exitCode: number }>;
  exitCode: { get: () => number };
  failReason: { get: () => "commandRunFailed" | "k8sExecutionFailed" | undefined };
} {
  const k8sExec = new k8s.Exec(kc);
  let exitCode = 0;
  let failReason: "commandRunFailed" | "k8sExecutionFailed" | undefined;

  // Capture stdout/stderr from the stream writes

  const stdoutStream = streams.stdoutStream ?? null;
  const stderrStream = streams.stderrStream ?? null;
  const stdinStream = streams.stdinStream ?? null;

  const promise = new Promise<{ exitCode: number }>((resolve, reject) => {
    k8sExec
      .exec(
        namespace,
        podName(namespace, computerId),
        "computer",
        cmd,
        stdoutStream,
        stderrStream,
        stdinStream,
        tty,
        (status: k8s.V1Status) => {
          // NOTE: We intentionally do NOT close any streams here
          // The K8s exec connection should remain open as long as the process is running
          // and streams should close naturally when the connection ends.
          // Closing streams prematurely will terminate the exec connection and kill
          // the process, especially for interactive processes waiting on stdin.

          if (status.status === "Success") {
            exitCode = 0;
          } else {
            const tryToNumber = Number(status.details?.causes?.[0]?.message);
            exitCode = isNaN(tryToNumber) ? 1 : tryToNumber;
            failReason = "commandRunFailed";
          }
          resolve({ exitCode });
        },
      )
      .catch((e: any) => {
        failReason = "k8sExecutionFailed";
        reject(e as Error);
      });
  });



  return {
    promise,
    exitCode: { get: () => exitCode },
    failReason: { get: () => failReason },
  };
}

/**
 * Execute a command and wait for completion. Non-TTY, no timeout.
 * Used by copyTo and copyFrom functions.
 */
export async function execute(
  cmd: string[],
  namespace: string,
  computerId: string,
  streams?: {
    stdinStream?: Readable,
    stdoutStream?: Writable,
  },
): Promise<Result<{ exitCode: number; stderr?: string }>> {
  let stderr = "";
  const stderrStream = new Writable({
    write(chunk: any, _enc: BufferEncoding, callback: (error?: Error | null) => void) {
      stderr += chunk.toString();
      callback();
    },
  });


  const exec = createExecPromise(
    namespace,
    computerId,
    cmd,
    { ...streams, stderrStream },
    false, // non-TTY
  );

  try {
    const result = await exec.promise;
    return ok(result);
  } catch (e: any) {
    if (exec.failReason.get() === "commandRunFailed") {
      return ok({ exitCode: exec.exitCode.get(), stderr });
    }

    if (e instanceof Err) {
      return e;
    }

    return err(
      "pod_run_error",
      `Failed to execute ${cmd.join(" ")}`,
      e,
    );
  }
}

/**
 * Spawn a command with optional timeout. Non-TTY.
 * Returns different shapes based on whether the process completes before timeout.
 */
export async function spawn(
  cmd: string[],
  namespace: string,
  computerId: string,
  process: Process,
  timeoutMs?: number,
): Promise<Result<
  | { status: "running"; process: Promise<void> }
  | { status: "terminated"; exitCode: number; stdout: string; stderr: string }
>> {

  // makes sure there is a bit of time for process to start
  timeoutMs = timeoutMs ?? MIN_TIMEOUT_MS;
  const exec = createExecPromise(
    namespace,
    computerId,
    cmd,
    { ...process },
    process.tty, // non-TTY
  );

  // Wrap exec promise to update process state on completion
  const processPromise = exec.promise.then((result) => {
    process.status = 'terminated';
    process.exitCode = result.exitCode;
  }).catch(() => {
    process.status = 'terminated';
    process.exitCode = exec.failReason.get() === "commandRunFailed" ? exec.exitCode.get() : 1;
  });


  if (!timeoutMs) {
    console.log("no timeout");
  }


  // With timeout - race between completion and timeout
  try {
    const val = await Promise.race([exec.promise, timeout(timeoutMs)]);

    if (typeof val === 'object' && 'exitCode' in val) {
      // exec.promise resolved first - process completed
      return ok({
        ...process,
        status: "terminated",
        exitCode: val.exitCode,
      });
    } else {
      // timeout resolved first - process still running
      return ok({
        status: "running",
        process: processPromise,
      });
    }
  } catch (e: any) {
    if (exec.failReason.get() === "commandRunFailed") {
      return ok({
        ...process,
        status: "terminated",
        exitCode: exec.exitCode.get(),
      });
    }

    if (e instanceof Err) {
      return e;
    }

    return err(
      "pod_run_error",
      `Failed to execute ${cmd.join(" ")}`,
      e,
    );
  }
}

export async function copyToComputer(
  computerId: string,
  path: string,
  namespace: string = K8S_NAMESPACE,
  destinationDir?: string,
): Promise<Result<void>> {
  if (!fs.existsSync(path)) {
    return err("reading_file_error", `Path ${path} does not exist`);
  }
  const stat = fs.statSync(path);
  const name = p.basename(path);
  // If the path isn't absolute, we'll append the cwd to it.

  const pack = tar.pack();
  if (stat.isFile()) {
    const content = await readFile(path);
    pack.entry({ name }, content);
  } else if (stat.isDirectory()) {
    await addDirectoryToTar(pack, path, name);
  } else {
    return err(
      "reading_file_error",
      `Path ${path} is neither a file nor a directory`,
    );
  }
  pack.finalize();

  const destinationPath = destinationDir
    ? `/home/agent/${destinationDir}`
    : "/home/agent";

  const createDestinationDirIfNotExistsRes = await execute(
    ["mkdir", "-p", destinationPath],
    namespace,
    computerId,
  );

  if (createDestinationDirIfNotExistsRes.isErr()) {
    return createDestinationDirIfNotExistsRes;
  }


  const copyCommand = ["tar", "xf", "-", "-C", destinationPath];
  const res = await execute(
    copyCommand,
    namespace,
    computerId,
    { stdinStream: pack },
  );

  if (res.isErr()) {
    return res;
  } else if (res.value.exitCode !== 0) {
    return err(
      "copy_file_error",
      `Couldn't copy file to computer: ${podName(namespace, computerId)}:
      Got exit code: ${res.value.exitCode}
      ${res.value.stderr ? `And error: ${res.value.stderr}` : ""}`,
    );
  }

  return ok(undefined);
}

export async function copyFromComputer(
  computerId: string,
  remotePath: string,
  localPath: string,
  namespace: string = K8S_NAMESPACE,
): Promise<Result<void>> {
  const copyCommand = ["tar", "cf", "-", "-C", p.dirname(remotePath), p.basename(remotePath)];

  const extract = tar.extract();
  const remoteName = p.basename(remotePath);

  extract.on('entry', (header, stream, next) => {
    if (header.name === remoteName) {
      const writeStream = fs.createWriteStream(localPath);
      stream.pipe(writeStream);
      stream.on('end', next);
    } else {
      stream.on('end', next);
      stream.resume();
    }
  });

  const res = await execute(
    copyCommand,
    namespace,
    computerId,
    { stdoutStream: extract },
  );

  if (res.isErr()) {
    return res;
  } else if (res.value.exitCode !== 0) {
    return err(
      "copy_file_error",
      `Couldn't copy file from computer: ${podName(namespace, computerId)}:
      Got exit code: ${res.value.exitCode}
      ${res.value.stderr ? `And error: ${res.value.stderr}` : ""}`,
    );
  }

  return ok(undefined);
}
