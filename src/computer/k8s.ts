import { K8S_NAMESPACE, kc, podName, timeout } from "@app/lib/k8s";
import { ensure, k8sApi } from "@app/lib/k8s";
import { err, Err, ok, Result } from "@app/lib/error";
import { defineComputerPod } from "./definitions";
import { Readable, Writable } from "stream";
import * as k8s from "@kubernetes/client-node";
import fs from "fs";
import tar from "tar-stream";
import p from "path";
import { readFile } from "fs/promises";
import { addDirectoryToTar } from "@app/lib/image";
import { Env } from "@app/agent_profile";

export async function ensureComputerPod(
  namespace: string,
  computerId: string,
  imageName?: string,
  env: Env[] = [],
): Promise<Result<void>> {
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

export async function computerExec(
  cmd: string[],
  namespace: string,
  computerId: string,
  timeoutMs?: number,
  stdinStream?: Readable,
): Promise<Result<{ stdout: string; stderr: string; exitCode: number }>> {
  const k8sExec = new k8s.Exec(kc);
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  let failReason: "commandRunFailed" | "executionFailed" | undefined;
  const execPromise = new Promise<void>((resolve, reject) => {
    const stdoutStream = new Writable({
      write(chunk, _enc, callback) {
        stdout += chunk.toString();
        callback();
      },
    });

    const stderrStream = new Writable({
      write(chunk, _encoding, callback) {
        stderr += chunk.toString();
        callback();
      },
    });

    k8sExec
      .exec(
        namespace,
        podName(namespace, computerId),
        computerId ? "computer" : "srchd",
        cmd,
        stdoutStream,
        stderrStream,
        stdinStream ?? null,
        false,
        (status: k8s.V1Status) => {
          stdoutStream.end();
          stderrStream.end();

          /* Error Status example:
          {
            "metadata": {},
            "status": "Failure",
            "message": "command terminated with non-zero exit code: command terminated with exit code 127",
            "reason": "NonZeroExitCode",
            "details": {
              "causes": [
                {
                  "reason": "ExitCode",
                  "message": "127"
                }
              ]
            }
          }
          */

          if (status.status === "Success") {
            exitCode = 0;
          } else {
            reject(new Error(status.message));
            const tryToNumber = Number(status.details?.causes?.[0]?.message);
            exitCode = isNaN(tryToNumber) ? 1 : tryToNumber;
            failReason = "commandRunFailed";
          }
          resolve();
        },
      )
      .catch((e: any) => {
        failReason = "executionFailed";
        reject(e as Error);
      });
  });

  try {
    if (!timeoutMs) {
      await execPromise;
    } else {
      await Promise.race([execPromise, timeout(timeoutMs)]);
    }
  } catch (e: any) {
    if (failReason === "commandRunFailed") {
      return ok({
        exitCode,
        stdout,
        stderr,
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

  return ok({
    exitCode,
    stdout,
    stderr,
  });
}

export async function copyToComputer(
  computerId: string,
  path: string,
  namespace: string = K8S_NAMESPACE,
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

  const copyCommand = ["tar", "xf", "-", "-C", "/home/agent"];
  const res = await computerExec(
    copyCommand,
    namespace,
    computerId,
    undefined,
    pack,
  );

  if (res.isErr()) {
    return res;
  } else if (res.value.exitCode !== 0 || res.value.stderr.length > 0) {
    return err(
      "copy_file_error",
      `Couldn't copy file to computer: ${podName(namespace, computerId)}:
      Got exit code: ${res.value.exitCode}
      And error: ${res.value.stderr}`,
    );
  }

  return ok(undefined);
}
