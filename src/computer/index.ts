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
import { AgentProfile,
  Env } from "@app/agent_profile";
import { spawn as k8sSpawn, ensureComputerPod, execute as k8sExecute, deleteComputerVolume } from "./k8s";
import { DEFAULT_WORKDIR } from "./definitions";
import { newProcess,
  Process,
  ProcessStatus } from "./process";

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
  private processes: Map<number, Process>;

  private constructor(namespace: string, computerId: string) {
    this.namespace = namespace;
    this.computerId = computerId;
    this.podName = podName(namespace, computerId);
    this.processes = new Map();
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
      console.log(`  Deleting PVC for computer: ${this.computerId}`);
      const deleteResult = await deleteComputerVolume(this.namespace, this.computerId);
      if (deleteResult.isErr()) {
        return deleteResult;
      }
      console.log(`  PVC deleted successfully`);
    }

    return ok(true);
  }

  async spawn(
    cmd: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      tty?: boolean;
    },
  ): Promise<
    Result<{
      exitCode?: number;
      stdout: string;
      stderr: string;
      durationMs: number;
      status: ProcessStatus;
      pid: number;
    }>
  > {
    const startTs = Date.now();
    const cwd = options?.cwd ?? DEFAULT_WORKDIR;
    const env = options?.env ?? {};
    const process = newProcess(cmd, cwd, env, options?.tty);

    // Build the command with environment variables and working directory
    // We wrap the command to capture the PID and output it to stderr with a marker
    let fullCmd = "";
    if (options?.env) {
      const envVars = Object.entries(env)
        .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
        .join("; ");
      fullCmd += envVars + "; ";
    }

    // Wrap in a subshell that runs the command in background, captures its PID, then waits
    const escapedCmd = cmd.replace(/'/g, "'\\''");
    const escapedCwd = cwd.replace(/'/g, "'\\''");
    fullCmd += `bash -c 'cd '\''${escapedCwd}'\'' && ${escapedCmd} & PID=$!; echo "SRCHD_PID:$PID" >&2; wait $PID'`;

    const res = await k8sSpawn(
      ["/bin/bash", "-lc", fullCmd],
      this.namespace,
      this.computerId,
      process,
      options?.tty ? undefined : options?.timeoutMs,
    );

    // Extract PID from stderr
    if (options?.tty) {
      // In tty stderr is redirected to stdout
      const stdoutContent = process.stdoutStream.read().toString();
      const pidMatch = stdoutContent.match(/SRCHD_PID:(\d+)/);
      if (pidMatch && pidMatch[1]) {
        process.pid = parseInt(pidMatch[1], 10);
      }
    } else {
      const stderrContent = process.stderrStream.read().toString();
      const pidMatch = stderrContent.match(/SRCHD_PID:(\d+)/);
      if (pidMatch && pidMatch[1]) {
        process.pid = parseInt(pidMatch[1], 10);
      }
    }

    this.processes.set(process.pid, process);

    if (res.isErr()) {
      return res;
    }

    const value = res.value;
    if (value.status === "running") {
      process.promise = value.process;
      return ok({
        ...process,
        durationMs: Date.now() - startTs,
      });
    } else {
      return ok({
        ...value,
        durationMs: Date.now() - startTs,
        pid: process.pid,
      });
    }
  }

  ps(): Result<Process[]> {
    if (Array.from(this.processes.values()).filter(p => p.status === "terminated").length > 5) {
      Array.from(this.processes.entries())
        .filter(([_, p]) => p.status === "terminated")
        .sort(([_, p1], [__, p2]) => p2.createdAt.getTime() - p1.createdAt.getTime())
        .map(([pid, _]) => pid).slice(0, 5).forEach((pid) => {
          this.processes.delete(pid);
        })
    }
    return ok(Array.from(this.processes.values()));
  }

  stdin(pid: number, data: string): Result<Process> {
    const process = this.processes.get(pid);
    if (!process) {
      return err("not_found_error", `Process ${pid} not found`);
    }
    if (process.stdinStream.isPaused()) {
      process.stdinStream.resume();
      process.stdinStream.write(data);
      process.stdinStream.pause();
    } else if (process.stdinStream.closed) {
      return err("computer_run_error", "Stdin stream is closed");
    }
    return ok(process);
  }

  stdout(pid: number): Result<Process> {
    const process = this.processes.get(pid);
    if (!process) {
      return err("not_found_error", `Process ${pid} not found`);
    }
    return ok(process);
  }

  async kill(pid: number, signal: string): Promise<Result<Process>> {
    const process = this.processes.get(pid);
    if (!process) {
      return err("not_found_error", `Process ${pid} not found`);
    }

    // Send signal to the process inside the container using its PID
    const res = await k8sExecute(
      ["/bin/bash", "-c", `kill -${signal} ${process.pid}`],
      this.namespace,
      this.computerId,
    );

    if (res.isErr()) {
      return res;
    } else if (res.value.exitCode !== 0) {
      return err("computer_run_error", `Failed to kill process ${pid}`, res.value);
    }

    return ok(process);
  }
}

export const COMPUTER_REGISTRY: Record<string, Computer> = {};
