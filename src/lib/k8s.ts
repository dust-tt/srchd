import { Readable, Writable } from "stream";
import { Err, Ok, Result } from "./result";
import { SrchdError } from "./error";

import * as k8s from "@kubernetes/client-node";
import {
  defineNamespace,
  defineComputerPod,
  defineComputerVolume,
  podName,
  pvcName,
} from "../computer/definitions";

export const K8S_NAMESPACE = process.env.NAMESPACE ?? "default";

export const kc = new k8s.KubeConfig();
kc.loadFromDefault();
export const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const k8sExec = new k8s.Exec(kc);

export async function ensurePodRunning(
  workspaceId: string,
  computerId: string,
  timeoutSeconds: number = 60,
): Promise<Result<void, SrchdError>> {
  // Give a minute to check for pod to be instantiated.
  for (let i = 0; i < timeoutSeconds; i++) {
    const podStatus = await k8sApi.readNamespacedPod({
      name: podName(workspaceId, computerId),
      namespace: workspaceId,
    });
    if (
      podStatus.status?.phase === "Running" &&
      podStatus.status?.containerStatuses?.[0]?.ready
    ) {
      return new Ok(undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return new Err(
    new SrchdError(
      "pod_initialization_error",
      "Pod failed to become ready within timeout",
    ),
  );
}

async function ensure(
  read: () => Promise<void>,
  create: () => Promise<void>,
  kind: string,
  name: string,
): Promise<Result<void, SrchdError>> {
  try {
    await read();
    console.log(`${kind} already exists: ${name}`);
    return new Ok(undefined);
  } catch (err: any) {
    if (err.code === 404) {
      await create();
      console.log(`Created ${kind}: ${name}`);
      return new Ok(undefined);
    } else {
      return new Err(
        new SrchdError(
          "computer_run_error",
          `Failed to create ${kind}: ${name}`,
          err,
        ),
      );
    }
  }
}

export async function ensureComputerVolume(
  workspaceId: string,
  computerId: string,
): Promise<Result<void, SrchdError>> {
  const name = pvcName(workspaceId, computerId);
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

export async function ensureNamespace(
  workspaceId: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await k8sApi.readNamespace({
        name: workspaceId,
      });
    },
    async () => {
      await k8sApi.createNamespace({
        body: defineNamespace(workspaceId),
      });
    },
    "Namespace",
    workspaceId,
  );
}

export async function podExec(
  cmd: string[],
  computerId: string,
  workspaceId: string,
  {
    timeoutMs,
    errorMsg,
    stdin,
    stdout,
    stderr,
  }: {
    timeoutMs?: number;
    errorMsg?: string;
    stdin?: Readable;
    stdout?: Writable;
    stderr?: Writable;
  },
): Promise<
  Result<{ stdout: string; stderr: string; exitCode: number }, SrchdError>
> {
  let stdoutStr = "";
  let stderrStr = "";
  let exitCode = 0;
  const execPromise = new Promise<void>((resolve, reject) => {
    const stdoutStream =
      stdout ??
      new Writable({
        write(chunk, _enc, callback) {
          stdoutStr += chunk.toString();
          callback();
        },
      });

    const stderrStream =
      stderr ??
      new Writable({
        write(chunk, _encoding, callback) {
          stderrStr += chunk.toString();
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
        stdin ?? null,
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
        resolve();
      });
  });

  try {
    if (!timeoutMs) {
      await execPromise;
    } else {
      await Promise.race([execPromise, timeout(timeoutMs)]);
    }
  } catch (err: any) {
    if (err instanceof SrchdError) {
      return new Err(err);
    }
    return new Err(
      new SrchdError(
        "computer_run_error",
        errorMsg ?? `Failed to execute ${cmd.join(" ")}`,
        err,
      ),
    );
  }

  return new Ok({
    exitCode,
    stdout: stdoutStr,
    stderr: stderrStr,
  });
}

async function timeout(
  timeoutMs: number = 60000,
): Promise<Result<void, SrchdError>> {
  return await new Promise<Result<void, SrchdError>>((resolve) => {
    setTimeout(() => {
      resolve(
        new Err(
          new SrchdError(
            "computer_timeout_error",
            "Command execution interrupted by timeout, the command is likely still running.",
          ),
        ),
      );
    }, timeoutMs);
  });
}
