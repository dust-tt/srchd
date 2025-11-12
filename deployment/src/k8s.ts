import { SrchdError } from "@app/lib/error";
import {
  defineServerService,
  defineServerPod,
  defineServerVolume,
  serviceName,
  volumeName,
  rbacApi,
  roleName,
  defineRole,
  roleBindingName,
  defineRoleBinding,
  serviceAccountName,
  defineServiceAccount,
} from "./definitions";
import { ApiKeys } from ".";
import { Result } from "@app/lib/result";
import { ensure, k8sApi, podName } from "@app/lib/k8s";

export async function ensureServiceAccount(
  namespace: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await k8sApi.readNamespacedServiceAccount({
        name: serviceAccountName(namespace),
        namespace,
      });
    },
    async () => {
      await k8sApi.createNamespacedServiceAccount({
        namespace,
        body: defineServiceAccount(namespace),
      });
    },
    "ServiceAccount",
    serviceAccountName(namespace),
  );
}

export async function ensureRole(
  namespace: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await rbacApi.readNamespacedRole({
        name: roleName(namespace),
        namespace,
      });
    },
    async () => {
      await rbacApi.createNamespacedRole({
        namespace,
        body: defineRole(namespace),
      });
    },
    "Role",
    roleName(namespace),
  );
}

export async function ensureRoleBinding(
  namespace: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await rbacApi.readNamespacedRoleBinding({
        name: roleBindingName(namespace),
        namespace,
      });
    },
    async () => {
      await rbacApi.createNamespacedRoleBinding({
        namespace,
        body: defineRoleBinding(namespace),
      });
    },
    "RoleBinding",
    roleBindingName(namespace),
  );
}

export async function ensureService(
  deploymentId: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await k8sApi.readNamespacedService({
        name: serviceName(deploymentId),
        namespace: deploymentId,
      });
    },
    async () => {
      await k8sApi.createNamespacedService({
        namespace: deploymentId,
        body: defineServerService(deploymentId),
      });
    },
    "Service",
    serviceName(deploymentId),
  );
}

export async function ensureServerPod(
  deploymentId: string,
  apiKeys: ApiKeys,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPod({
        name: podName(deploymentId),
        namespace: deploymentId,
      });
    },
    async () => {
      await k8sApi.createNamespacedPod({
        namespace: deploymentId,
        body: defineServerPod(deploymentId, apiKeys),
      });
    },
    "Pod",
    podName(deploymentId),
  );
}

export async function ensureServerVolume(
  deploymentId: string,
): Promise<Result<void, SrchdError>> {
  const name = volumeName(deploymentId);
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPersistentVolumeClaim({
        name,
        namespace: deploymentId,
      });
    },
    async () => {
      await k8sApi.createNamespacedPersistentVolumeClaim({
        namespace: deploymentId,
        body: defineServerVolume(deploymentId),
      });
    },
    "PVC",
    name,
  );
}
