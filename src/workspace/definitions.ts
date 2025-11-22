import * as k8s from "@kubernetes/client-node";
import { ApiKeys } from ".";
import {
  namespaceLabels,
  podName,
  serviceAccountName,
  serviceName,
  volumeName,
} from "../lib/k8s";

const SRCHD_IMAGE = "srchd:latest";

export function defineServerService(workspaceId: string): k8s.V1Service {
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: {
      name: serviceName(workspaceId),
      namespace: workspaceId,
      labels: namespaceLabels(workspaceId),
    },
    spec: {
      selector: {
        ...namespaceLabels(workspaceId),
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
  workspaceId: string,
): k8s.V1PersistentVolumeClaim {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: volumeName(workspaceId),
      namespace: workspaceId,
      labels: namespaceLabels(workspaceId),
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
  workspaceId: string,
  apiKeys: ApiKeys,
): k8s.V1Pod {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: podName(workspaceId),
      namespace: workspaceId,
      labels: {
        ...namespaceLabels(workspaceId),
        "srchd.io/type": "server",
      },
    },
    spec: {
      serviceAccountName: serviceAccountName(workspaceId),
      restartPolicy: "Always",
      containers: [
        {
          name: "srchd",
          image: SRCHD_IMAGE,
          imagePullPolicy: "IfNotPresent",
          env: defineServerEnv(workspaceId, apiKeys),
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
            claimName: volumeName(workspaceId),
          },
        },
      ],
    },
  };
}

export function defineServerEnv(
  workspaceId: string,
  apiKeys: ApiKeys,
): k8s.V1EnvVar[] {
  // Prepare environment variables
  const env: k8s.V1EnvVar[] = [
    { name: "NAMESPACE", value: workspaceId },
    { name: "WORKSPACE_ID", value: workspaceId },
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
