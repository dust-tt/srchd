import { Err, Ok, Result } from "../lib/result";
import { normalizeError, SrchdError, withRetries } from "../lib/error";
import {
  INSTANCE_ID,
  ensurePVC,
  k8sApi,
  k8Exec,
  compErr,
  ensureNamespace,
  ensurePodRunning,
  ensurePod,
} from "./utils";
import { ExperimentResource } from "../resources/experiment";
import { AgentResource } from "../resources/agent";
import { DEFAULT_WORKDIR, podName, pvcName } from "./definitions";

export function computerId(
  experiment: ExperimentResource,
  agent: AgentResource,
) {
  return `${experiment.toJSON().name}-${agent.toJSON().name}`;
}

export class Computer {
  private instanceId: string;
  private computerId: string;
  private podName: string;

  private constructor(instanceId: string, computerId: string) {
    this.instanceId = instanceId;
    this.computerId = computerId;
    this.podName = podName(instanceId, computerId);
  }

  static async create(
    computerId: string,
    instanceId: string = INSTANCE_ID,
  ): Promise<Result<Computer, SrchdError>> {
    let res = await ensureNamespace(instanceId);
    if (res.isErr()) {
      return res;
    }
    res = await ensurePVC(instanceId, computerId);
    if (res.isErr()) {
      return res;
    }
    res = await ensurePod(instanceId, computerId);
    if (res.isErr()) {
      return res;
    }

    res = await ensurePodRunning(instanceId, computerId);
    if (res.isErr()) {
      return res;
    }

    return new Ok(new Computer(instanceId, computerId));
  }

  static async findById(
    computerId: string,
    instanceId: string = INSTANCE_ID,
  ): Promise<Computer | null> {
    const name = podName(instanceId, computerId);
    try {
      await k8sApi.readNamespacedPod({ name, namespace: instanceId });
      return new Computer(instanceId, computerId);
    } catch (_err) {
      return null;
    }
  }

  static async ensure(
    computerId: string,
    instanceId: string = INSTANCE_ID,
  ): Promise<Result<Computer, SrchdError>> {
    const c = await Computer.findById(computerId, instanceId);
    if (c) {
      const status = await c.status();
      if (status !== "Running") {
        // Pod is not running, recreate it
        await c.terminate(false);
        return Computer.create(computerId, instanceId);
      }
      return new Ok(c);
    }
    return Computer.create(computerId, instanceId);
  }

  static async listComputerIds(
    instanceId: string = INSTANCE_ID,
  ): Promise<Result<string[], SrchdError>> {
    try {
      const response = await k8sApi.listNamespacedPod({
        namespace: instanceId,
        labelSelector: `srchd.io/instance=${instanceId}`,
      });

      const computerIds = response.items
        .map((pod: any) => pod.metadata?.labels?.["srchd.io/computer"])
        .filter((id: any): id is string => !!id);

      return new Ok(computerIds);
    } catch (err) {
      const error = normalizeError(err);
      return compErr("Failed to list computers", error);
    }
  }

  async status(): Promise<string> {
    try {
      const pod = await k8sApi.readNamespacedPod({
        name: this.podName,
        namespace: this.instanceId,
      });
      return pod.status?.phase ?? "Unknown";
    } catch (_err) {
      return "NotFound";
    }
  }

  async terminate(deletePVC = true): Promise<Result<boolean, SrchdError>> {
    const pvc = pvcName(this.instanceId, this.computerId);

    try {
      // Delete pod
      try {
        await k8sApi.deleteNamespacedPod({
          name: this.podName,
          namespace: this.instanceId,
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
              namespace: this.instanceId,
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

      if (deletePVC) {
        try {
          await k8sApi.deleteNamespacedPersistentVolumeClaim({
            name: pvc,
            namespace: this.instanceId,
          });
        } catch (_err) {
          // ignore if PVC doesn't exist
        }
      }

      return new Ok(true);
    } catch (err) {
      const error = normalizeError(err);
      return compErr("Failed to terminate computer", error);
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

    const execPromise = k8Exec(
      ["/bin/bash", "-lc", fullCmd],
      this.podName,
      this.instanceId,
      {
        timeoutMs: options?.timeoutMs,
      },
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
