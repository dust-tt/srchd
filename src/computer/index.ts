import { withRetries, Result, err, ok } from "@app/lib/error";
import {
  K8S_NAMESPACE,
  k8sApi,
  ensureNamespace,
  ensurePodRunning,
} from "@app/lib/k8s";
import { ExperimentResource } from "@app/resources/experiment";
import { AgentResource } from "@app/resources/agent";
import { podName } from "@app/lib/k8s";
import { computerExec, ensureComputerPod } from "./k8s";
import { computerHostPath,
  DEFAULT_WORKDIR } from "./definitions";
import { AgentProfile,
  Env } from "@app/agent_profile";
import { rm } from "fs/promises";

export function computerId(
  experiment: ExperimentResource,
  agent: AgentResource,
) {
  return `${experiment.toJSON().name}-${agent.toJSON().name}`;
}

export class Computer {
  private namespace: string;
  private computerId: string;
  private podName: string;

  private constructor(namespace: string, computerId: string) {
    this.namespace = namespace;
    this.computerId = computerId;
    this.podName = podName(namespace, computerId);
  }

  static async create(
    computerId: string,
    namespace: string = K8S_NAMESPACE,
    imageName?: string,
    env: Env[] = [],
    skipPodCreation: boolean = false,
  ): Promise<Result<Computer>> {
    if (!skipPodCreation) {
      let res = await ensureNamespace(namespace);
      if (res.isErr()) {
        return res;
      }

      res = await ensureComputerPod(namespace, computerId, imageName, env);
      if (res.isErr()) {
        return res;
      }

      res = await ensurePodRunning(namespace, computerId);
      if (res.isErr()) {
        return res;
      }
    }

    return ok(new Computer(namespace, computerId));
  }

  static async findById(
    computerId: string,
    namespace: string = K8S_NAMESPACE,
  ): Promise<Computer | null> {
    const name = podName(namespace, computerId);
    try {
      await k8sApi.readNamespacedPod({ name, namespace });
      return new Computer(namespace, computerId);
    } catch (_err) {
      return null;
    }
  }

  static async ensure(
    computerId: string,
    namespace: string = K8S_NAMESPACE,
    profile: AgentProfile,
  ): Promise<Result<Computer>> {
    const c = await Computer.findById(computerId, namespace);
    if (c) {
      const status = await c.status();
      if (status !== "Running") {
        // Pod is not running, recreate it
        await c.terminate();
        return Computer.create(computerId, namespace, profile.imageName, profile.env);
      }
      return ok(c);
    }
    return Computer.create(computerId, namespace, profile.imageName, profile.env);
  }

  static async listComputerIds(
    namespace: string = K8S_NAMESPACE,
  ): Promise<Result<string[]>> {
    try {
      const response = await k8sApi.listNamespacedPod({
        namespace,
        labelSelector: `srchd.io/namespace=${namespace}`,
      });

      const computerIds = response.items
        .map((pod: any) => pod.metadata?.labels?.["srchd.io/computer"])
        .filter((id: any): id is string => !!id);

      return ok(computerIds);
    } catch (e) {
      return err("computer_run_error", "Failed to list computers", e);
    }
  }

  async status(): Promise<string> {
    try {
      const pod = await k8sApi.readNamespacedPod({
        name: this.podName,
        namespace: this.namespace,
      });
      return pod.status?.phase ?? "Unknown";
    } catch (_err) {
      return "NotFound";
    }
  }

  async terminate(deleteVolumes: boolean = false): Promise<Result<boolean>> {
    let podDoesNotExist = false;
    try {
      // Delete pod
      try {
        await k8sApi.deleteNamespacedPod({
          name: this.podName,
          namespace: this.namespace,
          gracePeriodSeconds: 0,
        });
      } catch (_err) {
        // ignore if pod doesn't exist
        console.log(`  Pod not found (may already be deleted)`);
        podDoesNotExist = true;
      }

      const waitForDeletion = withRetries(async (): Promise<Result<void>> => {
        try {
          await k8sApi.readNamespacedPod({
            name: this.podName,
            namespace: this.namespace,
          });
        } catch (err: any) {
          if (err.code === 404) {
            return ok(undefined);
          }
        }
        return err("pod_deletion_error", "Pod not yet deleted...");
      });

      const deleted = podDoesNotExist
        ? ok(undefined)
        : await waitForDeletion(undefined);
      if (deleted.isErr()) {
        return deleted;
      }

    } catch (e) {
      return err("computer_run_error", "Failed to terminate computer", e);
    }

    if (deleteVolumes) {
      const path = computerHostPath(this.namespace, this.computerId);
      try {
        console.log(`  Deleting volume: ${path}`);
        await rm(path, { recursive: true, force: true });
        console.log(`  Volume deleted successfully`);
      } catch (e: any) {
        return err("computer_run_error", "Failed to delete volume", e);
      }
    }

    return ok(true);
  }

  async execute(
    cmd: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<
    Result<{
      exitCode: number;
      stdout: string;
      stderr: string;
      durationMs: number;
    }>
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
      this.namespace,
      this.computerId,
      options?.timeoutMs,
    );
    const res = await execPromise;
    if (res.isErr()) {
      return res;
    } else {
      return ok({
        ...res.value,
        durationMs: Date.now() - startTs,
      });
    }
  }
}
