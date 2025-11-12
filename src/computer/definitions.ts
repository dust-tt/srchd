import * as k8s from "@kubernetes/client-node";
import { podName } from "../lib/k8s";

export const COMPUTER_IMAGE = "agent-computer:base";
export const DEFAULT_WORKDIR = "/home/agent";

export function defineComputerLabels(namespace: string, computerId: string) {
  return {
    app: "srchd",
    namespace: namespace,
    computer: computerId,
    "srchd.io/namespace": namespace,
    "srchd.io/computer": computerId,
  };
}

export function defineComputerPod(
  namespace: string,
  computerId: string,
): k8s.V1Pod {
  return {
    metadata: {
      name: podName(namespace, computerId),
      labels: defineComputerLabels(namespace, computerId),
    },
    spec: {
      restartPolicy: "Never",
      containers: [
        {
          name: "computer",
          image: COMPUTER_IMAGE,
          command: ["/bin/bash", "-c", "tail -f /dev/null"],
        },
      ],
    },
  };
}
