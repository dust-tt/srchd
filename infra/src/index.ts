import * as k8s from "@kubernetes/client-node";
import * as net from "net";
import { err, ok, Result } from "@app/lib/error";
import {
  ensureService,
  ensureServerPod,
  ensureServerVolume,
  ensureServiceAccount,
  ensureRole,
  ensureRoleBinding,
} from "./k8s";
import {
  ensureNamespace,
  ensurePodRunning,
  k8sApi,
  podName,
} from "@app/lib/k8s";

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  mistral?: string;
  firecrawl?: string;
}

export async function createDeployment(
  deployment: string,
  apiKeys: ApiKeys,
): Promise<Result<void>> {
  const namespace = deployment;
  let res = await ensureNamespace(namespace);
  if (res.isErr()) {
    return res;
  }
  // Create RBAC resources
  res = await ensureServiceAccount(namespace);
  if (res.isErr()) {
    return res;
  }
  res = await ensureRole(namespace);
  if (res.isErr()) {
    return res;
  }
  res = await ensureRoleBinding(namespace);
  if (res.isErr()) {
    return res;
  }

  // Create Pod resources
  res = await ensureServerVolume(namespace);
  if (res.isErr()) {
    return res;
  }
  res = await ensureServerPod(namespace, apiKeys);
  if (res.isErr()) {
    return res;
  }
  res = await ensureService(namespace);
  if (res.isErr()) {
    return res;
  }

  console.log(`\nWaiting for pod to be ready...`);
  res = await ensurePodRunning(namespace);

  if (res.isOk()) {
    console.log(`✓ Pod is ready and running`);
  } else {
    console.log(
      `⚠ Pod may not be ready yet, check with: kubectl get pod ${podName(namespace)} -n ${namespace}`,
    );
  }
  return res;
}

export async function deleteDeployment(
  deployment: string,
): Promise<Result<void>> {
  const namespace = deployment;
  try {
    const pods = await k8sApi.listNamespacedPod({
      namespace,
    });

    // Delete all associated computers with it.
    for (const pod of pods.items.filter((p) => p.metadata?.name)) {
      await k8sApi.deleteNamespacedPod({
        name: pod.metadata!.name!,
        namespace,
        gracePeriodSeconds: 0,
      });
    }

    await k8sApi.deleteNamespace({
      name: namespace,
    });
    return ok(undefined);
  } catch (e: any) {
    return err(
      "namespace_deletion_error",
      `Failed to delete namespace: ${namespace}`,
      e,
    );
  }
}

export async function listComputers(deployment: string): Promise<k8s.V1Pod[]> {
  const namespace = deployment;
  const pods = await k8sApi.listNamespacedPod({
    namespace,
  });

  return pods.items.filter((pod) => pod.metadata?.labels?.computer);
}

export async function listDeployments(): Promise<k8s.V1Pod[]> {
  const deployments = await k8sApi.listPodForAllNamespaces({});
  return deployments.items.filter(
    (i) =>
      i.metadata?.labels?.app === "srchd" &&
      i.metadata?.labels["srchd.io/type"] === "server",
  );
}

export async function startPortForward(
  deployment: string,
  port: number,
): Promise<Result<void>> {
  const namespace = deployment;
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const forward = new k8s.PortForward(kc);

  const server = net
    .createServer((socket) => {
      forward.portForward(
        namespace,
        podName(namespace),
        [1337],
        socket,
        socket,
        socket,
      );
    })
    .listen(port);

  // Keep the process alive
  return new Promise((resolve) => {
    server.on("error", (e: Error) => {
      console.error("Port forward error:", e);
      resolve(err("port_forward_error", `Port forward error: ${e}`, e));
    });

    process.on("SIGINT", () => {
      console.log("\nStopping port forward...");
      server.close();
      resolve(ok(undefined));
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      console.log("\nStopping port forward...");
      server.close();
      resolve(ok(undefined));
      process.exit(0);
    });
  });
}
