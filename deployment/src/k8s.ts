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
  namespace: string,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await k8sApi.readNamespacedService({
        name: serviceName(namespace),
        namespace,
      });
    },
    async () => {
      await k8sApi.createNamespacedService({
        namespace,
        body: defineServerService(namespace),
      });
    },
    "Service",
    serviceName(namespace),
  );
}

export async function ensureServerPod(
  namespace: string,
  apiKeys: ApiKeys,
): Promise<Result<void, SrchdError>> {
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPod({
        name: podName(namespace),
        namespace,
      });
    },
    async () => {
      await k8sApi.createNamespacedPod({
        namespace,
        body: defineServerPod(namespace, apiKeys),
      });
    },
    "Pod",
    podName(namespace),
  );
}

export async function ensureServerVolume(
  namespace: string,
): Promise<Result<void, SrchdError>> {
  const name = volumeName(namespace);
  return await ensure(
    async () => {
      await k8sApi.readNamespacedPersistentVolumeClaim({
        name,
        namespace,
      });
    },
    async () => {
      await k8sApi.createNamespacedPersistentVolumeClaim({
        namespace,
        body: defineServerVolume(namespace),
      });
    },
    "PVC",
    name,
  );
}
