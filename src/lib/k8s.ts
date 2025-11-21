import { Err, Ok, Result } from "./result";
import { SrchdError } from "./error";

import * as k8s from "@kubernetes/client-node";
import { Writable } from "stream";

export const kc = new k8s.KubeConfig();
kc.loadFromDefault();
export const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
export const rbacApi = kc.makeApiClient(k8s.RbacAuthorizationV1Api);
export const K8S_NAMESPACE = process.env.NAMESPACE ?? "default";

export const podName = (workspaceId: string, computerId?: string) =>
  computerId ? `srchd-${workspaceId}-${computerId}` : `srchd-${workspaceId}`;

export const volumeName = (workspaceId: string, computerId?: string) =>
  computerId
    ? `srchd-${workspaceId}-${computerId}-pvc`
    : `srchd-${workspaceId}-pvc`;

export const serviceName = (workspaceId: string) => `srchd-${workspaceId}`;
export const serviceAccountName = (workspaceId: string) =>
  `srchd-${workspaceId}`;
export const roleName = (workspaceId: string) => `srchd-${workspaceId}`;
export const roleBindingName = (workspaceId: string) => `srchd-${workspaceId}`;

export function namespaceLabels(workspaceId: string) {
  return {
    app: "srchd",
    workspace: workspaceId,
    "srchd.io/workspace": workspaceId,
  };
}

export function defineNamespace(workspaceId: string): k8s.V1Namespace {
  return {
    metadata: {
      name: workspaceId,
      labels: namespaceLabels(workspaceId),
    },
  };
}

export function defineRole(workspaceId: string): k8s.V1Role {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "Role",
    metadata: {
      name: roleName(workspaceId),
      namespace: workspaceId,
      labels: namespaceLabels(workspaceId),
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods", "pods/log", "pods/exec"],
        verbs: ["get", "list", "create", "delete", "watch"],
      },
      {
        apiGroups: [""],
        resources: ["persistentvolumeclaims"],
        verbs: ["get", "list", "create", "delete"],
      },
      {
        apiGroups: [""],
        resources: ["namespaces"],
        verbs: ["get", "list", "create", "delete"],
      },
    ],
  };
}

export function defineRoleBinding(workspaceId: string): k8s.V1RoleBinding {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    metadata: {
      name: roleBindingName(workspaceId),
      namespace: workspaceId,
      labels: namespaceLabels(workspaceId),
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccountName(workspaceId),
        namespace: workspaceId,
      },
    ],
    roleRef: {
      kind: "Role",
      name: roleName(workspaceId),
      apiGroup: "rbac.authorization.k8s.io",
    },
  };
}

export function defineServiceAccount(
  workspaceId: string,
): k8s.V1ServiceAccount {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      name: serviceAccountName(workspaceId),
      namespace: workspaceId,
      labels: namespaceLabels(workspaceId),
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
  workspaceId: string,
  computerId?: string,
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
      `Pod ${podName(workspaceId, computerId)} failed to become ready within timeout`,
    ),
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

export async function ensureServiceAccount(
  workspaceId: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await k8sApi.readNamespacedServiceAccount({
        name: serviceAccountName(workspaceId),
        namespace: workspaceId,
      });
    },
    async () => {
      await k8sApi.createNamespacedServiceAccount({
        namespace: workspaceId,
        body: defineServiceAccount(workspaceId),
      });
    },
    "ServiceAccount",
    serviceAccountName(workspaceId),
  );
}

export async function ensureRole(
  workspaceId: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await rbacApi.readNamespacedRole({
        name: roleName(workspaceId),
        namespace: workspaceId,
      });
    },
    async () => {
      await rbacApi.createNamespacedRole({
        namespace: workspaceId,
        body: defineRole(workspaceId),
      });
    },
    "Role",
    roleName(workspaceId),
  );
}

export async function ensureRoleBinding(
  workspaceId: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await rbacApi.readNamespacedRoleBinding({
        name: roleBindingName(workspaceId),
        namespace: workspaceId,
      });
    },
    async () => {
      await rbacApi.createNamespacedRoleBinding({
        namespace: workspaceId,
        body: defineRoleBinding(workspaceId),
      });
    },
    "RoleBinding",
    roleBindingName(workspaceId),
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
