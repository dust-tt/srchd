import { podName, volumeName } from "../lib/k8s";
import { ensure, k8sApi } from "../lib/k8s";
import { Result } from "../lib/result";
import { SrchdError } from "../lib/error";
import { defineComputerPod, defineComputerVolume } from "./definitions";

export async function ensureComputerVolume(
  workspaceId: string,
  computerId: string,
): Promise<Result<void, SrchdError>> {
  const name = volumeName(workspaceId, computerId);
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
