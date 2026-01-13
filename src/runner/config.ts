import { AgentProfile } from "@app/agent_profile";
import { ToolName } from "@app/tools/constants";

export type RunConfig = {
  reviewers: number;
  profile?: AgentProfile; // Override profile from command line
  runtimeTools?: ToolName[]; // Additional tools to add at runtime
};
