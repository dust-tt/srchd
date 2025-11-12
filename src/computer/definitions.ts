import * as k8s from "@kubernetes/client-node";

export const COMPUTER_IMAGE = "agent-computer:base";
export const DEFAULT_WORKDIR = "/home/agent";

export const podName = (instanceId: string, computerId: string) =>
  `srchd-${instanceId}-${computerId}`;

export const pvcName = (instanceId: string, computerId: string) =>
  `srchd-${instanceId}-${computerId}-pvc`;

export function podLabels(instanceId: string, computerId: string) {
  return {
    app: "srchd",
    instance: instanceId,
    computer: computerId,
    "srchd.io/instance": instanceId,
    "srchd.io/computer": computerId,
  };
}

export function namespaceLabels(instanceId: string) {
  return {
    app: "srchd",
    instance: instanceId,
    "srchd.io/instance": instanceId,
  };
}

export function defineNamespace(instanceId: string): k8s.V1Namespace {
  return {
    metadata: {
      name: instanceId,
      labels: namespaceLabels(instanceId),
    },
  };
}

export function definePVC(
  instanceId: string,
  computerId: string,
): k8s.V1PersistentVolumeClaim {
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: pvcName(instanceId, computerId),
      labels: podLabels(instanceId, computerId),
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

export function definePod(instanceId: string, computerId: string): k8s.V1Pod {
  return {
    metadata: {
      name: podName(instanceId, computerId),
      labels: podLabels(instanceId, computerId),
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
          persistentVolumeClaim: { claimName: pvcName(instanceId, computerId) },
        },
      ],
    },
  };
}
