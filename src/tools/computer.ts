import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgentResource } from "@app/resources/agent";
import { errorToCallToolResult } from "@app/lib/mcp";
import { ExperimentResource } from "@app/resources/experiment";
import { Computer, computerId } from "@app/computer";
import { COMPUTER_SERVER_NAME as SERVER_NAME } from "@app/tools/constants";
import { err } from "@app/lib/error";

const SERVER_VERSION = "0.1.0";

// Job management for background execution
interface Job {
  id: number;
  cmd: string;
  cwd: string;
  status: "running" | "completed" | "failed";
  exitCode?: number;
  stdout: string;
  stderr: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
}

class JobManager {
  private jobs: Map<number, Job> = new Map();
  private nextJobId = 1;

  createJob(cmd: string, cwd: string): Job {
    const job: Job = {
      id: this.nextJobId++,
      cmd,
      cwd,
      status: "running",
      stdout: "",
      stderr: "",
      startTime: new Date(),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  getJob(id: number): Job | undefined {
    return this.jobs.get(id);
  }

  listJobs(): Job[] {
    return Array.from(this.jobs.values());
  }

  updateJob(
    id: number,
    update: Partial<Pick<Job, "status" | "exitCode" | "stdout" | "stderr" | "endTime" | "durationMs">>,
  ): void {
    const job = this.jobs.get(id);
    if (job) {
      Object.assign(job, update);
    }
  }
}

// Store job managers per computer instance
const jobManagers = new Map<string, JobManager>();

function getJobManager(computerId: string): JobManager {
  if (!jobManagers.has(computerId)) {
    jobManagers.set(computerId, new JobManager());
  }
  return jobManagers.get(computerId)!;
}

export async function createComputerServer(
  experiment: ExperimentResource,
  agent: AgentResource,
): Promise<McpServer> {
  const server = new McpServer({
    name: SERVER_NAME,
    title: `Computer: Tools to interact with a computer (docker container).`,
    version: SERVER_VERSION,
  });

  server.tool(
    "execute",
    `\
Execute a bash command.

- \`stdout\` and \`stderr\` are truncated to 8196 characters.
- Run blocking commands as daemons using \`&\`.
- To search files use \`grep\` or \`rg\`.
- To read files, use multi-turn \`sed\`, \`awk\`, \`head\` or \`tail\` to limit the output (e.g. \`sed 1,100p largefile.txt\`).
- To edit files, use multi-turn \`sed\` commands or the > or >> operators.
- TUI or graphical applications are not supported.

If no timeout is specified and the command takes longer than 3 minutes, it will automatically be
backgrounded and a job ID will be returned. Use \`list_jobs\` and \`view_job\` to check on it.
If you specify a timeout_ms, the command will fail with an error if it exceeds that timeout.
`,
    {
      cmd: z.string().describe("The bash command to execute."),
      cwd: z
        .string()
        .optional()
        .describe("Current working directory. Defaults to `/home/agent`."),
      env: z.record(z.string()).optional().describe("Environment variables."),
      timeout_ms: z
        .number()
        .optional()
        .describe(
          "Timeout in milliseconds. If specified, command will error on timeout. If not specified, commands exceeding 3 minutes are automatically backgrounded.",
        ),
    },
    async ({ cmd, cwd, env, timeout_ms: timeoutMs }) => {
      const cid = computerId(experiment, agent);
      const c = await Computer.ensure(cid);
      if (c.isErr()) {
        return errorToCallToolResult(
          err("computer_run_error", "Failed to access running computer"),
        );
      }

      console.log(`\x1b[90m${cmd}\x1b[0m`);

      const explicitTimeout = timeoutMs !== undefined;
      const AUTO_BACKGROUND_MS = 180000; // 3 minutes
      const MAX_BACKGROUND_MS = 3600000; // 1 hour max for backgrounded jobs

      if (explicitTimeout) {
        // Model specified a timeout - use it and error if exceeded
        const r = await c.value.execute(cmd, {
          cwd,
          env,
          timeoutMs,
        });

        if (r.isErr()) {
          return errorToCallToolResult(r);
        }

        const stdout =
          r.value.stdout.slice(0, 8196) +
          (r.value.stdout.length > 8196 ? "...[truncated]" : "");
        const stderr =
          r.value.stderr.slice(0, 8196) +
          (r.value.stderr.length > 8196 ? "...[truncated]" : "");

        return {
          isError: false,
          content: [
            {
              type: "text",
              text:
                `exit_code: ${r.value.exitCode}\n` +
                `duration_ms: ${r.value.durationMs}\n` +
                `stdout:\n\`\`\`\n${stdout}\n\`\`\`\n` +
                `stderr:\n\`\`\`\n${stderr}\`\`\``,
            },
          ],
        };
      }

      // No explicit timeout - try to complete in 3 minutes, otherwise background
      const jobManager = getJobManager(cid);

      // Race between completion and auto-background timeout
      const executePromise = c.value.execute(cmd, {
        cwd,
        env,
        timeoutMs: MAX_BACKGROUND_MS,
      });

      const autoBackgroundPromise = new Promise<"background">((resolve) => {
        setTimeout(() => resolve("background"), AUTO_BACKGROUND_MS);
      });

      const result = await Promise.race([executePromise, autoBackgroundPromise]);

      if (result === "background") {
        // Command taking too long - convert to background job
        const job = jobManager.createJob(cmd, cwd ?? "/home/agent");
        console.log(`\x1b[33m[auto-backgrounded as job ${job.id}]\x1b[0m`);

        // Let the original promise complete in the background
        executePromise
          .then((r) => {
            if (r.isErr()) {
              jobManager.updateJob(job.id, {
                status: "failed",
                stderr: r.error.message,
                endTime: new Date(),
                durationMs: Date.now() - job.startTime.getTime(),
              });
            } else {
              jobManager.updateJob(job.id, {
                status: "completed",
                exitCode: r.value.exitCode,
                stdout: r.value.stdout,
                stderr: r.value.stderr,
                endTime: new Date(),
                durationMs: r.value.durationMs,
              });
            }
          })
          .catch((error) => {
            jobManager.updateJob(job.id, {
              status: "failed",
              stderr: error.message,
              endTime: new Date(),
              durationMs: Date.now() - job.startTime.getTime(),
            });
          });

        return {
          isError: false,
          content: [
            {
              type: "text",
              text:
                `Command exceeded 3 minutes and was automatically backgrounded.\n\n` +
                `job_id: ${job.id}\n` +
                `command: ${cmd}\n` +
                `cwd: ${job.cwd}\n` +
                `started_at: ${job.startTime.toISOString()}\n\n` +
                `Use \`list_jobs\` to check status or \`view_job\` with job_id=${job.id} to see output when complete.`,
            },
          ],
        };
      }

      // Command completed within 3 minutes
      const r = result;
      if (r.isErr()) {
        return errorToCallToolResult(r);
      }

      const stdout =
        r.value.stdout.slice(0, 8196) +
        (r.value.stdout.length > 8196 ? "...[truncated]" : "");
      const stderr =
        r.value.stderr.slice(0, 8196) +
        (r.value.stderr.length > 8196 ? "...[truncated]" : "");

      return {
        isError: false,
        content: [
          {
            type: "text",
            text:
              `exit_code: ${r.value.exitCode}\n` +
              `duration_ms: ${r.value.durationMs}\n` +
              `stdout:\n\`\`\`\n${stdout}\n\`\`\`\n` +
              `stderr:\n\`\`\`\n${stderr}\`\`\``,
          },
        ],
      };
    },
  );

  // Background execution tool
  server.tool(
    "execute_background",
    `\
Execute a bash command in the background and return immediately with a job ID.

Use this for long-running commands that would otherwise timeout. The command runs asynchronously
and you can check its status and output later using \`list_jobs\` and \`view_job\`.

Returns a job ID that can be used to track the command's progress.
`,
    {
      cmd: z.string().describe("The bash command to execute in the background."),
      cwd: z
        .string()
        .optional()
        .describe("Current working directory. Defaults to `/home/agent`."),
      env: z.record(z.string()).optional().describe("Environment variables."),
    },
    async ({ cmd, cwd, env }) => {
      const cid = computerId(experiment, agent);
      const c = await Computer.ensure(cid);
      if (c.isErr()) {
        return errorToCallToolResult(
          err("computer_run_error", "Failed to access running computer"),
        );
      }

      const jobManager = getJobManager(cid);
      const job = jobManager.createJob(cmd, cwd ?? "/home/agent");

      console.log(`\x1b[90m[job ${job.id}] ${cmd}\x1b[0m`);

      // Execute in background (don't await)
      c.value
        .execute(cmd, {
          cwd,
          env,
          timeoutMs: 3600000, // 1 hour max for background jobs
        })
        .then((r) => {
          if (r.isErr()) {
            jobManager.updateJob(job.id, {
              status: "failed",
              stderr: r.error.message,
              endTime: new Date(),
              durationMs: Date.now() - job.startTime.getTime(),
            });
          } else {
            jobManager.updateJob(job.id, {
              status: "completed",
              exitCode: r.value.exitCode,
              stdout: r.value.stdout,
              stderr: r.value.stderr,
              endTime: new Date(),
              durationMs: r.value.durationMs,
            });
          }
        })
        .catch((error) => {
          jobManager.updateJob(job.id, {
            status: "failed",
            stderr: error.message,
            endTime: new Date(),
            durationMs: Date.now() - job.startTime.getTime(),
          });
        });

      return {
        isError: false,
        content: [
          {
            type: "text",
            text:
              `Job started successfully.\n\n` +
              `job_id: ${job.id}\n` +
              `command: ${cmd}\n` +
              `cwd: ${job.cwd}\n` +
              `started_at: ${job.startTime.toISOString()}\n\n` +
              `Use \`list_jobs\` to check status or \`view_job\` with job_id=${job.id} to see output.`,
          },
        ],
      };
    },
  );

  // List jobs tool
  server.tool(
    "list_jobs",
    `\
List all background jobs and their current status.

Shows job ID, command, status (running/completed/failed), and timing information for all jobs.
`,
    {},
    async () => {
      const cid = computerId(experiment, agent);
      const jobManager = getJobManager(cid);
      const jobs = jobManager.listJobs();

      if (jobs.length === 0) {
        return {
          isError: false,
          content: [
            {
              type: "text",
              text: "No background jobs found.",
            },
          ],
        };
      }

      const jobList = jobs
        .map((job) => {
          const duration =
            job.durationMs !== undefined
              ? `${job.durationMs}ms`
              : `${Date.now() - job.startTime.getTime()}ms (running)`;
          const exitInfo =
            job.exitCode !== undefined ? `exit_code: ${job.exitCode}` : "";
          return (
            `[Job ${job.id}] ${job.status.toUpperCase()}\n` +
            `  command: ${job.cmd.slice(0, 100)}${job.cmd.length > 100 ? "..." : ""}\n` +
            `  cwd: ${job.cwd}\n` +
            `  duration: ${duration}\n` +
            (exitInfo ? `  ${exitInfo}\n` : "")
          );
        })
        .join("\n");

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `Background Jobs (${jobs.length} total):\n\n${jobList}`,
          },
        ],
      };
    },
  );

  // View job output tool
  server.tool(
    "view_job",
    `\
View the output (stdout/stderr) of a background job.

Use this to check the results of a command started with \`execute_background\`.
`,
    {
      job_id: z.number().describe("The job ID returned by execute_background."),
      tail: z
        .number()
        .optional()
        .describe(
          "Only show the last N characters of output. Useful for large outputs.",
        ),
    },
    async ({ job_id: jobId, tail }) => {
      const cid = computerId(experiment, agent);
      const jobManager = getJobManager(cid);
      const job = jobManager.getJob(jobId);

      if (!job) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Job ${jobId} not found. Use \`list_jobs\` to see available jobs.`,
            },
          ],
        };
      }

      let stdout = job.stdout;
      let stderr = job.stderr;

      if (tail) {
        stdout = stdout.slice(-tail);
        stderr = stderr.slice(-tail);
      }

      // Truncate for display
      const maxLen = 8196;
      const truncatedStdout =
        stdout.slice(0, maxLen) + (stdout.length > maxLen ? "...[truncated]" : "");
      const truncatedStderr =
        stderr.slice(0, maxLen) + (stderr.length > maxLen ? "...[truncated]" : "");

      const duration =
        job.durationMs !== undefined
          ? `${job.durationMs}ms`
          : `${Date.now() - job.startTime.getTime()}ms (still running)`;

      return {
        isError: false,
        content: [
          {
            type: "text",
            text:
              `Job ${jobId}: ${job.status.toUpperCase()}\n` +
              `command: ${job.cmd}\n` +
              `cwd: ${job.cwd}\n` +
              `duration: ${duration}\n` +
              (job.exitCode !== undefined ? `exit_code: ${job.exitCode}\n` : "") +
              `\nstdout:\n\`\`\`\n${truncatedStdout}\n\`\`\`\n` +
              `stderr:\n\`\`\`\n${truncatedStderr}\`\`\``,
          },
        ],
      };
    },
  );

  return server;
}
