import { Result, err, ok } from "./error";

import * as k8s from "@kubernetes/client-node";

export const kc = new k8s.KubeConfig();
kc.loadFromDefault();
export const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
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
  logExists: boolean = true,
): Promise<Result<void>> {
  try {
    await read();
    if (logExists) {
      console.log(`${kind} already exists: ${name}`);
    }
    return ok(undefined);
  } catch (e: any) {
    if (e.code === 404) {
      await create();
      console.log(`Created ${kind}: ${name}`);
      return ok(undefined);
    } else {
      return err("pod_run_error", `Failed to create ${kind}: ${name}`, e);
    }
  }
}

export async function ensurePodRunning(
  namespace: string,
  computerId?: string,
  timeoutSeconds: number = 60,
): Promise<Result<void>> {
  // Give a minute to check for pod to be instantiated.
  for (let i = 0; i < timeoutSeconds; i++) {
    const podStatus = await k8sApi.readNamespacedPod({
      name: podName(namespace, computerId),
      namespace,
    });
    if (
      podStatus.status?.phase === "Running" &&
      podStatus.status?.containerStatuses?.[0]?.ready
    ) {
      return ok(undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return err(
    "pod_initialization_error",
    `Pod ${podName(namespace, computerId)} failed to become ready within timeout`,
  );
}

export async function ensureNamespace(
  namespace: string,
): Promise<Result<void>> {
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
    false,
  );
}

export async function timeout(
  timeoutMs: number = 60000,
): Promise<Result<void>> {
  return await new Promise<Result<void>>((resolve) => {
    setTimeout(() => {
      resolve(
        err(
          "pod_timeout_error",
          "Command execution interrupted by timeout, the command is likely still running.",
        ),
      );
    }, timeoutMs);
  });
}
