import { Err, Ok, Result } from "./result";
import { SrchdError } from "./error";

import * as k8s from "@kubernetes/client-node";
import { Writable } from "stream";

export const kc = new k8s.KubeConfig();
kc.loadFromDefault();
export const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
export const rbacApi = kc.makeApiClient(k8s.RbacAuthorizationV1Api);
export const K8S_NAMESPACE = process.env.NAMESPACE ?? "default";

export const podName = (namespace: string, computerId?: string) =>
  computerId ? `srchd-${namespace}-${computerId}` : `srchd-${namespace}`;

export function namespaceLabels(namespace: string) {
  return {
    app: "srchd",
    namespace,
    "srchd.io/namespace": namespace,
  };
}

export function defineNamespace(namespace: string): k8s.V1Namespace {
  return {
    metadata: {
      name: namespace,
      labels: namespaceLabels(namespace),
    },
  };
}

export async function ensure(
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
          "pod_run_error",
          `Failed to create ${kind}: ${name}`,
          err,
        ),
      );
    }
  }
}

export async function ensurePodRunning(
  namespace: string,
  computerId?: string,
  timeoutSeconds: number = 60,
): Promise<Result<void, SrchdError>> {
  // Give a minute to check for pod to be instantiated.
  for (let i = 0; i < timeoutSeconds; i++) {
    const podStatus = await k8sApi.readNamespacedPod({
      name: podName(namespace, computerId),
      namespace: namespace,
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
      `Pod ${podName(namespace, computerId)} failed to become ready within timeout`,
    ),
  );
}

export async function ensureNamespace(
  namespace: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await k8sApi.readNamespace({
        name: namespace,
      });
    },
    async () => {
      await k8sApi.createNamespace({
        body: defineNamespace(namespace),
      });
    },
    "Namespace",
    namespace,
  );
}

export async function timeout(
  timeoutMs: number = 60000,
): Promise<Result<void, SrchdError>> {
  return await new Promise<Result<void, SrchdError>>((resolve) => {
    setTimeout(() => {
      resolve(
        new Err(
          new SrchdError(
            "pod_timeout_error",
            "Command execution interrupted by timeout, the command is likely still running.",
          ),
        ),
      );
    }, timeoutMs);
  });
}

export async function podExec(
  cmd: string[],
  workspaceId: string,
  computerId?: string,
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
        computerId ? "computer" : "srchd",
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
        "pod_run_error",
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
