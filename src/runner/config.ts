import { AgentProfile } from "@app/agent_profile";

export type RunConfig = {
  reviewers: number;
  profile?: AgentProfile;
};
