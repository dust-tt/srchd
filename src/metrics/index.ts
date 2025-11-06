import { AgentResource } from "../resources/agent";
import { ExperimentResource } from "../resources/experiment";
import { MessageResource } from "../resources/messages";
import { PublicationResource } from "../resources/publication";
import { ExperimentMessageMetrics, AgentMessageMetrics } from "./types";

export class Metrics {
  private experiment: ExperimentResource;
  private agents: AgentResource[];
  private publications: PublicationResource[];

  constructor(
    experiment: ExperimentResource,
    agents: AgentResource[],
    publications: PublicationResource[],
  ) {
    this.experiment = experiment;
    this.agents = agents;
    this.publications = publications;
  }

  static async create(experiment: ExperimentResource): Promise<Metrics> {
    const agents = await AgentResource.listByExperiment(experiment);
    const publications = await PublicationResource.listByExperiment(experiment);
    return new Metrics(experiment, agents, publications);
  }

  async getExperimentMessageMetrics(): Promise<
    ExperimentMessageMetrics | undefined
  > {
    const messages = await MessageResource.listMessagesByExperiment(
      this.experiment,
    );
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

  async getAgentMessageMetrics(): Promise<(AgentMessageMetrics | undefined)[]> {
    return Promise.all(
      this.agents.map((agent) => this.getSingleAgentMessageMetrics(agent)),
    );
  }

  private async getSingleAgentMessageMetrics(
    agent: AgentResource,
  ): Promise<AgentMessageMetrics | undefined> {
    const messages = await MessageResource.listMessagesByAgent(
      this.experiment,
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
    for (let i = 0; i < fullMessages.length; i++) {
      if (
        fullMessages[i].role === "user" &&
        fullMessages[i].content.every((c) => c.type === "text")
      ) {
        // On each agentic loop we aggregate on a new index
        agenticLoopsPassed += 1;
        messagesPerAgenticLoopAgg.push(0);
        toolCallsPerAgenticLoopAgg.push(0);
        thinkingPerAgenticLoopAgg.push(0);
      }

      messagesPerAgenticLoopAgg[agenticLoopsPassed] += 1;
      if (fullMessages[i].content.some((c) => c.type === "tool_use")) {
        toolCallsPerAgenticLoopAgg[agenticLoopsPassed] += 1;
      }
      if (fullMessages[i].content.some((c) => c.type === "thinking")) {
        thinkingPerAgenticLoopAgg[agenticLoopsPassed] += 1;
      }
    }

    const messagesPerAgenticLoop =
      messagesPerAgenticLoopAgg.reduce((acc, cur) => acc + cur, 0) /
      agenticLoops;
    const toolCallsPerAgenticLoop =
      toolCallsPerAgenticLoopAgg.reduce((acc, cur) => acc + cur, 0) /
      agenticLoops;
    const thinkingPerAgenticLoop =
      thinkingPerAgenticLoopAgg.reduce((acc, cur) => acc + cur, 0) /
      agenticLoops;

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
}
