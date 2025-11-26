import {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
} from "openai/resources/chat";
import {
  LLM,
  ModelConfig,
  Message,
  Tool,
  ToolChoice,
  TokenUsage,
} from "./index";

import OpenAI from "openai";
import { normalizeError, Ok, Result, err } from "@app/lib/error";
import { assertNever } from "@app/lib/assert";
import { removeNulls } from "@app/lib/utils";
import { convertThinking, convertToolChoice } from "./openai";
import { CompletionUsage } from "openai/resources/completions";

export type MoonshotAIModel = "kimi-k2-thinking";
export function isMoonshotAIModel(model: string): model is MoonshotAIModel {
  return ["kimi-k2-thinking"].includes(model);
}

type MoonshotAITokenPrices = {
  input: number;
  cacheHits: number;
  output: number;
};

function normalizeTokenPrices(
  costPerMillionInputTokens: number,
  costPerMillionOutputTokens: number,
  costPerMillionCacheTokens: number,
): MoonshotAITokenPrices {
  return {
    input: costPerMillionInputTokens / 1_000_000,
    output: costPerMillionOutputTokens / 1_000_000,
    cacheHits: costPerMillionCacheTokens / 1_000_000,
  };
}

// https://platform.moonshot.ai/docs/pricing/chat#product-pricing
const TOKEN_PRICING: Record<MoonshotAIModel, MoonshotAITokenPrices> = {
  "kimi-k2-thinking": normalizeTokenPrices(0.6, 2.5, 0.15),
};

export class MoonshotAILLM extends LLM {
  private client: OpenAI;
  private model: MoonshotAIModel;

  constructor(
    config: ModelConfig,
    model: MoonshotAIModel = "kimi-k2-thinking",
  ) {
    super(config);
    this.client = new OpenAI({
      apiKey: process.env.MOONSHOTAI_API_KEY,
      baseURL: "https://api.moonshot.ai/v1",
    });
    this.model = model;
  }

  messages(prompt: string, messages: Message[]) {
    const inputItems: ChatCompletionMessageParam[] = [
      { role: "system", content: prompt },
      ...removeNulls(
        messages
          .map((msg) => {
            switch (msg.role) {
              case "user":
                return msg.content.map((c) => {
                  switch (c.type) {
                    case "text":
                      return { role: "user" as const, content: c.text };
                    case "tool_result":
                      return {
                        role: "tool" as const,
                        name: c.toolUseName,
                        tool_call_id: c.toolUseId,
                        id: c.toolUseId,
                        content: JSON.stringify(c.content),
                      };
                    default:
                      return undefined;
                  }
                });
              case "agent":
                const message: ChatCompletionAssistantMessageParam & {
                  reasoning_content?: string;
                } = {
                  role: "assistant",
                  content: null,
                };
                msg.content.forEach((c) => {
                  switch (c.type) {
                    case "text":
                      message.content = c.text;
                      break;
                    case "thinking":
                      message.reasoning_content = c.thinking;
                      break;
                    case "tool_use":
                      message.tool_calls = message.tool_calls ?? [];
                      message.tool_calls.push({
                        type: "function" as const,
                        id: c.id,
                        function: {
                          name: c.name,
                          arguments: JSON.stringify(c.input),
                        },
                      });
                      break;
                  }
                });
                return [message];
            }
          })
          .flat(),
      ),
    ];

    return inputItems;
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
      const input = this.messages(prompt, messages);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: input,
        tool_choice: convertToolChoice(toolChoice),
        reasoning_effort: convertThinking(this.config.thinking),
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema as any,
          },
          strict: false,
        })),
      });

      const message = response.choices[0].message;
      const textContent = message.content;
      const thinkingContent =
        "reasoning_content" in message
          ? (message.reasoning_content as string)
          : undefined;
      const toolCalls = message.tool_calls;

      const output = [];

      if (textContent) {
        output.push({
          type: "text" as const,
          text: textContent,
          provider: null,
        });
      }

      if (thinkingContent) {
        output.push({
          type: "thinking" as const,
          thinking: thinkingContent,
          provider: null,
        });
      }

      if (toolCalls) {
        output.push(
          ...toolCalls
            .filter((t) => t.type === "function")
            .map((toolCall) => {
              return {
                type: "tool_use" as const,
                id: toolCall.id,
                name: toolCall.function.name,
                input: JSON.parse(toolCall.function.arguments),
                provider: {
                  moonshotai: {
                    id: toolCall.id,
                  },
                },
              };
            }),
        );
      }

      // console.log(response.usage);

      const tokenUsage = response.usage
        ? {
            total: response.usage.total_tokens,
            input: response.usage.prompt_tokens,
            output: response.usage.completion_tokens,
            cached: response.usage.prompt_tokens_details?.cached_tokens ?? 0,
            thinking:
              response.usage.completion_tokens_details?.reasoning_tokens ?? 0,
            cost: this.cost(response.usage),
          }
        : undefined;

      return new Ok({
        message: {
          role: "agent",
          content: output,
        },
        tokenUsage,
      });
    } catch (error) {
      console.log(error);
      return err("model_error", "Failed to run model", normalizeError(error));
    }
  }

  private cost(usage: CompletionUsage): number {
    const pricing = TOKEN_PRICING[this.model];
    const c =
      (usage.prompt_tokens ?? 0) * pricing.input +
      (usage.completion_tokens ?? 0) * pricing.output +
      (usage.prompt_tokens_details?.cached_tokens ?? 0) * pricing.cacheHits;
    return c;
  }

  async tokens(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<number>> {
    try {
      const input = this.messages(prompt, messages);

      const response = await fetch(
        "https://api.moonshot.ai/v1/tokenizers/estimate-token-count",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.MOONSHOTAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages: input,
            tools: tools.map((tool) => ({
              type: "function",
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema as any,
              },
              strict: false,
            })),
            toolChoice: convertToolChoice(toolChoice),
          }),
        },
      );

      if (!response.ok) {
        const error = await response.text();
        return err(
          "model_error",
          "Failed to estimate token count",
          new Error(error),
        );
      }

      const data = await response.json();
      return new Ok(data.data.total_tokens);
    } catch (error) {
      return err(
        "model_error",
        "Failed to estimate token count",
        normalizeError(error),
      );
    }
  }

  maxTokens(): number {
    switch (this.model) {
      case "kimi-k2-thinking":
        return 256000;
      default:
        assertNever(this.model);
    }
  }
}
