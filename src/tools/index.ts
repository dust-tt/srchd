export const COMPUTER_SERVER_NAME = "computer_server_name";
export const GOAL_SOLUTION_SERVER_NAME = "goal_solution_server_name";
export const PUBLICATIONS_SERVER_NAME = "publications_server_name";
export const SYSTEM_PROMPT_SELF_EDIT_SERVER_NAME =
  "system_prompt_self_edit_server_name";

export const TOOLS = [
  COMPUTER_SERVER_NAME,
  GOAL_SOLUTION_SERVER_NAME,
  PUBLICATIONS_SERVER_NAME,
  SYSTEM_PROMPT_SELF_EDIT_SERVER_NAME,
];

export type ToolName = (typeof TOOLS)[number];

export function isTools(tools: any): tools is ToolName[] {
  if (!Array.isArray(tools)) {
    return false;
  }
  for (const tool of tools) {
    if (!TOOLS.includes(tool)) {
      return false;
    }
  }
  return true;
}
