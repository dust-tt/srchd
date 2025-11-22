import * as k8s from "@kubernetes/client-node";
import * as net from "net";
import { Err, Ok, Result } from "../lib/result";
import { SrchdError } from "../lib/error";
import { ensureService, ensureServerPod, ensureServerVolume } from "./k8s";
import path from "path";
import {
  ensureNamespace,
  ensurePodRunning,
  ensureRole,
  ensureRoleBinding,
  ensureServiceAccount,
  k8sApi,
  podName,
} from "../lib/k8s";

export const SRCHD_DOCKERFILE_PATH = path.join(__dirname, "../../Dockerfile");

export interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
  mistral?: string;
  firecrawl?: string;
}

export async function createWorkspace(
  workspaceId: string,
  apiKeys: ApiKeys,
): Promise<Result<void, SrchdError>> {
  let res = await ensureNamespace(workspaceId);
  if (res.isErr()) {
    return res;
  }
  // Create RBAC resources
  res = await ensureServiceAccount(workspaceId);
  if (res.isErr()) {
    return res;
  }
  res = await ensureRole(workspaceId);
  if (res.isErr()) {
    return res;
  }
  res = await ensureRoleBinding(workspaceId);
  if (res.isErr()) {
    return res;
  }

  // Create Pod resources
  res = await ensureServerVolume(workspaceId);
  if (res.isErr()) {
    return res;
  }
  res = await ensureServerPod(workspaceId, apiKeys);
  if (res.isErr()) {
    return res;
  }
  res = await ensureService(workspaceId);
  if (res.isErr()) {
    return res;
  }

  console.log(`\nWaiting for pod to be ready...`);
  res = await ensurePodRunning(workspaceId);

  if (res.isOk()) {
    console.log(`✓ Pod is ready and running`);
  } else {
    console.log(
      `⚠ Pod may not be ready yet, check with: kubectl get pod ${podName(workspaceId)} -n ${workspaceId}`,
    );
  }
  return res;
}

export async function deleteWorkspace(
  workspaceId: string,
): Promise<Result<void, SrchdError>> {
  try {
    const pods = await k8sApi.listNamespacedPod({
      namespace: workspaceId,
    });

    // Delete all associated computers with it.
    for (const pod of pods.items.filter((p) => p.metadata?.name)) {
      await k8sApi.deleteNamespacedPod({
        name: pod.metadata!.name!,
        namespace: workspaceId,
        gracePeriodSeconds: 0,
      });
    }

    await k8sApi.deleteNamespace({
      name: workspaceId,
    });
    return new Ok(undefined);
  } catch (err: any) {
    return new Err(
      new SrchdError(
        "namespace_deletion_error",
        `Failed to delete namespace: ${workspaceId}`,
        err,
      ),
    );
  }
}

export async function listComputers(workspaceId: string): Promise<k8s.V1Pod[]> {
  const pods = await k8sApi.listNamespacedPod({
    namespace: workspaceId,
  });

  return pods.items.filter((pod) => pod.metadata?.labels?.computer);
}

export async function listWorkspaces(): Promise<k8s.V1Pod[]> {
  const instances = await k8sApi.listPodForAllNamespaces({});
  return instances.items.filter(
    (i) =>
      i.metadata?.labels?.app === "srchd" &&
      i.metadata?.labels["srchd.io/type"] === "server",
  );
}

export async function startPortForward(
  workspaceId: string,
  port: number,
): Promise<Result<void, SrchdError>> {
  const kc = new k8s.KubeConfig();
  kc.loadFromDefault();
  const forward = new k8s.PortForward(kc);

  const server = net
    .createServer((socket) => {
      forward.portForward(
        workspaceId,
        podName(workspaceId),
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
