import { SrchdError } from "../lib/error";
import {
  defineServerService,
  defineServerPod,
  defineServerVolume,
} from "./definitions";
import { ApiKeys } from ".";
import { Result } from "../lib/result";
import { ensure, k8sApi, podName, serviceName, volumeName } from "../lib/k8s";

export async function ensureService(
  workspaceId: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await k8sApi.readNamespacedService({
        name: serviceName(workspaceId),
        namespace: workspaceId,
      });
    },
    async () => {
      await k8sApi.createNamespacedService({
        namespace: workspaceId,
        body: defineServerService(workspaceId),
      });
    },
    "Service",
    serviceName(workspaceId),
  );
}

export async function ensureServerPod(
  workspaceId: string,
  apiKeys: ApiKeys,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPod({
        name: podName(workspaceId),
        namespace: workspaceId,
      });
    },
    async () => {
      await k8sApi.createNamespacedPod({
        namespace: workspaceId,
        body: defineServerPod(workspaceId, apiKeys),
      });
    },
    "Pod",
    podName(workspaceId),
  );
}

export async function ensureServerVolume(
  workspaceId: string,
): Promise<Result<void, SrchdError>> {
  const name = volumeName(workspaceId);
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
        body: defineServerVolume(workspaceId),
      });
    },
    "PVC",
    name,
  );
}
