import { ToolChoice } from "./index";
import { assertNever } from "../lib/assert";

export function convertToolChoice(toolChoice: ToolChoice) {
  switch (toolChoice) {
    case "none":
    case "auto":
      return toolChoice;
    case "any":
      return "required";
    default:
      assertNever(toolChoice);
  }
}

export function convertThinking(thinking: "high" | "low" | "none" | undefined) {
  switch (thinking) {
    case "high":
      return "medium";
    case "low":
      return "low";
    case "none":
      return "minimal";
    case undefined:
      return "low";
    default:
      assertNever(thinking);
  }
}
