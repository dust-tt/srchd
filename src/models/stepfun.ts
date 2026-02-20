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

export type StepfunModel = "step-3.5-flash";
export function isStepfunModel(model: string): model is StepfunModel {
  return ["step-3.5-flash"].includes(model);
}

type StepfunTokenPrices = {
  input: number;
  cacheHits: number;
  output: number;
};

function normalizeTokenPrices(
  costPerMillionInputTokens: number,
  costPerMillionOutputTokens: number,
  costPerMillionCacheTokens: number,
): StepfunTokenPrices {
  return {
    input: costPerMillionInputTokens / 1_000_000,
    output: costPerMillionOutputTokens / 1_000_000,
    cacheHits: costPerMillionCacheTokens / 1_000_000,
  };
}

// https://platform.stepfun.com/docs/pricing/details
const TOKEN_PRICING: Record<StepfunModel, StepfunTokenPrices> = {
  "step-3.5-flash": normalizeTokenPrices(0.1, 0.3, 0.02),
};

export class StepfunLLM extends LLM {
  private client: OpenAI;
  private model: StepfunModel;

  constructor(config: ModelConfig, model: StepfunModel = "step-3.5-flash") {
    super(config);
    this.client = new OpenAI({
      apiKey: process.env.STEPFUN_API_KEY,
      baseURL: "https://api.stepfun.ai/v1",
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
                  stepfun: {
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
      case "step-3.5-flash":
        return 256000;
      default:
        assertNever(this.model);
    }
  }
}
