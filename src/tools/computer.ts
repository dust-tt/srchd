import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgentResource } from "../resources/agent";
import { errorToCallToolResult } from "../lib/mcp";
import { ExperimentResource } from "../resources/experiment";
import { SrchdError } from "../lib/error";
import { Computer } from "../computer";
import { COMPUTER_SERVER_NAME as SERVER_NAME } from "../tools/constants";
import { dockerFile } from "../computer/image";

const SERVER_VERSION = "0.1.0";

function computerId(experiment: ExperimentResource, agent: AgentResource) {
  return `${experiment.toJSON().name}-${agent.toJSON().name}`;
}

export async function createComputerServer(
  experiment: ExperimentResource,
  agent: AgentResource,
): Promise<McpServer> {
  const df = await dockerFile();

  const server = new McpServer({
    name: SERVER_NAME,
    title: "Computer",
    description: `\
Tools to interact with a computer (docker container).

Dockerfile used to create the computer:
\`\`\`
${df}
\`\`\`

Additional programs can be installed using apt-get (with sudo) or source download/compilation.`,
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
        .describe("Timeout in milliseconds. Defaults to 60000ms."),
    },
    async ({ cmd, cwd, env, timeout_ms: timeoutMs }) => {
      const c = await Computer.ensure(computerId(experiment, agent));
      if (c.isErr()) {
        return errorToCallToolResult(
          new SrchdError(
            "computer_run_error",
            "Failed to access running computer",
          ),
        );
      }

      console.log(`\x1b[90m${cmd}\x1b[0m`);

      const r = await c.value.execute(cmd, {
        cwd,
        env,
        timeoutMs,
      });

      if (r.isErr()) {
        return errorToCallToolResult(r.error);
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
