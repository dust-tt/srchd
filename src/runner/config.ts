import { ToolName } from "@app/tools/constants";

export type RunConfig = {
  reviewers: number;
  runtimeTools?: ToolName[]; // Additional tools to add at runtime
};
