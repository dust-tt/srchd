import * as k8s from "@kubernetes/client-node";
import * as net from "net";
import { Err, Ok, Result } from "@app/lib/result";
import { SrchdError } from "@app/lib/error";
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
  deploymentId: string,
  apiKeys: ApiKeys,
): Promise<Result<void, SrchdError>> {
  let res = await ensureNamespace(deploymentId);
  if (res.isErr()) {
    return res;
  }
  // Create RBAC resources
  res = await ensureServiceAccount(deploymentId);
  if (res.isErr()) {
    return res;
  }
  res = await ensureRole(deploymentId);
  if (res.isErr()) {
    return res;
  }
  res = await ensureRoleBinding(deploymentId);
  if (res.isErr()) {
    return res;
  }

  // Create Pod resources
  res = await ensureServerVolume(deploymentId);
  if (res.isErr()) {
    return res;
  }
  res = await ensureServerPod(deploymentId, apiKeys);
  if (res.isErr()) {
    return res;
  }
  res = await ensureService(deploymentId);
  if (res.isErr()) {
    return res;
  }

  console.log(`\nWaiting for pod to be ready...`);
  res = await ensurePodRunning(deploymentId);

  if (res.isOk()) {
    console.log(`✓ Pod is ready and running`);
  } else {
    console.log(
      `⚠ Pod may not be ready yet, check with: kubectl get pod ${podName(deploymentId)} -n ${deploymentId}`,
    );
  }
  return res;
}

export async function deleteDeployment(
  deploymentId: string,
): Promise<Result<void, SrchdError>> {
  try {
    const pods = await k8sApi.listNamespacedPod({
      namespace: deploymentId,
    });

    // Delete all associated computers with it.
    for (const pod of pods.items.filter((p) => p.metadata?.name)) {
      await k8sApi.deleteNamespacedPod({
        name: pod.metadata!.name!,
        namespace: deploymentId,
        gracePeriodSeconds: 0,
      });
    }

    await k8sApi.deleteNamespace({
      name: deploymentId,
    });
    return new Ok(undefined);
  } catch (err: any) {
    return new Err(
      new SrchdError(
        "namespace_deletion_error",
        `Failed to delete namespace: ${deploymentId}`,
        err,
      ),
    );
  }
}

export async function listComputers(
  deploymentId: string,
): Promise<k8s.V1Pod[]> {
  const pods = await k8sApi.listNamespacedPod({
    namespace: deploymentId,
  });

  return pods.items.filter((pod) => pod.metadata?.labels?.computer);
}

export async function listDeployments(): Promise<k8s.V1Pod[]> {
  const instances = await k8sApi.listPodForAllNamespaces({});
  return instances.items.filter(
    (i) =>
      i.metadata?.labels?.app === "srchd" &&
      i.metadata?.labels["srchd.io/type"] === "server",
  );
}

export async function startPortForward(
  deploymentId: string,
  port: number,
): Promise<Result<void, SrchdError>> {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const forward = new k8s.PortForward(kc);

  const server = net
    .createServer((socket) => {
      forward.portForward(
        deploymentId,
        podName(deploymentId),
        [1337],
        socket,
        socket,
        socket,
      );
    })
    .listen(port);

  // Keep the process alive
  return new Promise((resolve) => {
    server.on("error", (err: Error) => {
      console.error("Port forward error:", err);
      resolve(
        new Err(
          new SrchdError("port_forward_error", `Port forward error: ${err}`),
        ),
      );
    });

    process.on("SIGINT", () => {
      console.log("\nStopping port forward...");
      server.close();
      resolve(new Ok(undefined));
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      console.log("\nStopping port forward...");
      server.close();
      resolve(new Ok(undefined));
      process.exit(0);
    });
  });
}
