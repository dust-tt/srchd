import {
  LLM,
  ModelConfig,
  Message,
  Tool,
  ToolChoice,
  TextContent,
  ToolUse,
  Thinking,
  TokenUsage,
} from "./index";
import { normalizeError, Ok, Result, err } from "@app/lib/error";
import { assertNever } from "@app/lib/assert";

import { Mistral } from "@mistralai/mistralai";
import type {
  ChatCompletionStreamRequest,
  UsageInfo,
} from "@mistralai/mistralai/models/components";
import { isString, removeNulls } from "@app/lib/utils";

type MistralMessage = ChatCompletionStreamRequest["messages"][number];

type MistralTokenPrices = {
  input: number;
  output: number;
};

function normalizeTokenPrices(
  costPerMillionInputTokens: number,
  costPerMillionOutputTokens: number,
): MistralTokenPrices {
  return {
    input: costPerMillionInputTokens / 1_000_000,
    output: costPerMillionOutputTokens / 1_000_000,
  };
}

// https://mistral.ai/pricing#api-pricing
const TOKEN_PRICING: Record<MistralModel, MistralTokenPrices> = {
  "mistral-large-latest": normalizeTokenPrices(2, 6),
  "mistral-small-latest": normalizeTokenPrices(0.1, 0.3),
  "codestral-latest": normalizeTokenPrices(0.3, 0.9),
};

export type MistralModel =
  | "mistral-large-latest"
  | "mistral-small-latest"
  | "codestral-latest";

export function isMistralModel(model: string): model is MistralModel {
  return [
    "mistral-large-latest",
    "mistral-small-latest",
    "codestral-latest",
  ].includes(model);
}

// Sometimes mistral models send back wrong function names so we validate them here
function validateName(name: string): { valid: boolean; reason?: string } {
  if (!(name.length <= 256)) {
    return {
      valid: false,
      reason: `name: ${name} must be less than 256 characters`,
    };
  }
  if (!name.match(/^[a-zA-Z0-9_-]+$/)) {
    return {
      valid: false,
      reason: `name: ${name} must be alphanumeric`,
    };
  }
  return { valid: true };
}

export class MistralLLM extends LLM {
  private client: Mistral;
  private model: MistralModel;

  constructor(
    config: ModelConfig,
    model: MistralModel = "mistral-large-latest",
  ) {
    super(config);
    this.client = new Mistral();
    this.model = model;
  }

  messages(messages: Message[]) {
    const mistralMessages: MistralMessage[] = [];

    for (const msg of messages) {
      switch (msg.role) {
        case "user":
          mistralMessages.push(
            ...msg.content
              .filter((c) => c.type === "tool_result")
              .map((c) => ({
                role: "tool" as const,
                toolCallId: c.toolUseId,
                name: c.toolUseName,
                content: c.content
                  .filter((c) => c.type === "text")
                  .map((c) => ({
                    type: "text" as const,
                    text: c.text,
                  })),
              })),
          );
          if (msg.content.find((c) => c.type === "text")) {
            mistralMessages.push({
              role: "user",
              content: msg.content
                .filter((c) => c.type === "text")
                .map((c) => ({
                  type: "text",
                  text: c.text,
                })),
            });
          }
          break;
        case "agent":
          const agentMsg = {
            role: "assistant" as const,
            content: msg.content
              .filter((c) => c.type === "text") // We don't support thinking atm
              .map((c) => {
                switch (c.type) {
                  case "text":
                    return {
                      type: "text" as const,
                      text: c.text,
                    };
                }
              }),
            toolCalls: msg.content
              .filter((c) => c.type === "tool_use")
              .map((c) => {
                return {
                  id: c.id,
                  type: "function" as const,
                  function: {
                    name: c.name,
                    arguments: c.input,
                  },
                };
              }),
          };
          mistralMessages.push(agentMsg);
      }
    }

    return mistralMessages;
  }

  async run(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<
    Result<{ message: Message; tokenUsage?: TokenUsage & { cost: number } }>
  > {
    try {
      const chatResponse = await this.client.chat.complete({
        model: this.model,
        messages: [
          {
            role: "system",
            content: prompt,
          },
          ...this.messages(messages),
        ],
        toolChoice,
        tools: tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })),
      });

      const usage = chatResponse.usage;

      const tokenUsage =
        !usage.totalTokens || !usage.promptTokens || !usage.completionTokens
          ? undefined
          : {
              total: usage.totalTokens,
              input: usage.promptTokens,
              output: usage.completionTokens,
              cached: 0,
              thinking: 0,
              cost: this.cost(usage),
            };

      const msg = chatResponse.choices[0].message;
      const finishReason = chatResponse.choices[0].finishReason;
      if (finishReason !== "stop" && finishReason !== "tool_calls") {
        return err(
          "model_error",
          `Unexpected finish reason: ${finishReason}`,
          normalizeError(`Unexpected finish reason: ${finishReason}`),
        );
      }

      const content: (TextContent | ToolUse | Thinking)[] = [];

      if (msg.toolCalls) {
        for (const toolCall of msg.toolCalls) {
          const { valid, reason } = validateName(toolCall.function.name);
          if (valid) {
            content.push({
              type: "tool_use",
              id: toolCall.id ?? "",
              name: toolCall.function.name,
              input: isString(toolCall.function.arguments)
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function.arguments,
              provider: null,
            });
          } else {
            console.warn(
              `Mistral model received invalid tool name: ${toolCall.function.name}.
              Reason: ${reason}`,
            );
          }
        }
      }

      if (msg.content) {
        if (isString(msg.content)) {
          content.push({
            type: "text",
            text: msg.content,
            provider: null,
          });
        } else {
          content.push(
            ...removeNulls(
              msg.content.map((c) => {
                switch (c.type) {
                  case "text":
                    return {
                      type: "text" as const,
                      text: c.text,
                      provider: null,
                    };
                  default: // Note: thinking is not implemented yet for mistral
                    return null;
                }
              }),
            ),
          );
        }
      }

      return new Ok({
        message: {
          role: "agent",
          content,
        },
        tokenUsage,
      });
    } catch (error) {
      return err("model_error", "Failed to run model", normalizeError(error));
    }
  }

  private cost(usage: UsageInfo): number {
    const pricing = TOKEN_PRICING[this.model];
    const c =
      (usage.promptTokens ?? 0) * pricing.input +
      (usage.completionTokens ?? 0) * pricing.output;
    return c;
  }

  async tokens(
    messages: Message[],
    _prompt: string,
    _toolChoice: ToolChoice,
    _tools: Tool[],
  ): Promise<Result<number>> {
    try {
      // Mistral's doesn't have a token counting API so we approximate with token ~= 4 chars.
      const tokens =
        messages.reduce((acc, m) => {
          const contentLength = m.content.reduce((acc, c) => {
            switch (c.type) {
              case "text":
                return acc + c.text.length;
              case "tool_use":
                return acc + c.name.length + JSON.stringify(c.input).length;
              case "thinking":
                // We don't have any thinking models yet
                // return acc + c.thinking.length;
                throw new Error("Thinking not implemented yet for mistral");
                return acc;
              case "tool_result":
                const contentLength = c.content
                  .filter((c) => c.type === "text")
                  .reduce((acc, c) => acc + c.text.length, 0);
                return acc + c.toolUseName.length + contentLength;
            }
          }, 0);
          return contentLength + acc;
        }, 0) / 4;

      return new Ok(Math.floor(tokens));
    } catch (error) {
      return err(
        "model_error",
        "Failed to count tokens",
        normalizeError(error),
      );
    }
  }

  maxTokens(): number {
    switch (this.model) {
      case "mistral-large-latest":
        return 128000;
      case "mistral-small-latest":
        return 128000;
      case "codestral-latest":
        return 32000;
      default:
        assertNever(this.model);
    }
  }
}
