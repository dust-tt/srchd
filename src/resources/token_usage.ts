import { and, eq, max, min, sum } from "drizzle-orm";
import { token_usages } from "../db/schema";
import { AgentResource } from "./agent";
import { MessageResource } from "./messages";
import { db, Tx } from "../db";
import { TokenUsage } from "../models/index";
import { ExperimentResource } from "./experiment";

export class TokenUsageResource {
  static async getTokenThroughput(
    experiment: ExperimentResource,
  ): Promise<number | undefined> {
    const results = await db
      .select({
        total: sum(token_usages.total),
        start_time: min(token_usages.created),
        end_time: max(token_usages.created),
      })
      .from(token_usages)
      .where(eq(token_usages.experiment, experiment.toJSON().id))
      .groupBy(token_usages.experiment);

    const { start_time, end_time, total } = {
      ...results[0],
      total: Number(results[0].total),
    };

    if (!start_time || !end_time || end_time <= start_time) {
      return undefined;
    }

    // Divide by 1000 to convert to seconds
    return total / ((end_time.getTime() - start_time.getTime()) / 1000);
  }

  static async getExperimentTokenUsage(
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

  static async getAgentTokenUsage(
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
        ...tokenUsage,
      })
      .returning();
  }
}
