import { TokenUsage } from "./models";
import { AgentResource } from "./resources/agent";
import { ExperimentResource } from "./resources/experiment";
import { MessageResource } from "./resources/messages";
import { PublicationResource } from "./resources/publication";
import { TokenUsageResource } from "./resources/token_usage";

export interface ExperimentMetrics<M> {
  experiment: M;
  agents: { [agentName: string]: M };
}

export type MessageMetric = {
  totalMessages: number;
  toolCalls: number;
  thinking: number;
  agentMessages: number;
};

export type PublicationMetric = {
  totalPublications: number;
  totalPublished: number;
};

function calculateMessageMetrics(messages: MessageResource[]): MessageMetric {
  const totalMessages = messages.length;
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

export async function messagesMetricsByExperiment(
  experiment: ExperimentResource,
): Promise<ExperimentMetrics<MessageMetric>> {
  return metricsForExperiment(
    experiment,
    async (e) => MessageResource.listMessagesByExperiment(e),
    async (e, a) => MessageResource.listMessagesByAgent(e, a),
    calculateMessageMetrics,
  );
}

export async function tokenUsageMetricsByExperiment(
  experiment: ExperimentResource,
): Promise<ExperimentMetrics<TokenUsage>> {
  return metricsForExperiment(
    experiment,
    async (e) => TokenUsageResource.experimentTokenUsage(e),
    async (e, a) => TokenUsageResource.agentTokenUsage(e, a),
    (d) => d,
  );
}

function calculatePublicationMetrics(
  publications: PublicationResource[],
): PublicationMetric {
  const totalPublications = publications.length;

  const totalPublished = publications.filter(
    (p) => p.toJSON().status === "PUBLISHED",
  ).length;

  return {
    totalPublications,
    totalPublished,
  };
}

export async function publicationsMetricsByExperiment(
  experiment: ExperimentResource,
): Promise<ExperimentMetrics<PublicationMetric>> {
  return await metricsForExperiment(
    experiment,
    (e) => PublicationResource.listByExperiment(e),
    (e, a) => PublicationResource.listByAuthor(e, a),
    calculatePublicationMetrics,
  );
}

async function metricsForExperiment<M, D>(
  experiment: ExperimentResource,
  experimentDataRetriever: (experiment: ExperimentResource) => Promise<D>,
  agentDataRetriever: (
    experiment: ExperimentResource,
    agent: AgentResource,
  ) => Promise<D>,
  calculateMetrics: (data: D) => M,
): Promise<ExperimentMetrics<M>> {
  const experimentData = await experimentDataRetriever(experiment);
  const experimentMetrics = calculateMetrics(experimentData);
  const agents = await AgentResource.listByExperiment(experiment);

  const agentsMetrics: {
    [agentName: string]: M;
  } = {};

  for (const agent of agents) {
    const agentData = await agentDataRetriever(experiment, agent);
    const agentMetrics = calculateMetrics(agentData);
    agentsMetrics[agent.toJSON().name] = agentMetrics;
  }
  return {
    experiment: experimentMetrics,
    agents: agentsMetrics,
  };
}
