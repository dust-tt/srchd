import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgentResource } from "@app/resources/agent";
import {
  errorToCallToolResult,
  STRING_EDIT_INSTRUCTIONS,
  stringEdit,
} from "@app/lib/mcp";
import { err } from "@app/lib/error";
import { SYSTEM_PROMPT_SELF_EDIT_SERVER_NAME as SERVER_NAME } from "@app/tools/constants";

const SERVER_VERSION = "0.1.0";

export async function createSystemPromptSelfEditServer(
  agent: AgentResource,
): Promise<McpServer> {
  const server = new McpServer({
    name: SERVER_NAME,
    title:
      "System prompt self-edit: Tools to self-edit your system prompt. The new system prompt version will be effective immediately.",
    version: SERVER_VERSION,
  });

  server.tool(
    "append",
    "Append text to the end of the current system prompt (no characters or separators are injected).",
    {
      new_str: z.string().describe("The string to append."),
    },
    async (params) => {
      const system = agent.toJSON().system;
      const result = await agent.evolve({
        system: system + params.new_str,
      });

      if (result.isErr()) {
        return errorToCallToolResult(result);
      }
      return {
        isError: false,
        content: [
          {
            type: "text",
            text: "System prompt updated",
          },
        ],
      };
    },
  );

  server.tool(
    "edit",
    `\
Modifies the content of the current system prompt by sustituting a specified text segment. This tool demands comprehensive contextual information surrounding the string to replace to ensure accurate targeting.

${STRING_EDIT_INSTRUCTIONS}`,
    {
      old_str: z
        .string()
        .describe(
          "The exact text to replace (must be an exact match of the file current content, including whitespaces and indentation).",
        ),
      new_str: z.string().describe("The edited text to replace `old_str`"),
      expected_replacements: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "The expected number of replacements to perform. Defaults to 1 if not specified.",
        ),
    },
    async (params) => {
      try {
        const system = agent.toJSON().system;

        const update = stringEdit({
          content: system,
          oldStr: params.old_str,
          newStr: params.new_str,
          expectedReplacements: params.expected_replacements,
        });
        if (update.isErr()) {
          return errorToCallToolResult(update);
        }

        const result = await agent.evolve({
          system: update.value,
        });
        if (result.isErr()) {
          return errorToCallToolResult(result);
        }
        return {
          isError: false,
          content: [
            {
              type: "text",
              text: "System prompt updated",
            },
          ],
        };
      } catch (error) {
        return errorToCallToolResult(
          err(
            "tool_execution_error",
            `Error editing system prompt`,
            error,
          ),
        );
      }
    },
  );

  return server;
}
