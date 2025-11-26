import { assertNever } from "@app/lib/assert";
import { AnthropicModel, isAnthropicModel } from "./anthropic";
import { GeminiModel, isGeminiModel } from "./gemini";
import { isMistralModel, MistralModel } from "./mistral";
import { isMoonshotAIModel, MoonshotAIModel } from "./moonshotai";
import { isOpenAIModel, OpenAIModel } from "./openai";

export type provider =
  | "openai"
  | "moonshotai"
  | "anthropic"
  | "gemini"
  | "mistral";

export function isProvider(str: string): str is provider {
  return ["gemini", "anthropic", "openai", "mistral", "moonshotai"].includes(
    str,
  );
}

export function providerFromModel(
  model:
    | OpenAIModel
    | MoonshotAIModel
    | AnthropicModel
    | GeminiModel
    | MistralModel,
): provider {
  if (isOpenAIModel(model)) return "openai";
  if (isMoonshotAIModel(model)) return "moonshotai";
  if (isAnthropicModel(model)) return "anthropic";
  if (isGeminiModel(model)) return "gemini";
  if (isMistralModel(model)) return "mistral";
  else assertNever(model);
}
