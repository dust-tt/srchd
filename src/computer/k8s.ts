import { podName } from "@app/lib/k8s";
import { ensure, k8sApi } from "@app/lib/k8s";
import { Result } from "@app/lib/error";
import { defineComputerPod } from "./definitions";

export async function ensureComputerPod(
  namespace: string,
  computerId: string,
): Promise<Result<void>> {
  const name = podName(namespace, computerId);
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPod({
        namespace,
        name,
      });
    },
    async () => {
      await k8sApi.createNamespacedPod({
        namespace,
        body: defineComputerPod(namespace, computerId),
      });
    },
    "Pod",
    name,
  );
}
