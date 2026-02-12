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
import { Result, err, ok } from "@app/lib/error";
import { assertNever } from "@app/lib/assert";
import { removeNulls } from "@app/lib/utils";
import { convertToolChoice } from "./openai";
import { CompletionUsage } from "openai/resources/completions";

export type ZhipuModel = "glm-5" | "glm-5-code";
export function isZhipuModel(model: string): model is ZhipuModel {
  return ["glm-5", "glm-5-code"].includes(model);
}

type ZhipuTokenPrices = {
  input: number;
  cacheHits: number;
  output: number;
};

function normalizeTokenPrices(
  costPerMillionInputTokens: number,
  costPerMillionOutputTokens: number,
  costPerMillionCacheTokens: number,
): ZhipuTokenPrices {
  return {
    input: costPerMillionInputTokens / 1_000_000,
    output: costPerMillionOutputTokens / 1_000_000,
    cacheHits: costPerMillionCacheTokens / 1_000_000,
  };
}

// https://docs.z.ai/guides/overview/pricing
const TOKEN_PRICING: Record<ZhipuModel, ZhipuTokenPrices> = {
  "glm-5": normalizeTokenPrices(1, 3.2, 0.2),
  "glm-5-code": normalizeTokenPrices(1.2, 5, 0.3),
};

export class ZhipuLLM extends LLM {
  private client: OpenAI;
  private model: ZhipuModel;

  constructor(config: ModelConfig, model: ZhipuModel = "glm-5") {
    super(config);
    this.client = new OpenAI({
      apiKey: process.env.Z_AI_API_KEY,
      baseURL: "https://api.z.ai/api/paas/v4",
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
  ): Promise<Result<{ message: Message; tokenUsage?: TokenUsage }>> {
    try {
      const input = this.messages(prompt, messages);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: input,
        tool_choice: convertToolChoice(toolChoice),
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
                  zhipu: {
                    id: toolCall.id,
                  },
                },
              };
            }),
        );
      }

      const tokenUsage = response.usage
        ? this.tokenUsage(response.usage)
        : undefined;

      return ok({
        message: {
          role: "agent",
          content: output,
        },
        tokenUsage,
      });
    } catch (error) {
      console.log(error);
      return err("model_error", "Failed to run model", error);
    }
  }

  private tokenUsage(usage: CompletionUsage): TokenUsage {
    return {
      total: usage.total_tokens,
      input: usage.prompt_tokens,
      output: usage.completion_tokens,
      cached: usage.prompt_tokens_details?.cached_tokens ?? 0,
      thinking: usage.completion_tokens_details?.reasoning_tokens ?? 0,
    };
  }

  protected costPerTokenUsage(tokenUsage: TokenUsage): number {
    const pricing = TOKEN_PRICING[this.model];
    const nonCachedInput = tokenUsage.input - tokenUsage.cached;
    const c =
      nonCachedInput * pricing.input +
      tokenUsage.output * pricing.output +
      tokenUsage.cached * pricing.cacheHits;
    return c;
  }

  async tokens(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<number>> {
    // Approximate token count using JSON string length / 4
    const str = [messages, prompt, tools]
      .map((x) => JSON.stringify(x))
      .reduce((acc, cur) => acc + cur);
    return ok(Math.ceil(str.length / 4));
  }

  maxTokens(): number {
    switch (this.model) {
      case "glm-5":
      case "glm-5-code":
        return 200000;
      default:
        assertNever(this.model);
    }
  }
}
