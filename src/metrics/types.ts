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

export type MessageMetrics = {
  experiment: ExperimentMessageMetrics;
  agents: { [agentName: string]: AgentMessageMetrics };
};

export type TokenMetrics = {
  experimentTokenUsage: TokenUsage;
  agentsTokenUsage: { [agentName: string]: TokenUsage };
  tokenThroughput?: number;
};

export type Grade = "STRONG_ACCEPT" | "ACCEPT" | "REJECT" | "STRONG_REJECT";

export function gradeToScore(g: Grade): number {
  switch (g) {
    case "STRONG_ACCEPT":
      return 3;
    case "ACCEPT":
      return 2;
    case "REJECT":
      return 1;
    case "STRONG_REJECT":
      return 0;
  }
}

export function scoreToGrade(s: number): Grade {
  if (s < 0.5) {
    return "STRONG_REJECT";
  } else if (s < 1.5) {
    return "REJECT";
  } else if (s < 2.5) {
    return "ACCEPT";
  } else {
    return "STRONG_ACCEPT";
  }
}

export type ExperimentPublicationMetrics = {
  totalPublications: number;
  totalPublished: number;
  // We give a value from 0 to 3 for each grade, and turn the average into a grade
  averageReviewGrade: Grade;
};

export type AgentPublicationMetrics = {
  totalPublications: number;
  totalPublished: number;
  // We give a value from 0 to 3 for each grade, and turn the average into a grade]
  averageReviewGrade: Grade;
  publicationRate: number;
};

export type PublicationMetrics = {
  experiment: ExperimentPublicationMetrics;
  agents: { [agentName: string]: AgentPublicationMetrics };
};
