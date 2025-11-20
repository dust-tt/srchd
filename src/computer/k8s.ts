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

          if (status.status === "Success") {
            exitCode = 0;
          } else {
            reject(new Error(status.status));
            exitCode = 1;
          }
          resolve();
        },
      )
      .catch((_err: any) => {
        exitCode = 1;
        reject(new Error(_err));
      });
  });

  try {
    if (!timeoutMs) {
      await execPromise;
    } else {
      await Promise.race([execPromise, timeout(timeoutMs)]);
    }
  } catch (_err: any) {
    // The error returned is always `Failure` which is not helpful
    return new Err(
      new SrchdError(
        "computer_run_error",
        `Failed to execute ${cmd.join(" ")}`,
        new Error(stderr),
      ),
    );
  }

  return new Ok({
    exitCode,
    stdout,
    stderr,
  });
}
