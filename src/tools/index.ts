import { createComputerServer } from "./computer";
import { createGoalSolutionServer } from "./goal_solution";
import { createPublicationsServer } from "./publications";
import { createSystemPromptSelfEditServer } from "./system_prompt_self_edit";
import { createWebServer } from "./web";
import { ToolName } from "./constants";
import type { AgentResource } from "../resources/agent";
import type { ExperimentResource } from "../resources/experiment";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

export async function createServer(
  tool: ToolName,
  {
    experiment,
    agent,
  }: {
    experiment: ExperimentResource;
    agent: AgentResource;
  },
): Promise<McpServer> {
  switch (tool) {
    case "computer":
      return createComputerServer(experiment, agent);
    case "goal_solution":
      return createGoalSolutionServer(experiment, agent);
    case "publications":
      return createPublicationsServer(experiment, agent);
    case "system_prompt_self_edit":
      return createSystemPromptSelfEditServer(agent);
    case "web":
      return createWebServer();
  }
}
