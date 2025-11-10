import { ResponseInputItem } from "openai/resources/responses/responses";
import {
  BaseModel,
  ModelConfig,
  Message,
  Tool,
  ToolChoice,
  TokenUsage,
} from "./index";

import OpenAI from "openai";
import { normalizeError, SrchdError } from "../lib/error";
import { Err, Ok, Result } from "../lib/result";
import { assertNever } from "../lib/assert";
import { convertThinking, convertToolChoice } from "./openai_utils";
import { get_encoding } from "tiktoken";

const ENCODING = get_encoding("o200k_base");

export type OpenAIModels =
  | "gpt-5"
  | "gpt-5-mini"
  | "gpt-5-nano"
  | "gpt-4.1"
  | "gpt-5-codex";
export function isOpenAIModel(model: string): model is OpenAIModels {
  return [
    "gpt-5-codex",
    "gpt-5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-4.1",
  ].includes(model);
}

export class OpenAIModel extends BaseModel {
  private client: OpenAI;
  private model: OpenAIModels;

  constructor(config: ModelConfig, model: OpenAIModels = "gpt-5-mini") {
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
    Result<{ message: Message; tokenUsage?: TokenUsage }, SrchdError>
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

  async tokens(
    messages: Message[],
    prompt: string,
    toolChoice: ToolChoice,
    tools: Tool[],
  ): Promise<Result<number, SrchdError>> {
    const tokenCount =
      ENCODING.encode(prompt).length +
      ENCODING.encode(JSON.stringify(tools)).length +
      messages
        .map((msg) => {
          return msg.content.map((content) => {
            switch (content.type) {
              case "text": {
                return ENCODING.encode(content.text).length;
              }
              case "tool_use": {
                return ENCODING.encode(JSON.stringify(content.input)).length;
              }
              case "tool_result": {
                return ENCODING.encode(JSON.stringify(content.content)).length;
              }
              case "thinking": {
                return ENCODING.encode(content.thinking).length;
              }
            }
          });
        })
        .flat()
        .reduce((a, b) => a + b, 0);

    return new Ok(tokenCount);
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
