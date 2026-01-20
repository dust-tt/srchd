import { and, eq, sum } from "drizzle-orm";
import { token_usages, agents } from "@app/db/schema";
import { AgentResource } from "./agent";
import { MessageResource } from "./messages";
import { db, Tx } from "@app/db";
import { TokenUsage } from "@app/models/index";
import { ExperimentResource } from "./experiment";
import { createLLM } from "@app/models/provider";
import { concurrentExecutor } from "@app/lib/async";

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
    // Get all token usages grouped by agent with model data in a single query
    const agentUsages = await db
      .select({
        agentId: token_usages.agent,
        model: agents.model,
        total: sum(token_usages.total),
        input: sum(token_usages.input),
        output: sum(token_usages.output),
        cached: sum(token_usages.cached),
        thinking: sum(token_usages.thinking),
      })
      .from(token_usages)
      .innerJoin(agents, eq(token_usages.agent, agents.id))
      .where(eq(token_usages.experiment, experiment.toJSON().id))
      .groupBy(token_usages.agent, agents.model);

    // Calculate cost for each agent in parallel
    const costs = await concurrentExecutor(
      agentUsages,
      async (agentUsage) => {
        const tokenUsage: TokenUsage = {
          total: Number(agentUsage.total ?? 0),
          input: Number(agentUsage.input ?? 0),
          output: Number(agentUsage.output ?? 0),
          cached: Number(agentUsage.cached ?? 0),
          thinking: Number(agentUsage.thinking ?? 0),
        };

        // Calculate cost using the model's cost method
        const llm = createLLM(agentUsage.model);
        return llm.cost([tokenUsage]);
      },
      { concurrency: 8 },
    );

    // Sum all costs
    return costs.reduce((total, cost) => total + cost, 0);
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
