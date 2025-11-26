import { kc, podName, timeout } from "@app/lib/k8s";
import { ensure, k8sApi } from "@app/lib/k8s";
import { Err, Ok, Result } from "@app/lib/error";
import { defineComputerPod } from "./definitions";
import { Writable } from "stream";
import * as k8s from "@kubernetes/client-node";

export async function ensureComputerPod(
  namespace: string,
  computerId: string,
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
        body: defineComputerPod(namespace, computerId),
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
        ["/bin/bash", "-lc", ...cmd],
        stdoutStream,
        stderrStream,
        null,
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
      .catch((err: any) => {
        failReason = "executionFailed";
        reject(new Error(err));
      });
  });

  try {
    if (!timeoutMs) {
      await execPromise;
    } else {
      await Promise.race([execPromise, timeout(timeoutMs)]);
    }
  } catch (err: any) {
    if (failReason === "commandRunFailed") {
      return new Ok({
        exitCode,
        stdout,
        stderr,
      });
    }

    if (err instanceof Err) {
      return err;
    }

    return err(
      "pod_run_error",
      `Failed to execute ${cmd.join(" ")}`,
      new Error(err),
    );
  }

  return new Ok({
    exitCode,
    stdout,
    stderr,
  });
}
