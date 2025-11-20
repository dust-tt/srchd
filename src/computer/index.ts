import { Err, Ok, Result } from "../lib/result";
import { normalizeError, SrchdError, withRetries } from "../lib/error";
import {
  K8S_NAMESPACE,
  k8sApi,
  ensureNamespace,
  ensurePodRunning,
} from "../lib/k8s";
import { ExperimentResource } from "../resources/experiment";
import { AgentResource } from "../resources/agent";
import { podName, volumeName } from "../lib/k8s";
import { ensureComputerPod, ensureComputerVolume, computerExec } from "./k8s";
import { DEFAULT_WORKDIR } from "./definitions";

export function computerId(
  experiment: ExperimentResource,
  agent: AgentResource,
) {
  return `${experiment.toJSON().name}-${agent.toJSON().name}`;
}

export class Computer {
  private workspaceId: string;
  private computerId: string;
  private podName: string;

  private constructor(workspaceId: string, computerId: string) {
    this.workspaceId = workspaceId;
    this.computerId = computerId;
    this.podName = podName(workspaceId, computerId);
  }

  static async create(
    computerId: string,
    workspaceId: string = K8S_NAMESPACE,
  ): Promise<Result<Computer, SrchdError>> {
    let res = await ensureNamespace(workspaceId);
    if (res.isErr()) {
      return res;
    }
    res = await ensureComputerVolume(workspaceId, computerId);
    if (res.isErr()) {
      return res;
    }
    res = await ensureComputerPod(workspaceId, computerId);
    if (res.isErr()) {
      return res;
    }

    res = await ensurePodRunning(workspaceId, computerId);
    if (res.isErr()) {
      return res;
    }

    return new Ok(new Computer(workspaceId, computerId));
  }

  static async findById(
    computerId: string,
    workspaceId: string = K8S_NAMESPACE,
  ): Promise<Computer | null> {
    const name = podName(workspaceId, computerId);
    try {
      await k8sApi.readNamespacedPod({ name, namespace: workspaceId });
      return new Computer(workspaceId, computerId);
    } catch (_err) {
      return null;
    }
  }

  static async ensure(
    computerId: string,
    workspaceId: string = K8S_NAMESPACE,
  ): Promise<Result<Computer, SrchdError>> {
    const c = await Computer.findById(computerId, workspaceId);
    if (c) {
      const status = await c.status();
      if (status !== "Running") {
        // Pod is not running, recreate it
        await c.terminate(false);
        return Computer.create(computerId, workspaceId);
      }
      return new Ok(c);
    }
    return Computer.create(computerId, workspaceId);
  }

  static async listComputerIds(
    workspaceId: string = K8S_NAMESPACE,
  ): Promise<Result<string[], SrchdError>> {
    try {
      const response = await k8sApi.listNamespacedPod({
        namespace: workspaceId,
        labelSelector: `srchd.io/workspace=${workspaceId}`,
      });

      const computerIds = response.items
        .map((pod: any) => pod.metadata?.labels?.["srchd.io/computer"])
        .filter((id: any): id is string => !!id);

      return new Ok(computerIds);
    } catch (err) {
      const error = normalizeError(err);
      return new Err(
        new SrchdError("computer_run_error", "Failed to list computers", error),
      );
    }
  }

  async status(): Promise<string> {
    try {
      const pod = await k8sApi.readNamespacedPod({
        name: this.podName,
        namespace: this.workspaceId,
      });
      return pod.status?.phase ?? "Unknown";
    } catch (_err) {
      return "NotFound";
    }
  }

  async terminate(deleteVolume = true): Promise<Result<boolean, SrchdError>> {
    const pvc = volumeName(this.workspaceId, this.computerId);

    try {
      // Delete pod
      try {
        await k8sApi.deleteNamespacedPod({
          name: this.podName,
          namespace: this.workspaceId,
          gracePeriodSeconds: 0,
        });
      } catch (_err) {
        // ignore if pod doesn't exist
      }

      const waitForDeletion = withRetries(
        async (): Promise<Result<void, SrchdError>> => {
          try {
            await k8sApi.readNamespacedPod({
              name: this.podName,
              namespace: this.workspaceId,
            });
          } catch (err: any) {
            if (err.code === 404) {
              return new Ok(undefined);
            }
          }
          return new Err(
            new SrchdError("pod_deletion_error", "Pod not yet deleted..."),
          );
        },
      );

      const deleted = await waitForDeletion(undefined);
      if (deleted.isErr()) {
        return deleted;
      }

      if (deleteVolume) {
        try {
          await k8sApi.deleteNamespacedPersistentVolumeClaim({
            name: pvc,
            namespace: this.workspaceId,
          });
        } catch (_err) {
          // ignore if PVC doesn't exist
        }
      }

      return new Ok(true);
    } catch (err) {
      const error = normalizeError(err);
      return new Err(
        new SrchdError(
          "computer_run_error",
          "Failed to terminate computer",
          error,
        ),
      );
    }
  }

  async execute(
    cmd: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<
    Result<
      {
        exitCode: number;
        stdout: string;
        stderr: string;
        durationMs: number;
      },
      SrchdError
    >
  > {
    const cwd = options?.cwd ?? DEFAULT_WORKDIR;

    const startTs = Date.now();

    // Build the command with environment variables and working directory
    let fullCmd = "";
    if (options?.env) {
      const envVars = Object.entries(options.env)
        .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
        .join("; ");
      fullCmd += envVars + "; ";
    }
    fullCmd += `cd "${cwd.replace(/"/g, '\\"')}" && ${cmd}`;

    const execPromise = computerExec(
      ["/bin/bash", "-lc", fullCmd],
      this.workspaceId,
      this.computerId,
      options?.timeoutMs,
    );
    const res = await execPromise;
    if (res.isErr()) {
      return res;
    } else {
      return new Ok({
        ...res.value,
        durationMs: Date.now() - startTs,
      });
    }
  }
}
