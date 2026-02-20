import { assertNever } from "@app/lib/assert";
import { AnthropicModel, isAnthropicModel, AnthropicLLM } from "./anthropic";
import { GeminiModel, isGeminiModel, GeminiLLM } from "./gemini";
import { isMistralModel, MistralModel, MistralLLM } from "./mistral";
import { isMoonshotAIModel, MoonshotAIModel, MoonshotAILLM } from "./moonshotai";
import { isDeepseekModel, DeepseekModel, DeepseekLLM } from "./deepseek";
import { isOpenAIModel, OpenAIModel, OpenAILLM } from "./openai";
import { isZhipuModel, ZhipuModel, ZhipuLLM } from "./zhipu";
import { isStepfunModel, StepfunModel, StepfunLLM } from "./stepfun";
import { LLM, ModelConfig } from "./index";

export type Model =
  | AnthropicModel
  | GeminiModel
  | OpenAIModel
  | MistralModel
  | MoonshotAIModel
  | DeepseekModel
  | ZhipuModel
  | StepfunModel;

export type provider =
  | "openai"
  | "moonshotai"
  | "deepseek"
  | "anthropic"
  | "gemini"
  | "mistral"
  | "zhipu"
  | "stepfun";

export function isProvider(str: string): str is provider {
  return [
    "gemini",
    "anthropic",
    "openai",
    "mistral",
    "moonshotai",
    "deepseek",
    "zhipu",
    "stepfun",
  ].includes(str);
}

export function providerFromModel(
  model:
    | OpenAIModel
    | MoonshotAIModel
    | AnthropicModel
    | GeminiModel
    | MistralModel
    | DeepseekModel
    | ZhipuModel
    | StepfunModel,
): provider {
  if (isOpenAIModel(model)) return "openai";
  if (isMoonshotAIModel(model)) return "moonshotai";
  if (isAnthropicModel(model)) return "anthropic";
  if (isGeminiModel(model)) return "gemini";
  if (isMistralModel(model)) return "mistral";
  if (isDeepseekModel(model)) return "deepseek";
  if (isZhipuModel(model)) return "zhipu";
  if (isStepfunModel(model)) return "stepfun";
  else assertNever(model);
}

/**
 * Factory function to create an LLM instance from a model and config.
 * Centralizes the logic for determining which LLM class to instantiate.
 */
export function createLLM(model: Model, config?: ModelConfig): LLM {
  config = config ?? {};
  if (isAnthropicModel(model)) {
    return new AnthropicLLM(config, model);
  } else if (isGeminiModel(model)) {
    return new GeminiLLM(config, model);
  } else if (isOpenAIModel(model)) {
    return new OpenAILLM(config, model);
  } else if (isMistralModel(model)) {
    return new MistralLLM(config, model);
  } else if (isMoonshotAIModel(model)) {
    return new MoonshotAILLM(config, model);
  } else if (isDeepseekModel(model)) {
    return new DeepseekLLM(config, model);
  } else if (isZhipuModel(model)) {
    return new ZhipuLLM(config, model);
  } else if (isStepfunModel(model)) {
    return new StepfunLLM(config, model);
  } else {
    assertNever(model);
  }
}
