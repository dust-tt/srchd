import { podName } from "../lib/k8s";
import { ensure, k8sApi } from "../lib/k8s";
import { Result } from "../lib/result";
import { SrchdError } from "../lib/error";
import { defineComputerPod } from "./definitions";

export async function ensureComputerPod(
  namespace: string,
  computerId: string,
): Promise<Result<void, SrchdError>> {
  const name = podName(namespace, computerId);
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPod({
        namespace: namespace,
        name,
      });
    },
    async () => {
      await k8sApi.createNamespacedPod({
        namespace: namespace,
        body: defineComputerPod(namespace, computerId),
      });
    },
    "Pod",
    name,
  );
}
