import { Err, Ok, Result } from "./result";
import { SrchdError } from "./error";

import * as k8s from "@kubernetes/client-node";

export const kc = new k8s.KubeConfig();
kc.loadFromDefault();
export const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
export const K8S_NAMESPACE = process.env.NAMESPACE ?? "default";

export const podName = (workspaceId: string, computerId: string) =>
  `srchd-${workspaceId}-${computerId}`;

export const volumeName = (workspaceId: string, computerId: string) =>
  `srchd-${workspaceId}-${computerId}-pvc`;

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
