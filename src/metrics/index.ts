import { TokenUsage } from "../models";
import { AgentResource } from "../resources/agent";
import { ExperimentResource } from "../resources/experiment";
import { MessageResource } from "../resources/messages";
import { TokenUsageResource } from "../resources/token_usage";
import {
  ExperimentMessageMetrics,
  AgentMessageMetrics,
  TokenMetrics,
} from "./types";

export class Metrics {
  static async experimentMessages(
    experiment: ExperimentResource,
  ): Promise<ExperimentMessageMetrics | undefined> {
    const messages = await MessageResource.listMessagesByExperiment(experiment);
    const totalMessages = messages.length;
    if (totalMessages === 0) {
      return undefined;
    }
    const fullMessages = messages.map((msg) => msg.toJSON());
    const userMessages = fullMessages.filter(
      (msg) => msg.role === "user",
    ).length;
    const agentMessages = fullMessages.filter(
      (msg) => msg.role === "agent",
    ).length;
    const toolCalls = fullMessages.filter((msg) =>
      msg.content.some((c) => c.type === "tool_use"),
    ).length;
    const thinking = fullMessages.filter((msg) =>
      msg.content.some((c) => c.type === "thinking"),
    ).length;

    return {
      totalMessages,
      toolCalls,
      thinking,
      userMessages,
      agentMessages,
    };
  }

  static async agentMessages(
    experiment: ExperimentResource,
    agent: AgentResource,
  ): Promise<AgentMessageMetrics | undefined> {
    const messages = await MessageResource.listMessagesByAgent(
      experiment,
      agent,
    );
    const totalMessages = messages.length;
    if (totalMessages === 0) {
      return undefined;
    }

    const fullMessages = messages.map((msg) => msg.toJSON());
    const toolCalls = fullMessages.filter((msg) =>
      msg.content.some((c) => c.type === "tool_use"),
    ).length;
    const thinking = fullMessages.filter((msg) =>
      msg.content.some((c) => c.type === "thinking"),
    ).length;
    const agenticLoops = fullMessages.filter(
      (msg) =>
        msg.role === "user" && msg.content.every((c) => c.type === "text"),
    ).length;

    // We aggregate on agentic loops
    const messagesPerAgenticLoopAgg = [0];
    const toolCallsPerAgenticLoopAgg = [0];
    const thinkingPerAgenticLoopAgg = [0];
    let agenticLoopsPassed = 0;
    // We start at 1 because the first message is always the user's first message
    for (let i = 1; i < fullMessages.length; i++) {
      messagesPerAgenticLoopAgg[agenticLoopsPassed]++;
      const role = fullMessages[i].role;
      const content_types = fullMessages[i].content.map((c) => c.type);

      if (role === "user" && content_types.every((t) => t === "text")) {
        // On each agentic loop we aggregate on a new index
        agenticLoopsPassed += 1;
        messagesPerAgenticLoopAgg.push(0);
        toolCallsPerAgenticLoopAgg.push(0);
        thinkingPerAgenticLoopAgg.push(0);
      }

      if (content_types.some((t) => t === "tool_use")) {
        toolCallsPerAgenticLoopAgg[agenticLoopsPassed]++;
      }
      if (content_types.some((t) => t === "thinking")) {
        thinkingPerAgenticLoopAgg[agenticLoopsPassed]++;
      }
    }

    // ∑ (x/n) = (∑ x)/n
    const avg = (acc: number, cur: number) => acc + cur / agenticLoops;

    const messagesPerAgenticLoop = messagesPerAgenticLoopAgg.reduce(avg, 0);
    const toolCallsPerAgenticLoop = toolCallsPerAgenticLoopAgg.reduce(avg, 0);
    const thinkingPerAgenticLoop = thinkingPerAgenticLoopAgg.reduce(avg, 0);

    return {
      totalMessages,
      toolCalls,
      thinking,
      agenticLoops,
      messagesPerAgenticLoop,
      toolCallsPerAgenticLoop,
      thinkingPerAgenticLoop,
    };
  }

  static async fullTokens(
    experiment: ExperimentResource,
  ): Promise<TokenMetrics> {
    const experimentTokenUsage = await this.experimentTokens(experiment);

    const agents = await AgentResource.listByExperiment(experiment);
    const agentsTokenUsage: {
      [agentName: string]: TokenUsage;
    } = {};
    for (const agent of agents) {
      agentsTokenUsage[agent.toJSON().name] = await this.agentTokens(
        experiment,
        agent,
      );
    }

    const tokenThroughput =
      await TokenUsageResource.getTokenThroughput(experiment);

    return {
      experimentTokenUsage,
      agentsTokenUsage,
      tokenThroughput,
    };
  }

  static async experimentTokens(
    experiment: ExperimentResource,
  ): Promise<TokenUsage> {
    return await TokenUsageResource.getExperimentTokenUsage(experiment);
  }

  static async agentTokens(
    experiment: ExperimentResource,
    agent: AgentResource,
  ): Promise<TokenUsage> {
    return await TokenUsageResource.getAgentTokenUsage(experiment, agent);
  }
}
