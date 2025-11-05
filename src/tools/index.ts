import { SERVER_NAME as COMPUTER_SERVER_NAME } from "./computer";
import { SERVER_NAME as GOAL_SOLUTION_SERVER_NAME } from "./goal_solution";
import { SERVER_NAME as PUBLICATIONS_SERVER_NAME } from "./publications";
import { SERVER_NAME as SYSTEM_PROMPT_SELF_EDIT_SERVER_NAME } from "./system_prompt_self_edit";

export const TOOL_NAMES = [
  COMPUTER_SERVER_NAME,
  GOAL_SOLUTION_SERVER_NAME,
  PUBLICATIONS_SERVER_NAME,
  SYSTEM_PROMPT_SELF_EDIT_SERVER_NAME,
];

export type ToolName = (typeof TOOL_NAMES)[number];
