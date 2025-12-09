import { and, eq, sum } from "drizzle-orm";
import { token_usages, agents } from "@app/db/schema";
import { AgentResource } from "./agent";
import { MessageResource } from "./messages";
import { db, Tx } from "@app/db";
import { TokenUsage } from "@app/models/index";
import { ExperimentResource } from "./experiment";
import { AnthropicLLM, isAnthropicModel } from "@app/models/anthropic";
import { DeepseekLLM, isDeepseekModel } from "@app/models/deepseek";
import { GeminiLLM, isGeminiModel } from "@app/models/gemini";
import { OpenAILLM, isOpenAIModel } from "@app/models/openai";
import { MistralLLM, isMistralModel } from "@app/models/mistral";
import { MoonshotAILLM, isMoonshotAIModel } from "@app/models/moonshotai";
import { assertNever } from "@app/lib/assert";

export class TokenUsageResource {
  static async experimentTokenUsage(
    experiment: ExperimentResource,
  ): Promise<TokenUsage> {
    const results = await db
      .select({
        total: sum(token_usages.total),
        input: sum(token_usages.input),
        output: sum(token_usages.output),
        cached: sum(token_usages.cached),
        thinking: sum(token_usages.thinking),
      })
      .from(token_usages)
      .where(eq(token_usages.experiment, experiment.toJSON().id));

    return {
      total: Number(results[0].total),
      input: Number(results[0].input),
      output: Number(results[0].output),
      cached: Number(results[0].cached),
      thinking: Number(results[0].thinking),
    };
  }

  static async agentTokenUsage(
    experiment: ExperimentResource,
    agent: AgentResource,
  ): Promise<TokenUsage> {
    const results = await db
      .select({
        total: sum(token_usages.total),
        input: sum(token_usages.input),
        output: sum(token_usages.output),
        cached: sum(token_usages.cached),
        thinking: sum(token_usages.thinking),
      })
      .from(token_usages)
      .where(
        and(
          eq(token_usages.experiment, experiment.toJSON().id),
          eq(token_usages.agent, agent.toJSON().id),
        ),
      );

    return {
      total: Number(results[0].total),
      input: Number(results[0].input),
      output: Number(results[0].output),
      cached: Number(results[0].cached),
      thinking: Number(results[0].thinking),
    };
  }

  /**
   * Calculate total cost for an experiment across all agents
   */
  static async experimentCost(
    experiment: ExperimentResource,
  ): Promise<number> {
    // Get all token usages grouped by agent
    const agentUsages = await db
      .select({
        agentId: token_usages.agent,
        total: sum(token_usages.total),
        input: sum(token_usages.input),
        output: sum(token_usages.output),
        cached: sum(token_usages.cached),
        thinking: sum(token_usages.thinking),
      })
      .from(token_usages)
      .where(eq(token_usages.experiment, experiment.toJSON().id))
      .groupBy(token_usages.agent);

    let totalCost = 0;

    // Calculate cost for each agent using their specific model
    for (const agentUsage of agentUsages) {
      const agentData = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agentUsage.agentId))
        .limit(1);

      if (agentData.length > 0) {
        const tokenUsage: TokenUsage = {
          total: Number(agentUsage.total),
          input: Number(agentUsage.input),
          output: Number(agentUsage.output),
          cached: Number(agentUsage.cached),
          thinking: Number(agentUsage.thinking),
        };

        // Calculate cost using the model's cost method
        const model = agentData[0].model;
        const config = {};
        let llm;

        if (isAnthropicModel(model)) {
          llm = new AnthropicLLM(config, model);
        } else if (isDeepseekModel(model)) {
          llm = new DeepseekLLM(config, model);
        } else if (isGeminiModel(model)) {
          llm = new GeminiLLM(config, model);
        } else if (isOpenAIModel(model)) {
          llm = new OpenAILLM(config, model);
        } else if (isMistralModel(model)) {
          llm = new MistralLLM(config, model);
        } else if (isMoonshotAIModel(model)) {
          llm = new MoonshotAILLM(config, model);
        } else {
          assertNever(model);
        }

        const cost = llm.cost([tokenUsage]);
        totalCost += cost;
      }
    }

    return totalCost;
  }

  static async logUsage(
    experiment: ExperimentResource,
    agent: AgentResource,
    message: MessageResource,
    tokenUsage: TokenUsage,
    options?: { tx?: Tx },
  ): Promise<void> {
    const executor = options?.tx ?? db;
    const [_created] = await executor
      .insert(token_usages)
      .values({
        experiment: experiment.toJSON().id,
        agent: agent.toJSON().id,
        message: message.toJSON().id,
        total: tokenUsage.total,
        input: tokenUsage.input,
        output: tokenUsage.output,
        cached: tokenUsage.cached,
        thinking: tokenUsage.thinking,
      })
      .returning();
  }
}
