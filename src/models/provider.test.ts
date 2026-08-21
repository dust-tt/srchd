import { describe, expect, it } from "vitest";
import { clampContextSize, MAX_CONTEXT_SIZE_TOKENS } from ".";
import { providerFromModel, type Model } from "./provider";

const recentModels: Array<[Model, ReturnType<typeof providerFromModel>]> = [
  ["kimi-k3", "moonshotai"],
  ["glm-5.2", "zhipu"],
  ["glm-5.3", "zhipu"],
  ["gpt-5.4-mini", "openai"],
  ["gpt-5.4-nano", "openai"],
  ["gpt-5.4-pro", "openai"],
  ["gpt-5.5-pro", "openai"],
  ["gpt-5.6", "openai"],
  ["gpt-5.6-sol", "openai"],
  ["gpt-5.6-terra", "openai"],
  ["gpt-5.6-luna", "openai"],
  ["gpt-5.6-cyber", "openai"],
  ["claude-opus-4-7", "anthropic"],
  ["claude-opus-4-8", "anthropic"],
  ["claude-fable-5", "anthropic"],
  ["claude-mythos-5", "anthropic"],
  ["claude-opus-5", "anthropic"],
  ["claude-sonnet-5", "anthropic"],
];

describe("recent model routing", () => {
  it.each(recentModels)("routes %s to %s", (model, expectedProvider) => {
    expect(providerFromModel(model)).toBe(expectedProvider);
  });
});

describe("model context clamp", () => {
  it("caps large model contexts at 512k tokens", () => {
    expect(clampContextSize(1_050_000)).toBe(512_000);
    expect(clampContextSize(Infinity)).toBe(512_000);
  });

  it("preserves smaller model contexts", () => {
    expect(clampContextSize(256_000)).toBe(256_000);
    expect(MAX_CONTEXT_SIZE_TOKENS).toBe(512_000);
  });
});
