import * as k8s from "@kubernetes/client-node";
import { podName } from "../lib/k8s";

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
        },
      ],
    },
  };
}
