import { AgentResource } from "./resources/agent";
import { ExperimentResource } from "./resources/experiment";
import { MessageResource } from "./resources/messages";
import { PublicationResource } from "./resources/publication";
import { TokenUsageResource } from "./resources/token_usage";

function sum(acc: number, cur: number): number {
  return acc + cur;
}

export class Metrics {
  /**
   * Calculates the following metrics for an experiment:
   * - Total number of messages
   * - Number of agent messages
   * - Number of tool call messages
   * - Number of thinking messages
   * @param experiment
   * @returns experiment message metrics
   */
  private static async experimentMessages(
    experiment: ExperimentResource,
  ): Promise<ExperimentMessageMetrics | undefined> {
    const messages = await MessageResource.listMessagesByExperiment(experiment);
    const totalMessages = messages.length;
    if (totalMessages === 0) {
      return undefined;
    }
    const fullMessages = messages.map((msg) => msg.toJSON());
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
      agentMessages,
    };
  }

  /**
   * Calculates the following metrics for an agent:
   * - Total number of messages
   * - Number of tool calls
   * - Number of thinking content
   * - Number of agentic loops
   * - Average number of messages per agentic loop
   * - Average number of tool calls per agentic loop
   * - Average number of thinking per agentic loop
   * @param experiment
   * @param agent
   * @returns agent message metrics
   */
  private static async agentMessages(
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
    const toolCalls = fullMessages.reduce(
      (acc, msg) =>
        msg.content.filter((c) => c.type === "tool_use").length + acc,
      0,
    );
    const thinking = fullMessages.reduce(
      (acc, msg) =>
        msg.content.filter((c) => c.type === "thinking").length + acc,
      0,
    );
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

      const tooluses = content_types.filter((t) => t === "tool_use").length;
      toolCallsPerAgenticLoopAgg[agenticLoopsPassed] += tooluses;

      const thinkings = content_types.filter((t) => t === "thinking").length;
      thinkingPerAgenticLoopAgg[agenticLoopsPassed] += thinkings;
    }

    const messagesPerAgenticLoop =
      messagesPerAgenticLoopAgg.reduce(sum, 0) / agenticLoops;
    const toolCallsPerAgenticLoop =
      toolCallsPerAgenticLoopAgg.reduce(sum, 0) / agenticLoops;
    const thinkingPerAgenticLoop =
      thinkingPerAgenticLoopAgg.reduce(sum, 0) / agenticLoops;

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

  /**
   * Calculates the metrics of an experiment and its agents
   * @param experiment
   * @returns experiment and agent message metrics
   */
  static async messages(
    experiment: ExperimentResource,
  ): Promise<MessageMetrics | undefined> {
    return Metrics.experimentAndAgentMetrics(
      experiment,
      (e) => Metrics.experimentMessages(e),
      (e, a) => Metrics.agentMessages(e, a),
    );
  }

  /**
   * Calculates the following metrics for an experiment:
   * - Experiment token usage
   * - Agent token usage for each agent
   * - Token throughput
   * @param experiment
   * @returns token metrics
   */
  static async tokenUsage(
    experiment: ExperimentResource,
  ): Promise<TokenMetrics | undefined> {
    return await Metrics.experimentAndAgentMetrics(
      experiment,
      async (e) => {
        const usage = await TokenUsageResource.getExperimentTokenUsage(e);
        const tokensPerSecond =
          await TokenUsageResource.getTokensPerSecond(experiment);
        return {
          ...usage,
          tokensPerSecond,
        };
      },
      (e, a) => TokenUsageResource.getAgentTokenUsage(e, a),
    );
  }

  /**
   * Calculates the following metrics for an experiment:
   * - Total number of publications
   * - Total number of published publications
   * - Average review grade
   * @param experiment
   * @returns experiment publication metrics
   */
  private static async experimentPublications(
    experiment: ExperimentResource,
  ): Promise<ExperimentPublicationMetrics | undefined> {
    const publications = await PublicationResource.listByExperiment(experiment);
    const totalPublications = publications.length;
    if (totalPublications === 0) {
      return undefined;
    }

    const totalPublished = publications.filter(
      (p) => p.toJSON().status === "PUBLISHED",
    ).length;

    return {
      totalPublications,
      totalPublished,
    };
  }

  /**
   * Calculates the following metrics for an agent:
   * - Total number of publications
   * - Total number of published publications
   * - Average review grade
   * - Publication rate
   * @param experiment
   * @param agent
   * @returns agent publication metrics
   */
  private static async agentPublications(
    experiment: ExperimentResource,
    agent: AgentResource,
  ): Promise<AgentPublicationMetrics | undefined> {
    const publications = await PublicationResource.listByAuthor(
      experiment,
      agent,
    );
    const totalPublications = publications.length;
    if (totalPublications === 0) {
      return undefined;
    }

    const totalPublished = publications.filter(
      (p) => p.toJSON().status === "PUBLISHED",
    ).length;

    const publicationRate = totalPublished / totalPublications;

    return {
      totalPublications,
      totalPublished,
      publicationRate,
    };
  }

  /**
   * Calculates the publication metrics of an experiment and its agents
   * @param experiment
   * @returns experiment and agent publication metrics
   */
  static async publications(
    experiment: ExperimentResource,
  ): Promise<PublicationMetrics | undefined> {
    return Metrics.experimentAndAgentMetrics(
      experiment,
      (e) => Metrics.experimentPublications(e),
      (e, a) => Metrics.agentPublications(e, a),
    );
  }

  private static async experimentAndAgentMetrics<E, A>(
    experiment: ExperimentResource,
    experimentRetriever: (
      experiment: ExperimentResource,
    ) => Promise<E | undefined>,
    agentRetriever: (
      experiment: ExperimentResource,
      agent: AgentResource,
    ) => Promise<A | undefined>,
  ): Promise<UnifiedMetrics<E, A> | undefined> {
    const experimentMetrics = await experimentRetriever(experiment);
    if (!experimentMetrics) {
      return undefined;
    }
    const agents = await AgentResource.listByExperiment(experiment);

    const agentsMetrics: {
      [agentName: string]: A;
    } = {};

    for (const agent of agents) {
      const metrics = await agentRetriever(experiment, agent);
      if (!metrics) {
        // Note: this shouldn't happen as all the agents are extracted from the experiment
        continue;
      }
      agentsMetrics[agent.toJSON().name] = metrics;
    }
    return {
      experiment: experimentMetrics,
      agents: agentsMetrics,
    };
  }
}

import { TokenUsage } from "./models";

export interface UnifiedMetrics<E, A = E> {
  experiment: E;
  agents: { [agentName: string]: A };
}

export type ExperimentMessageMetrics = {
  totalMessages: number;
  toolCalls: number;
  thinking: number;
  agentMessages: number;
};

export type AgentMessageMetrics = {
  totalMessages: number;
  toolCalls: number;
  thinking: number;
  agenticLoops: number;
  messagesPerAgenticLoop: number;
  toolCallsPerAgenticLoop: number;
  thinkingPerAgenticLoop: number;
};

export type MessageMetrics = {
  experiment: ExperimentMessageMetrics;
  agents: { [agentName: string]: AgentMessageMetrics };
};

export type TokenMetrics = {
  experiment: TokenUsage & { tokensPerSecond?: number };
  agents: { [agentName: string]: TokenUsage };
};

export type ExperimentPublicationMetrics = {
  totalPublications: number;
  totalPublished: number;
};

export type AgentPublicationMetrics = {
  totalPublications: number;
  totalPublished: number;
  publicationRate: number;
};

export type PublicationMetrics = {
  experiment: ExperimentPublicationMetrics;
  agents: { [agentName: string]: AgentPublicationMetrics };
};
