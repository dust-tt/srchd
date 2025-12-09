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
} from "../index";
import { PreTrainedTokenizer } from "@huggingface/transformers";

import OpenAI from "openai";
import { normalizeError, Result, err, ok } from "@app/lib/error";
import { assertNever } from "@app/lib/assert";
import { removeNulls } from "@app/lib/utils";
import { convertToolChoice } from "../openai";
import { CompletionUsage } from "openai/resources/completions";

export type DeepseekModel = "deepseek-chat" | "deepseek-reasoner";
export function isDeepseekModel(model: string): model is DeepseekModel {
  return ["deepseek-chat", "deepseek-reasoner"].includes(model);
}

type DeepseekTokenPrices = {
  input: number;
  cacheHits: number;
  output: number;
};

function normalizeTokenPrices(
  costPerMillionInputTokens: number,
  costPerMillionOutputTokens: number,
  costPerMillionCacheTokens: number,
): DeepseekTokenPrices {
  return {
    input: costPerMillionInputTokens / 1_000_000,
    output: costPerMillionOutputTokens / 1_000_000,
    cacheHits: costPerMillionCacheTokens / 1_000_000,
  };
}

// https://api-docs.deepseek.com/quick_start/pricing
const TOKEN_PRICING: Record<DeepseekModel, DeepseekTokenPrices> = {
  "deepseek-chat": normalizeTokenPrices(0.28, 0.42, 0.028),
  "deepseek-reasoner": normalizeTokenPrices(0.28, 0.42, 0.028),
};

export class DeepseekLLM extends LLM {
  private client: OpenAI;
  private model: DeepseekModel;

  constructor(config: ModelConfig, model: DeepseekModel = "deepseek-chat") {
    super(config);
    this.client = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: "https://api.deepseek.com/v1",
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
                if (message.tool_calls && message.tool_calls.length > 0 && !message.reasoning_content) {
                  message.reasoning_content = "";
                }
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

      const response = await this.client.chat.completions.create(
        {
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
        },
        {},
      );

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

      return ok({
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
    const str = [messages, prompt, tools]
      .map((x) => JSON.stringify(x))
      .reduce((acc, cur) => acc + cur);

    try {
      const tokenizer = await PreTrainedTokenizer.from_pretrained(__dirname);

      const encoded = tokenizer.encode(str);

      return ok(encoded.length);
    } catch (e: any) {
      return err("model_error", "Could not tokenize", e);
    }
  }

  maxTokens(): number {
    switch (this.model) {
      case "deepseek-chat":
        return 128000;
      case "deepseek-reasoner":
        return 128000;
      default:
        assertNever(this.model);
    }
  }
}
