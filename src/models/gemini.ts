import {
  Content,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  GenerateContentResponseUsageMetadata,
  GoogleGenAI,
} from "@google/genai";
import {
  LLM,
  ModelConfig,
  Message,
  Tool,
  ToolChoice,
  TextContent,
  ToolUse,
  TokenUsage,
} from "./index";
import { normalizeError, Result, err, ok } from "@app/lib/error";
import { assertNever } from "@app/lib/assert";
import { removeNulls } from "@app/lib/utils";

export type GeminiModel =
  | "gemini-3-pro-preview"
  | "gemini-2.5-pro"
  | "gemini-2.5-flash"
  | "gemini-2.5-flash-lite";
export function isGeminiModel(model: string): model is GeminiModel {
  return [
    "gemini-3-pro-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ].includes(model);
}

type GeminiTokenPrices = {
  input: number;
  output: number;
};

function normalizeTokenPrices(
  costPerMillionInputTokens: number,
  costPerMillionOutputTokens: number,
): GeminiTokenPrices {
  return {
    input: costPerMillionInputTokens / 1_000_000,
    output: costPerMillionOutputTokens / 1_000_000,
  };
}

// https://ai.google.dev/gemini-api/docs/pricing
const TOKEN_PRICING: Record<GeminiModel, GeminiTokenPrices> = {
  "gemini-3-pro-preview": normalizeTokenPrices(2, 12),
  "gemini-2.5-pro": normalizeTokenPrices(1.25, 10),
  "gemini-2.5-flash": normalizeTokenPrices(0.3, 2.5),
  "gemini-2.5-flash-lite": normalizeTokenPrices(0.1, 0.4),
};

export class GeminiLLM extends LLM {
  private client: GoogleGenAI;
  private model: GeminiModel;

  constructor(
    config: ModelConfig,
    model: GeminiModel = "gemini-2.5-flash-lite",
  ) {
    super(config);
    this.client = new GoogleGenAI({});
    this.model = model;
  }

  contents(messages: Message[]) {
    const contents: Content[] = messages.map((msg) => {
      return {
        role: msg.role === "agent" ? "model" : "user",
        parts: removeNulls(
          msg.content.map((content) => {
            switch (content.type) {
              case "text":
                return {
                  text: content.text,
                  thoughtSignature: content.provider?.gemini?.thoughtSignature,
                };
              case "tool_use":
                return {
                  functionCall: {
                    args: content.input,
                    id: content.id,
                    name: content.name,
                  },
                  thoughtSignature: content.provider?.gemini?.thoughtSignature,
                };
              case "tool_result":
                return {
                  functionResponse: {
                    id: content.toolUseId,
                    name: content.toolUseName,
                    response: content.isError
                      ? {
                        error: content.content,
                      }
                      : {
                        output: content.content,
                      },
                  },
                };
              case "thinking": {
                if (content.provider?.gemini) {
                  return {
                    thought: true,
                    text: content.thinking,
                    thoughtSignature: content.provider.gemini.thoughtSignature,
                  };
                }
                return null;
              }
              default:
                assertNever(content);
            }
          }),
        ),
      };
    });
    return contents;
  }

  async run(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<
    Result<{ message: Message; tokenUsage?: TokenUsage }>
  > {
    try {
      const response = await this.client.models.generateContent({
        model: this.model,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
          ...this.contents(messages),
        ],
        config: {
          thinkingConfig: {
            thinkingBudget: -1,
            includeThoughts: true,
          },
          toolConfig: {
            functionCallingConfig: {
              mode: (() => {
                switch (toolChoice) {
                  case "auto":
                    return FunctionCallingConfigMode.AUTO;
                  case "any":
                    return FunctionCallingConfigMode.ANY;
                  case "none":
                    return FunctionCallingConfigMode.NONE;
                }
              })(),
            },
          },
          tools: [
            {
              functionDeclarations: tools.map((tool) => {
                return {
                  name: tool.name,
                  description: tool.description ?? "",
                  parametersJsonSchema: tool.inputSchema,
                } as FunctionDeclaration;
              }),
            },
          ],
        },
      });

      if (!response.candidates || response.candidates.length !== 1) {
        return err("model_error", "Gemini model returned no candidates");
      }
      const candidate = response.candidates[0];
      const content = candidate.content;
      if (!content) {
        return ok({
          message: {
            role: "agent",
            content: [],
          },
        });
      }

      const tokenUsage =
        response.usageMetadata &&
          response.usageMetadata.totalTokenCount &&
          response.usageMetadata.promptTokenCount &&
          response.usageMetadata.candidatesTokenCount
          ? this.tokenUsage(response.usageMetadata)
          : undefined;

      return ok({
        message: {
          role: content.role === "model" ? "agent" : "user",
          content: removeNulls(
            (content.parts ?? []).map((part) => {
              if (part.text) {
                if (part.thought) {
                  return {
                    type: "thinking",
                    thinking: part.text,
                    provider: {
                      gemini: {
                        thought: true,
                        thoughtSignature: part.thoughtSignature,
                      },
                    },
                  };
                } else {
                  const c: TextContent = {
                    type: "text",
                    text: part.text,
                    provider: null,
                  };
                  if (part.thoughtSignature) {
                    c.provider = {
                      gemini: { thoughtSignature: part.thoughtSignature },
                    };
                  }
                  return c;
                }
              }
              if (part.functionCall) {
                const c: ToolUse = {
                  type: "tool_use",
                  id:
                    part.functionCall.id ??
                    `tool_use_${Math.random().toString(36).substring(2)}`,
                  name: part.functionCall.name ?? "tool_use_gemini_no_name",
                  input: part.functionCall.args,
                  provider: null,
                };
                if (part.thoughtSignature) {
                  c.provider = {
                    gemini: { thoughtSignature: part.thoughtSignature },
                  };
                }
                return c;
              }
              return null;
            }),
          ),
        },
        tokenUsage,
      });
    } catch (error) {
      return err("model_error", "Failed to run model", normalizeError(error));
    }
  }

  private tokenUsage(usage: GenerateContentResponseUsageMetadata): TokenUsage {
    return {
      total: usage.totalTokenCount ?? 0,
      input: usage.promptTokenCount ?? 0,
      output: usage.candidatesTokenCount ?? 0,
      cached: usage.cachedContentTokenCount ?? 0,
      thinking: usage.thoughtsTokenCount ?? 0,
    };
  }

  protected costPerTokenUsage(tokenUsage: TokenUsage): number {
    const pricing = TOKEN_PRICING[this.model];
    const c =
      tokenUsage.input * pricing.input +
      tokenUsage.output * pricing.output;
    return c;
  }

  async tokens(
    messages: Message[],
    prompt: string,
    _toolChoice: ToolChoice,
    _tools: Tool[],
  ): Promise<Result<number>> {
    try {
      const response = await this.client.models.countTokens({
        model: this.model,
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
          ...this.contents(messages),
        ],
        config: {
          // No tools for countTokens
        },
      });

      if (!response.totalTokens) {
        return err("model_error", "Gemini model returned no token counts");
      }

      return ok(response.totalTokens);
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
      case "gemini-2.5-pro":
      case "gemini-2.5-flash":
      case "gemini-2.5-flash-lite":
        return 1048576 - 65536;
      case "gemini-3-pro-preview":
        return 200000 - 65536;
      default:
        assertNever(this.model);
    }
  }
}
