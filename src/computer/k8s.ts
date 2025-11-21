import * as k8s from "@kubernetes/client-node";
import { podName, volumeName } from "../lib/k8s";
import { ensure, k8sApi, kc, timeout } from "../lib/k8s";
import { Err, Ok, Result } from "../lib/result";
import { SrchdError } from "../lib/error";
import { Writable } from "stream";
import { defineComputerPod, defineComputerVolume } from "./definitions";

export async function ensureComputerVolume(
  workspaceId: string,
  computerId: string,
): Promise<Result<void, SrchdError>> {
  const name = volumeName(workspaceId, computerId);
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPersistentVolumeClaim({
        name,
        namespace: workspaceId,
      });
    },
    async () => {
      await k8sApi.createNamespacedPersistentVolumeClaim({
        namespace: workspaceId,
        body: defineComputerVolume(workspaceId, computerId),
      });
    },
    "PVC",
    name,
  );
}

export async function ensureComputerPod(
  workspaceId: string,
  computerId: string,
): Promise<Result<void, SrchdError>> {
  const name = podName(workspaceId, computerId);
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPod({
        namespace: workspaceId,
        name,
      });
    },
    async () => {
      await k8sApi.createNamespacedPod({
        namespace: workspaceId,
        body: defineComputerPod(workspaceId, computerId),
      });
    },
    "Pod",
    name,
  );
}

export async function computerExec(
  cmd: string[],
  workspaceId: string,
  computerId: string,
  timeoutMs?: number,
): Promise<
  Result<{ stdout: string; stderr: string; exitCode: number }, SrchdError>
> {
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
        workspaceId,
        podName(workspaceId, computerId),
        "computer",
        cmd,
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

    return new Err(
      new SrchdError(
        "computer_run_error",
        `Failed to execute ${cmd.join(" ")}`,
        new Error(err),
      ),
    );
  }

  return new Ok({
    exitCode,
    stdout,
    stderr,
  });
}
