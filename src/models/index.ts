import type { JSONSchema7 as JSONSchema } from "json-schema";
import { Result } from "@app/lib/error";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { provider } from "./provider";

export type ProviderData = Partial<Record<provider, any>>;

export type TokenUsage = {
  total: number;
  input: number;
  output: number;
  cached: number;
  thinking: number;
};

export interface TextContent {
  type: "text";
  text: string;
  provider: ProviderData | null;
}

export interface ToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: any;
  provider: ProviderData | null;
}

export interface Thinking {
  type: "thinking";
  thinking: string;
  provider: ProviderData | null;
}

export interface ToolResult {
  type: "tool_result";
  toolUseId: string;
  toolUseName: string;
  content: CallToolResult["content"];
  isError: boolean;
}

export interface Message {
  role: "user" | "agent";
  content: (TextContent | ToolUse | ToolResult | Thinking)[];
}

export type ThinkingConfig = "high" | "low" | "none";
export function isThinkingConfig(str: string): str is ThinkingConfig {
  return ["high", "low", "none"].includes(str);
}

export interface ModelConfig {
  maxTokens?: number;
  thinking?: ThinkingConfig;
}

export interface Tool {
  name: string;
  description?: string;
  inputSchema: JSONSchema;
}

export type ToolChoice = "auto" | "any" | "none";

export abstract class LLM {
  protected config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
  }

  abstract run(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<{ message: Message; tokenUsage?: TokenUsage }>>;

  abstract tokens(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<number>>;

  abstract maxTokens(): number;

  /**
   * Calculate the cost for a single TokenUsage.
   * Each provider implements its own pricing logic.
   */
  protected abstract costPerTokenUsage(tokenUsage: TokenUsage): number;

  /**
   * Calculate the total cost for a list of TokenUsage objects.
   * Accumulates tokens and calculates the total price.
   */
  public cost(tokenUsages: TokenUsage[]): number {
    // Accumulate all token usages
    const accumulated: TokenUsage = {
      total: 0,
      input: 0,
      output: 0,
      cached: 0,
      thinking: 0,
    };

    for (const usage of tokenUsages) {
      accumulated.total += usage.total;
      accumulated.input += usage.input;
      accumulated.output += usage.output;
      accumulated.cached += usage.cached;
      accumulated.thinking += usage.thinking;
    }

    // Calculate cost for the accumulated usage
    return this.costPerTokenUsage(accumulated);
  }
}
