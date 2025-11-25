import {
  ResponseInputItem,
  ResponseUsage,
} from "openai/resources/responses/responses";
import {
  LLM,
  ModelConfig,
  Message,
  Tool,
  ToolChoice,
  TokenUsage,
} from "./index";

import OpenAI from "openai";
import { normalizeError, SrchdError } from "@app/lib/error";
import { Err, Ok, Result } from "@app/lib/result";
import { assertNever } from "@app/lib/assert";

type OpenAITokenPrices = {
  input: number;
  cached: number;
  output: number;
};

function normalizeTokenPrices(
  costPerMillionInputTokens: number,
  costPerMillionOutputTokens: number,
  costPerMillionCachedTokens?: number,
): OpenAITokenPrices {
  return {
    input: costPerMillionInputTokens / 1_000_000,
    cached:
      (costPerMillionCachedTokens ?? costPerMillionInputTokens * 0.1) /
      1_000_000,
    output: costPerMillionOutputTokens / 1_000_000,
  };
}

// https://platform.openai.com/docs/pricing
const TOKEN_PRICING: Record<OpenAIModel, OpenAITokenPrices> = {
  "gpt-5": normalizeTokenPrices(1.25, 10),
  "gpt-5-mini": normalizeTokenPrices(0.25, 2),
  "gpt-5-nano": normalizeTokenPrices(0.05, 0.4),
  "gpt-4.1": normalizeTokenPrices(2, 8, 0.5),
  "gpt-5-codex": normalizeTokenPrices(1.25, 10),
};

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

export type OpenAIModel =
  | "gpt-5"
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "gpt-4.1"
  | "gpt-5-codex";
export function isOpenAIModel(model: string): model is OpenAIModel {
  return [
    "gpt-5-codex",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
  ].includes(model);
}

export class OpenAILLM extends LLM {
  private client: OpenAI;
  private model: OpenAIModel;

  constructor(config: ModelConfig, model: OpenAIModel = "gpt-5-mini") {
    super(config);
    this.client = new OpenAI();
    this.model = model;
  }

  messages(messages: Message[]) {
    const inputItems: ResponseInputItem[] = messages
      .map((msg) => {
        switch (msg.role) {
          case "user": {
            return msg.content
              .map((content) => {
                switch (content.type) {
                  case "text":
                    return [
                      {
                        role: "user" as const,
                        type: "message" as const,
                        content: content.text,
                      },
                    ];
                  case "tool_result": {
                    return [
                      {
                        type: "function_call_output" as const,
                        call_id: content.toolUseId,
                        output: JSON.stringify(
                          content.isError
                            ? {
                                error: content.content,
                              }
                            : content,
                        ),
                      },
                    ];
                  }
                  default:
                    return [];
                }
              })
              .flat();
          }
          case "agent": {
            return msg.content
              .map((content) => {
                switch (content.type) {
                  case "text":
                    if (content.provider?.openai) {
                      return [
                        {
                          type: "message" as const,
                          role: "assistant" as const,
                          content: content.provider.openai.content,
                          id: content.provider.openai.id,
                        },
                      ];
                    }
                    return [];
                  case "thinking":
                    if (content.provider?.openai) {
                      return [
                        {
                          type: "reasoning" as const,
                          id: content.provider.openai.id,
                          summary: [],
                          encrypted_content:
                            content.provider.openai.encrypted_content,
                        },
                      ];
                    }
                    return [];
                  case "tool_use":
                    if (content.provider?.openai) {
                      return [
                        {
                          type: "function_call" as const,
                          id: content.provider.openai.id,
                          call_id: content.id,
                          name: content.name,
                          arguments: JSON.stringify(content.input),
                        },
                      ];
                    }
                    return [];
                  default:
                    return [];
                }
              })
              .flat();
          }
          default:
            assertNever(msg.role);
        }
      })
      .flat();

    return inputItems;
  }

  async run(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<
    Result<
      { message: Message; tokenUsage?: TokenUsage & { cost: number } },
      SrchdError
    >
  > {
    try {
      const input = this.messages(messages);

      const response = await this.client.responses.create({
        model: this.model,
        instructions: prompt,
        input,
        tool_choice: convertToolChoice(toolChoice),
        include:
          this.model === "gpt-4.1" ? [] : ["reasoning.encrypted_content"],
        reasoning:
          this.model === "gpt-4.1"
            ? undefined
            : {
                effort: convertThinking(this.config.thinking),
                summary: "auto",
              },
        tools: tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema as any,
          strict: false,
        })),
      });

      const content = response.output
        .map((output) => {
          switch (output.type) {
            case "reasoning":
              return [
                {
                  type: "thinking" as const,
                  thinking: output.summary.map((s) => s.text).join("\n\n"),
                  provider: {
                    openai: {
                      id: output.id,
                      encrypted_content: output.encrypted_content,
                    },
                  },
                },
              ];
            case "message":
              return {
                type: "text" as const,
                text: output.content
                  .map((c) => {
                    switch (c.type) {
                      case "output_text":
                        return c.text;
                      case "refusal":
                        return c.refusal;
                      default:
                        assertNever(c);
                    }
                  })
                  .join("\n\n"),
                provider: {
                  openai: {
                    id: output.id,
                    content: output.content,
                  },
                },
              };
            case "function_call":
              return {
                type: "tool_use" as const,
                id: output.call_id,
                name: output.name,
                input: JSON.parse(output.arguments),
                provider: {
                  openai: {
                    id: output.id,
                  },
                },
              };
            default:
              throw new Error("Unexpected output type: " + output.type);
          }
        })
        .flat();

      const tokenUsage = response.usage
        ? {
            total: response.usage.total_tokens,
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
            cached: response.usage.input_tokens_details?.cached_tokens ?? 0,
            thinking:
              response.usage.output_tokens_details?.reasoning_tokens ?? 0,
            cost: this.cost(response.usage),
          }
        : undefined;

      return new Ok({
        message: {
          role: "agent",
          content,
        },
        tokenUsage,
      });
    } catch (error) {
      return new Err(
        new SrchdError(
          "model_error",
          "Failed to run model",
          normalizeError(error),
        ),
      );
    }
  }

  private cost(usage: ResponseUsage): number {
    const pricing = TOKEN_PRICING[this.model];
    let c = usage.input_tokens_details.cached_tokens * pricing.cached;
    c += usage.output_tokens * pricing.output;
    c +=
      (usage.input_tokens - usage.input_tokens_details.cached_tokens) *
      pricing.input;
    return c;
  }

  async tokens(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<number, SrchdError>> {
    try {
      const input = this.messages(messages);
      // @ts-ignore - input_tokens exists on the response but not typed on unknown
      const { input_tokens } = await this.client.post(
        "/responses/input_tokens",
        {
          body: {
            instructions: prompt,
            model: this.model,
            input,
            tool_choice: convertToolChoice(toolChoice),
            reasoning:
              this.model === "gpt-4.1"
                ? undefined
                : {
                    effort: convertThinking(this.config.thinking),
                    summary: "auto",
                  },
            tools: tools.map((tool) => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema as any,
              strict: false,
            })),
          },
        },
      );
      return new Ok(input_tokens);
    } catch (error) {
      return new Err(
        new SrchdError(
          "model_error",
          "Failed to run model",
          normalizeError(error),
        ),
      );
    }
  }
  maxTokens(): number {
    switch (this.model) {
      case "gpt-5":
      case "gpt-5-mini":
      case "gpt-5-nano":
      case "gpt-5-codex":
        return 400000 - 128000;
      case "gpt-4.1":
        return 1047576 - 32768;
      default:
        assertNever(this.model);
    }
  }
}
