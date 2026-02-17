import { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import {
  LLM,
  ModelConfig,
  Message,
  Tool,
  ToolChoice,
  TokenUsage,
} from "./index";
import Anthropic from "@anthropic-ai/sdk";
import { Result, err, ok } from "@app/lib/error";
import { assertNever } from "@app/lib/assert";
import { removeNulls } from "@app/lib/utils";
import { BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";

const DEFAULT_TIMEOUT = 600000 * 2; // 20 minutes (double the default)
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_LOW_THINKING_TOKENS = 4096;
const DEFAULT_HIGH_THINKING_TOKENS = 16384;

type AnthropicTokenPrices = {
  baseInput: number;
  cache5m: number;
  cache1h: number;
  cacheHits: number;
  output: number;
};

function normalizeTokenPrices(
  costPerMillionInputTokens: number,
  costPerMillionOutputTokens: number,
): AnthropicTokenPrices {
  return {
    baseInput: costPerMillionInputTokens / 1_000_000,
    cache5m: (costPerMillionInputTokens * 1.25) / 1_000_000,
    cache1h: (costPerMillionInputTokens * 2) / 1_000_000,
    cacheHits: (costPerMillionInputTokens * 0.1) / 1_000_000,
    output: costPerMillionOutputTokens / 1_000_000,
  };
}

// https://docs.claude.com/en/docs/about-claude/pricing#model-pricing
const TOKEN_PRICING: Record<AnthropicModel, AnthropicTokenPrices> = {
  "claude-opus-4-6": normalizeTokenPrices(5, 25),
  "claude-opus-4-5": normalizeTokenPrices(5, 25),
  "claude-sonnet-4-5": normalizeTokenPrices(3, 15),
  "claude-haiku-4-5": normalizeTokenPrices(1, 5),
};

export type AnthropicModel =
  | "claude-opus-4-6"
  | "claude-opus-4-5"
  | "claude-sonnet-4-5"
  | "claude-haiku-4-5";
export function isAnthropicModel(model: string): model is AnthropicModel {
  return [
    "claude-opus-4-6",
    "claude-opus-4-5",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
  ].includes(model);
}

export class AnthropicLLM extends LLM {
  private client: Anthropic;
  private model: AnthropicModel;

  constructor(
    config: ModelConfig,
    model: AnthropicModel = "claude-sonnet-4-5",
  ) {
    super(config);
    this.client = new Anthropic({
      timeout: DEFAULT_TIMEOUT,
    });
    this.model = model;
  }

  messages(messages: Message[]) {
    const anthropicMessages: MessageParam[] = messages.map((msg) => ({
      role: msg.role === "agent" ? "assistant" : "user",
      content: removeNulls(
        msg.content.map((content) => {
          switch (content.type) {
            case "text":
              return {
                type: "text",
                text: content.text,
              };
            case "tool_use":
              return {
                type: "tool_use",
                id: content.id,
                name: content.name,
                input: content.input,
              };
            case "tool_result":
              return {
                type: "tool_result",
                tool_use_id: content.toolUseId,
                content: content.content.map((content) => {
                  switch (content.type) {
                    case "text":
                      return {
                        type: "text",
                        text: content.text,
                      };
                    case "image": {
                      return {
                        type: "image",
                        source: {
                          data: content.data,
                          media_type: content.mimeType as any,
                          type: "base64",
                        },
                      };
                    }
                    case "audio":
                      return {
                        type: "text",
                        text: "(unsupported audio content)",
                      };
                    case "resource":
                      return {
                        type: "text",
                        text: JSON.stringify(content, null, 2),
                      };
                    case "resource_link":
                      return {
                        type: "text",
                        text: JSON.stringify(content, null, 2),
                      };
                    default:
                      assertNever(content);
                  }
                }),
                is_error: content.isError,
              };
            case "thinking": {
              if (content.provider?.anthropic) {
                switch (content.provider.anthropic.type) {
                  case "thinking": {
                    return {
                      type: "thinking",
                      thinking: content.thinking,
                      signature: content.provider.anthropic.signature,
                    };
                  }
                  case "redacted_thinking": {
                    return {
                      type: "redacted_thinking",
                      data: content.provider.anthropic.data,
                    };
                  }
                  default:
                    return null;
                }
              }
              return null;
            }
            default:
              assertNever(content);
          }
        }),
      ),
    }));

    for (let i = anthropicMessages.length - 1; i >= 0; i--) {
      if (anthropicMessages[i].role === "user") {
        let found = false;
        for (let j = anthropicMessages[i].content.length - 1; j >= 0; j--) {
          const c = anthropicMessages[i].content[j];
          if (typeof c !== "string" && c.type === "text") {
            c.cache_control = { type: "ephemeral" };
            found = true;
            break;
          }
        }
        if (found) {
          break;
        }
      }
    }

    return anthropicMessages;
  }

  async run(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<{ message: Message; tokenUsage?: TokenUsage }>> {
    try {
      const message = await this.client.beta.messages.create({
        model: this.model,
        max_tokens:
          this.config.maxTokens ??
          (() => {
            switch (this.config.thinking) {
              case undefined:
              case "none":
                return DEFAULT_MAX_TOKENS;
              case "low": {
                return DEFAULT_LOW_THINKING_TOKENS + DEFAULT_MAX_TOKENS;
              }
              case "high": {
                return DEFAULT_HIGH_THINKING_TOKENS + DEFAULT_MAX_TOKENS;
              }
              default:
                assertNever(this.config.thinking);
            }
          })(),
        messages: this.messages(messages),
        system: [
          {
            type: "text",
            text: prompt,
            cache_control: {
              type: "ephemeral",
            },
          },
        ],
        thinking: (() => {
          switch (this.config.thinking) {
            case undefined:
              return {
                type: "disabled",
              };
            case "low": {
              return {
                type: "enabled",
                budget_tokens: DEFAULT_LOW_THINKING_TOKENS,
              };
            }
            case "high": {
              return {
                type: "enabled",
                budget_tokens: DEFAULT_HIGH_THINKING_TOKENS,
              };
            }
          }
        })(),
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as any,
        })),
        tool_choice: {
          type: toolChoice,
        },
        betas: ["interleaved-thinking-2025-05-14"],
      });

      const tokenUsage = this.tokenUsage(message.usage);
      // console.log(message.usage);

      return ok({
        message: {
          role: message.role === "assistant" ? "agent" : "user",
          content: removeNulls(
            message.content.map((c) => {
              switch (c.type) {
                case "text":
                  return {
                    type: "text",
                    text: c.text,
                    provider: null,
                  };
                case "tool_use":
                  return {
                    type: "tool_use",
                    id: c.id,
                    name: c.name,
                    input: c.input,
                    provider: null,
                  };
                case "thinking": {
                  return {
                    type: "thinking",
                    thinking: c.thinking,
                    provider: {
                      anthropic: {
                        type: c.type,
                        signature: c.signature,
                      },
                    },
                  };
                }
                case "redacted_thinking": {
                  return {
                    type: "thinking",
                    thinking: "<redacted>",
                    provider: {
                      anthropic: {
                        type: c.type,
                        data: c.data,
                      },
                    },
                  };
                }
                case "server_tool_use":
                case "mcp_tool_use":
                case "mcp_tool_result":
                case "code_execution_tool_result":
                case "container_upload":
                case "web_search_tool_result": {
                  return null;
                }
                default:
                  assertNever(c);
              }
            }),
          ),
        },
        tokenUsage, // also inlcude cached or input tokens ?
      });
    } catch (error) {
      return err("model_error", "Failed to run model", error);
    }
  }

  async tokens(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<number>> {
    try {
      const response = await this.client.messages.countTokens({
        model: this.model,
        messages: this.messages(messages),
        system: prompt,
        thinking: (() => {
          switch (this.config.thinking) {
            case undefined:
              return {
                type: "disabled",
              };
            case "low": {
              return {
                type: "enabled",
                budget_tokens: DEFAULT_LOW_THINKING_TOKENS,
              };
            }
            case "high": {
              return {
                type: "enabled",
                budget_tokens: DEFAULT_HIGH_THINKING_TOKENS,
              };
            }
          }
        })(),
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as any,
        })),
        tool_choice: {
          type: toolChoice,
        },
      });

      return ok(response.input_tokens);
    } catch (error) {
      return err("model_error", "Failed to count tokens", error);
    }
  }

  private tokenUsage(usage: BetaUsage): TokenUsage {
    const input =
      usage.input_tokens +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0) +
      (usage.cache_creation?.ephemeral_5m_input_tokens ?? 0);

    return {
      total: usage.output_tokens + input,
      input,
      output: usage.output_tokens,
      cached: usage.cache_read_input_tokens ?? 0,
      thinking: 0, // Anthropic doesn't give thinking token usage
    };
  }

  protected costPerTokenUsage(tokenUsage: TokenUsage): number {
    const pricing = TOKEN_PRICING[this.model];
    // For Anthropic, we use a conservative estimate:
    // baseInput for non-cached tokens, cacheHits for cached tokens
    const nonCachedInput = tokenUsage.input - tokenUsage.cached;
    let c = nonCachedInput * pricing.baseInput;
    c += tokenUsage.cached * pricing.cacheHits;
    c += tokenUsage.output * pricing.output;
    return c;
  }

  maxTokens(): number {
    switch (this.model) {
      case "claude-opus-4-6":
      case "claude-opus-4-5":
      case "claude-sonnet-4-5":
      case "claude-haiku-4-5":
        return 200000 - 64000;
      default:
        assertNever(this.model);
    }
  }
}
