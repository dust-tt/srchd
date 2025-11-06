import { TokenUsage } from "../models";

export type ExperimentMessageMetrics = {
  totalMessages: number;
  toolCalls: number;
  thinking: number;
  userMessages: number;
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

export type TokenMetrics = {
  experimentTokenUsage: TokenUsage;
  agentsTokenUsage: { [agentId: string]: { name: string; usage: TokenUsage } };
  tokenThroughput?: number;
};
