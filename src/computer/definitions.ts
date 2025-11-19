import * as k8s from "@kubernetes/client-node";

export const COMPUTER_IMAGE = "agent-computer:base";
export const DEFAULT_WORKDIR = "/home/agent";

export const podName = (workspaceId: string, computerId: string) =>
  `srchd-${workspaceId}-${computerId}`;

export const pvcName = (workspaceId: string, computerId: string) =>
  `srchd-${workspaceId}-${computerId}-pvc`;

export function podLabels(workspaceId: string, computerId: string) {
  return {
    app: "srchd",
    instance: workspaceId,
    computer: computerId,
    "srchd.io/instance": workspaceId,
    "srchd.io/computer": computerId,
  };
}

export function namespaceLabels(workspaceId: string) {
  return {
    app: "srchd",
    instance: workspaceId,
    "srchd.io/instance": workspaceId,
  };
}

export function defineNamespace(workspaceId: string): k8s.V1Namespace {
  return {
    metadata: {
      name: workspaceId,
      labels: namespaceLabels(workspaceId),
    },
  };
}

export function defineComputerVolume(
  workspaceId: string,
  computerId: string,
): k8s.V1PersistentVolumeClaim {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: pvcName(workspaceId, computerId),
      labels: podLabels(workspaceId, computerId),
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      resources: {
        requests: {
          storage: "1Gi",
        },
      },
    },
  };
}

export function defineComputerPod(
  workspaceId: string,
  computerId: string,
): k8s.V1Pod {
  return {
    metadata: {
      name: podName(workspaceId, computerId),
      labels: podLabels(workspaceId, computerId),
    },
    spec: {
      restartPolicy: "Never",
      containers: [
        {
          name: "computer",
          image: COMPUTER_IMAGE,
          command: ["/bin/bash", "-c", "tail -f /dev/null"],
          volumeMounts: [{ name: "workspace", mountPath: DEFAULT_WORKDIR }],
        },
      ],
      volumes: [
        {
          name: "workspace",
          persistentVolumeClaim: {
            claimName: pvcName(workspaceId, computerId),
          },
        },
      ],
    },
  };
}
