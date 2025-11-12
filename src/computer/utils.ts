import { Readable, Writable } from "stream";
import { Err, Ok, Result } from "../lib/result";
import { SrchdError } from "../lib/error";

import * as k8s from "@kubernetes/client-node";
import {
  defineNamespace,
  definePod,
  definePVC,
  podName,
  pvcName,
} from "./definitions";

export const INSTANCE_ID = process.env.INSTANCE_ID ?? "default";

export const kc = new k8s.KubeConfig();
kc.loadFromDefault();
export const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
const k8sExec = new k8s.Exec(kc);

export function compErr(msg: string, err?: Error): Err<SrchdError> {
  return new Err(new SrchdError("computer_run_error", msg, err));
}

export async function isPodReady(
  instanceId: string,
  computerId: string,
): Promise<Result<void, SrchdError>> {
  // Give a minute to check for pod to be instantiated.
  for (let i = 0; i < 60; i++) {
    const podStatus = await k8sApi.readNamespacedPod({
      name: podName(instanceId, computerId),
      namespace: instanceId,
    });
    if (
      podStatus.status?.phase === "Running" &&
      podStatus.status?.containerStatuses?.[0]?.ready
    ) {
      return new Ok(undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return compErr("Pod not ready yet");
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
      return compErr(`Failed to create ${kind}: ${name}`, err);
    }
  }
}

export async function ensurePVC(
  instanceId: string,
  computerId: string,
): Promise<Result<void, SrchdError>> {
  const name = pvcName(instanceId, computerId);
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPersistentVolumeClaim({
        name,
        namespace: instanceId,
      });
    },
    async () => {
      await k8sApi.createNamespacedPersistentVolumeClaim({
        namespace: instanceId,
        body: definePVC(instanceId, computerId),
      });
    },
    "PVC",
    name,
  );
}

export async function ensurePod(
  instanceId: string,
  computerId: string,
): Promise<Result<void, SrchdError>> {
  const name = podName(instanceId, computerId);
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPod({
        namespace: instanceId,
        name,
      });
    },
    async () => {
      await k8sApi.createNamespacedPod({
        namespace: instanceId,
        body: definePod(instanceId, computerId),
      });
    },
    "Pod",
    name,
  );
}

export async function ensureNamespace(
  instanceId: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await k8sApi.readNamespace({
        name: instanceId,
      });
    },
    async () => {
      await k8sApi.createNamespace({
        body: defineNamespace(instanceId),
      });
    },
    "Namespace",
    instanceId,
  );
}

export async function k8Exec(
  cmd: string[],
  podName: string,
  instanceId: string,
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
        instanceId,
        podName,
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
      .catch((_err) => {
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
    return compErr(errorMsg ?? `Failed to execute ${cmd.join(" ")}`, err);
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
  let timeoutHandle: NodeJS.Timeout;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new SrchdError(
            "computer_timeout_error",
            "Command execution interrupted by timeout, the command is likely still running.",
          ),
        );
      }, timeoutMs);
    });
    await timeoutPromise;
  } catch (err: any) {
    if (err instanceof SrchdError) {
      return new Err(err);
    } else {
      return new Err(new SrchdError("computer_timeout_error", err));
    }
  } finally {
    clearTimeout(timeoutHandle!);
  }
  return new Ok(undefined);
}
