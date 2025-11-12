import * as k8s from "@kubernetes/client-node";
import { ApiKeys } from ".";
import { kc, namespaceLabels, podName } from "@app/lib/k8s";

export const SRCHD_IMAGE = "srchd:latest";
export const rbacApi = kc.makeApiClient(k8s.RbacAuthorizationV1Api);
export const volumeName = (namespace: string) => `srchd-${namespace}-pvc`;
export const serviceName = (namespace: string) => `srchd-${namespace}`;
export const serviceAccountName = (namespace: string) => `srchd-${namespace}`;
export const roleName = (namespace: string) => `srchd-${namespace}`;
export const roleBindingName = (namespace: string) => `srchd-${namespace}`;

export function defineRole(namespace: string): k8s.V1Role {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "Role",
    metadata: {
      name: roleName(namespace),
      namespace,
      labels: namespaceLabels(namespace),
    },
    rules: [
      {
        apiGroups: [""],
        resources: ["pods", "pods/log", "pods/exec"],
        verbs: ["get", "list", "create", "delete", "watch"],
      },
      {
        apiGroups: [""],
        resources: ["persistentvolumeclaims"],
        verbs: ["get", "list", "create", "delete"],
      },
      {
        apiGroups: [""],
        resources: ["namespaces"],
        verbs: ["get", "list", "create", "delete"],
      },
    ],
  };
}

export function defineRoleBinding(namespace: string): k8s.V1RoleBinding {
  return {
    apiVersion: "rbac.authorization.k8s.io/v1",
    kind: "RoleBinding",
    metadata: {
      name: roleBindingName(namespace),
      namespace,
      labels: namespaceLabels(namespace),
    },
    subjects: [
      {
        kind: "ServiceAccount",
        name: serviceAccountName(namespace),
        namespace,
      },
    ],
    roleRef: {
      kind: "Role",
      name: roleName(namespace),
      apiGroup: "rbac.authorization.k8s.io",
    },
  };
}

export function defineServiceAccount(namespace: string): k8s.V1ServiceAccount {
  return {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      name: serviceAccountName(namespace),
      namespace,
      labels: namespaceLabels(namespace),
    },
  };
}

export function defineServerService(deploymentId: string): k8s.V1Service {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: serviceName(deploymentId),
      namespace: deploymentId,
      labels: namespaceLabels(deploymentId),
    },
    spec: {
      selector: {
        ...namespaceLabels(deploymentId),
        "srchd.io/type": "server",
      },
      ports: [
        {
          port: 1337,
          targetPort: 1337,
          name: "http",
        },
      ],
      type: "ClusterIP",
    },
  };
}

export function defineServerVolume(
  deploymentId: string,
): k8s.V1PersistentVolumeClaim {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: volumeName(deploymentId),
      namespace: deploymentId,
      labels: namespaceLabels(deploymentId),
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: "5Gi",
        },
      },
    },
  };
}

export function defineServerPod(
  deploymentId: string,
  apiKeys: ApiKeys,
): k8s.V1Pod {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: podName(deploymentId),
      namespace: deploymentId,
      labels: {
        ...namespaceLabels(deploymentId),
        "srchd.io/type": "server",
      },
    },
    spec: {
      serviceAccountName: serviceAccountName(deploymentId),
      restartPolicy: "Always",
      containers: [
        {
          name: "srchd",
          image: SRCHD_IMAGE,
          imagePullPolicy: "IfNotPresent",
          env: defineServerEnv(deploymentId, apiKeys),
          ports: [
            {
              containerPort: 1337,
              name: "http",
            },
          ],
          volumeMounts: [
            {
              name: "data",
              mountPath: "/data",
            },
          ],
        },
      ],
      volumes: [
        {
          name: "data",
          persistentVolumeClaim: {
            claimName: volumeName(deploymentId),
          },
        },
      ],
    },
  };
}

export function defineServerEnv(
  deploymentId: string,
  apiKeys: ApiKeys,
): k8s.V1EnvVar[] {
  // Prepare environment variables
  const env: k8s.V1EnvVar[] = [
    { name: "NAMESPACE", value: deploymentId },
    { name: "DEPLOYMENT_ID", value: deploymentId },
    { name: "DATABASE_PATH", value: "/data/db.sqlite" },
  ];

  // Add API keys if provided
  if (apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY) {
    env.push({
      name: "ANTHROPIC_API_KEY",
      value: apiKeys?.anthropic ?? process.env.ANTHROPIC_API_KEY,
    });
  }
  if (apiKeys?.openai || process.env.OPENAI_API_KEY) {
    env.push({
      name: "OPENAI_API_KEY",
      value: apiKeys?.openai ?? process.env.OPENAI_API_KEY,
    });
  }
  if (apiKeys?.google || process.env.GOOGLE_API_KEY) {
    env.push({
      name: "GOOGLE_API_KEY",
      value: apiKeys?.google ?? process.env.GOOGLE_API_KEY,
    });
  }
  if (apiKeys?.mistral || process.env.MISTRAL_API_KEY) {
    env.push({
      name: "MISTRAL_API_KEY",
      value: apiKeys?.mistral ?? process.env.MISTRAL_API_KEY,
    });
  }
  if (apiKeys?.firecrawl || process.env.FIRECRAWL_API_KEY) {
    env.push({
      name: "FIRECRAWL_API_KEY",
      value: apiKeys?.firecrawl ?? process.env.FIRECRAWL_API_KEY,
    });
  }

  return env;
}
