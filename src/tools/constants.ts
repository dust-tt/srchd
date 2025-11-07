export const COMPUTER_SERVER_NAME = "computer" as const;
export const GOAL_SOLUTION_SERVER_NAME = "goal_solution" as const;
export const PUBLICATIONS_SERVER_NAME = "publications" as const;
export const SYSTEM_PROMPT_SELF_EDIT_SERVER_NAME =
  "system_prompt_self_edit" as const;
export const WEB_SERVER_NAME = "web" as const;

export const NON_DEFAULT_TOOLS = [COMPUTER_SERVER_NAME, WEB_SERVER_NAME];

export const DEFAULT_TOOLS = [
  GOAL_SOLUTION_SERVER_NAME,
  PUBLICATIONS_SERVER_NAME,
  SYSTEM_PROMPT_SELF_EDIT_SERVER_NAME,
];

export const ALL_TOOLS = [...DEFAULT_TOOLS, ...NON_DEFAULT_TOOLS];

export type ToolName = (typeof ALL_TOOLS)[number];

export function isToolNameList(tools: any): tools is ToolName[] {
  if (!Array.isArray(tools)) {
    return false;
  }
  for (const tool of tools) {
    if (!ALL_TOOLS.includes(tool)) {
      return false;
    }
  }
  return true;
}

export function isNonDefaultToolNameList(tools: any): tools is ToolName[] {
  if (!Array.isArray(tools)) {
    return false;
  }
  for (const tool of tools) {
    if (!NON_DEFAULT_TOOLS.includes(tool)) {
      return false;
    }
  }
  return true;
}
