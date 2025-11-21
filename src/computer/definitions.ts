import * as k8s from "@kubernetes/client-node";
import { podName, volumeName } from "../lib/k8s";

export const COMPUTER_IMAGE = "agent-computer:base";
export const DEFAULT_WORKDIR = "/home/agent";

export function defineComputerLabels(workspaceId: string, computerId: string) {
  return {
    app: "srchd",
    workspace: workspaceId,
    computer: computerId,
    "srchd.io/workspace": workspaceId,
    "srchd.io/computer": computerId,
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
      name: volumeName(workspaceId, computerId),
      labels: defineComputerLabels(workspaceId, computerId),
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
      labels: defineComputerLabels(workspaceId, computerId),
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
            claimName: volumeName(workspaceId, computerId),
          },
        },
      ],
    },
  };
}
