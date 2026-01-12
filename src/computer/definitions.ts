import * as k8s from "@kubernetes/client-node";
import { podName } from "@app/lib/k8s";
import { Env } from "@app/agent_profile";
import { isString } from "@app/lib/utils";

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

// Returns hostPath directory for agent work
export function computerHostPath(namespace: string, computerId: string): string {
  // Use project-local volumes directory for single-node setups (minikube/docker desktop)
  return `${process.cwd()}/volumes/${namespace}/${computerId}`;
}

export function defineComputerPod(
  namespace: string,
  computerId: string,
  imageName?: string,
  env: Env[] = [],
): k8s.V1Pod {
  return {
    metadata: {
      name: podName(namespace, computerId),
      labels: defineComputerLabels(namespace, computerId),
    },
    spec: {
      restartPolicy: "Never",
      initContainers: [
        {
          name: "init-home",
          image: imageName ?? COMPUTER_IMAGE,
          command: ["/bin/bash", "-c"],
          args: [
            // Copy /home/agent skeleton to PVC on first mount
            // Mount PVC at /mnt/work to avoid shadowing /home/agent
            `if [ ! -f /mnt/work/.initialized ]; then
              cp -a /home/agent/. /mnt/work/ 2>/dev/null || true
              touch /mnt/work/.initialized
            fi`,
          ],
          volumeMounts: [
            {
              name: "work",
              mountPath: "/mnt/work",
            },
          ],
        },
      ],
      containers: [
        {
          name: "computer",
          env: defineComputerEnv(namespace, env),
          image: imageName ?? COMPUTER_IMAGE,
          command: ["/bin/bash", "-c", "tail -f /dev/null"],
          volumeMounts: [
            {
              name: "work",
              mountPath: DEFAULT_WORKDIR,
            },
          ],
        },
      ],
      volumes: [
        {
          name: "work",
          hostPath: {
            path: computerHostPath(namespace, computerId),
            type: "DirectoryOrCreate",
          },
        },
      ],
    },
  };
}

export function defineComputerEnv(
  namespace: string,
  env: Env[] = [],
): k8s.V1EnvVar[] {
  // Prepare environment variables
  const envVar: k8s.V1EnvVar[] = [{ name: "NAMESPACE", value: namespace }];

  for (const e of env) {
    if (isString(e)) {
      if (process.env[e]) {
        envVar.push({ name: e, value: process.env[e] });
      } else {
        console.warn(`Environment variable ${e} not found. Skipping.`);
      }
    } else {
      envVar.push({ name: e[0], value: e[1] });
    }
  }

  if (process.env.OPENAI_API_KEY) {
    envVar.push({
      name: "OPENAI_API_KEY",
      value: process.env.OPENAI_API_KEY,
    });
  }

  return envVar;
}
