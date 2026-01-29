import { createProcessServer } from "./process";
import { createGoalSolutionServer } from "./goal_solution";
import { createPublicationsServer } from "./publications";
import { createSystemPromptSelfEditServer } from "./system_prompt_self_edit";
import { createWebServer } from "./web";
import { ToolName } from "./constants";
import type { AgentResource } from "@app/resources/agent";
import type { ExperimentResource } from "@app/resources/experiment";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RunConfig } from "@app/runner/config";

export async function createServer(
  tool: ToolName,
  {
    experiment,
    agent,
    config,
  }: {
    experiment: ExperimentResource;
    agent: AgentResource;
    config: RunConfig;
  },
): Promise<McpServer> {
  switch (tool) {
    case "computer":
      return createProcessServer(agent);
    case "goal_solution":
      return createGoalSolutionServer(experiment, agent);
    case "publications":
      return createPublicationsServer(experiment, agent, config);
    case "system_prompt_self_edit":
      return createSystemPromptSelfEditServer(agent);
    case "web":
      return createWebServer();
  }
}
