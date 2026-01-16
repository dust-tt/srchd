import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgentResource } from "@app/resources/agent";
import { errorToCallToolResult } from "@app/lib/mcp";
import { ExperimentResource } from "@app/resources/experiment";
import { Computer, computerId } from "@app/computer";
import { COMPUTER_SERVER_NAME as SERVER_NAME } from "@app/tools/constants";
import { err } from "@app/lib/error";

const SERVER_VERSION = "0.1.0";

import { AgentProfile } from "@app/agent_profile";

export async function createComputerServer(
  experiment: ExperimentResource,
  agent: AgentResource,
  profile?: AgentProfile,
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

For long running commands (running a server) make sure to run them in the background using \`&\` and redirect output to files to track their progress. For long running builds you can do the same and execute sleep with appropriate timeoOut to wait until the command is expected to be finished.
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
          "Timeout in millisecond. When timing out the underlying command may still be running. Defaults to 60000.",
        ),
    },
    async ({ cmd, cwd, env, timeout_ms: timeoutMs }) => {
      const c = await Computer.ensure(
        computerId(experiment, agent),
        undefined,
        profile?.imageName,
        profile?.env,
      );
      if (c.isErr()) {
        return errorToCallToolResult(
          err("computer_run_error", "Failed to access running computer"),
        );
      }

      console.log(`\x1b[90m${cmd}\x1b[0m`);

      const r = await c.value.execute(cmd, {
        cwd,
        env,
        timeoutMs: timeoutMs ?? 60000,
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
    },
  );

  return server;
}
