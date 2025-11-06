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

  static async tokens(experiment: ExperimentResource): Promise<TokenMetrics> {
    const agents = await AgentResource.listByExperiment(experiment);
    const experimentTokenUsage =
      await TokenUsageResource.getExperimentTokenUsage(experiment);
    const agentsTokenUsage: {
      [agentId: string]: { name: string; usage: TokenUsage };
    } = {};
    for (const agent of agents) {
      agentsTokenUsage[agent.toJSON().id] = {
        name: agent.toJSON().name,
        usage: await TokenUsageResource.getAgentTokenUsage(experiment, agent),
      };
    }
    const tokenThroughput =
      await TokenUsageResource.getTokenThroughput(experiment);
    return {
      experimentTokenUsage,
      agentsTokenUsage,
      tokenThroughput,
    };
  }
}
