import * as k8s from "@kubernetes/client-node";
import { podName } from "@app/lib/k8s";

export const COMPUTER_IMAGE = "agent-computer:base";
export const DEFAULT_WORKDIR = "/home/agent";

export function defineComputerLabels(namespace: string, computerId: string) {
  return {
    app: "srchd",
    namespace,
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

export function defineComputerEnv(workspaceId: string): k8s.V1EnvVar[] {
  // Prepare environment variables
  const env: k8s.V1EnvVar[] = [
    { name: "NAMESPACE", value: workspaceId },
    { name: "WORKSPACE_ID", value: workspaceId },
  ];

  if (process.env.OPENAI_API_KEY) {
    env.push({
      name: "OPENAI_API_KEY",
      value: process.env.OPENAI_API_KEY,
    });
  }

  return env;
}
