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

export type RuntimeMetric = {
  totalRuntimeMs: number;
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

export async function messageMetricsByExperiment(
  experiment: ExperimentResource,
  options?: { before?: Date },
): Promise<ExperimentMetrics<MessageMetric>> {
  return metricsForExperiment(
    experiment,
    async (e) => MessageResource.listMessagesByExperiment(e, options),
    async (e, a) => MessageResource.listMessagesByAgent(e, a, options),
    calculateMessageMetrics,
  );
}

export async function tokenUsageMetricsByExperiment(
  experiment: ExperimentResource,
  options?: { before?: Date },
): Promise<ExperimentMetrics<TokenUsage>> {
  return metricsForExperiment(
    experiment,
    async (e) => TokenUsageResource.experimentTokenUsage(e, options),
    async (e, a) => TokenUsageResource.agentTokenUsage(e, a, options),
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

export async function publicationMetricsByExperiment(
  experiment: ExperimentResource,
  options?: { before?: Date },
): Promise<ExperimentMetrics<PublicationMetric>> {
  return await metricsForExperiment(
    experiment,
    (e) => PublicationResource.listByExperiment(e, options),
    (e, a) => PublicationResource.listByAuthor(e, a, options),
    calculatePublicationMetrics,
  );
}

interface RuntimeRun {
  startTimestampMs: number;
  endTimestampMs: number;
  durationMs: number;
}

/**
 * Detects runtime runs by finding gaps in message timestamps.
 * A gap is defined as > 1 minute between consecutive messages.
 * Returns an array of continuous runtime segments.
 */
function detectRuntimeRuns(
  messages: MessageResource[],
): RuntimeRun[] {
  // Extract and sort timestamps
  const sortedTimestampsMs = messages
    .map((msg) => msg.created().getTime())
    .sort((a, b) => a - b);

  if (sortedTimestampsMs.length === 0) {
    return [];
  }

  const GAP_THRESHOLD_MS = 60 * 1000; // 1 minute
  const runs: RuntimeRun[] = [];

  let runStartTime = sortedTimestampsMs[0];
  let lastMessageTime = runStartTime;

  for (let i = 1; i < sortedTimestampsMs.length; i++) {
    const currentMessageTime = sortedTimestampsMs[i];
    const gap = currentMessageTime - lastMessageTime;

    if (gap > GAP_THRESHOLD_MS) {
      // Gap detected - close current run
      runs.push({
        startTimestampMs: runStartTime,
        endTimestampMs: lastMessageTime,
        durationMs: lastMessageTime - runStartTime,
      });

      // Start new run
      runStartTime = currentMessageTime;
    }

    lastMessageTime = currentMessageTime;
  }

  // Add the final run
  runs.push({
    startTimestampMs: runStartTime,
    endTimestampMs: lastMessageTime,
    durationMs: lastMessageTime - runStartTime,
  });

  return runs;
}

/**
 * Calculate total runtime by summing all runtime runs.
 */
function calculateRuntimeMetrics(messages: MessageResource[]): RuntimeMetric {
  const runs = detectRuntimeRuns(messages);
  return { totalRuntimeMs: runs.reduce((total, run) => total + run.durationMs, 0) };
}

/**
 * Find the timestamp that corresponds to a specific runtime offset from experiment start.
 * Returns null if the target runtime exceeds the available runtime.
 */
export function findTimestampAtRuntimeOffset(
  messages: MessageResource[],
  targetRuntimeMs: number,
): Date | null {
  const runs = detectRuntimeRuns(messages);

  if (runs.length === 0) {
    return null;
  }

  let accumulatedRuntimeMs = 0;

  for (const run of runs) {
    const runEndRuntime = accumulatedRuntimeMs + run.durationMs;

    if (runEndRuntime >= targetRuntimeMs) {
      // Target is within this run
      const offsetIntoRun = targetRuntimeMs - accumulatedRuntimeMs;
      return new Date(run.startTimestampMs + offsetIntoRun);
    }

    accumulatedRuntimeMs = runEndRuntime;
  }

  // Target runtime exceeds total runtime
  return null;
}

export async function runtimeMetricsByExperiment(
  experiment: ExperimentResource,
  options?: { before?: Date },
): Promise<RuntimeMetric> {
  const messages = await MessageResource.listMessagesByExperiment(experiment, options);
  return calculateRuntimeMetrics(messages);
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
