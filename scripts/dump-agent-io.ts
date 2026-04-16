#!/usr/bin/env node

import { AgentResource } from "../src/resources/agent";
import { ExperimentResource } from "../src/resources/experiment";
import { MessageResource } from "../src/resources/messages";

function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function renderContentLines(content: unknown): string[] {
  if (content === null) {
    return ["null"];
  }

  if (content === undefined) {
    return ["undefined"];
  }

  if (
    typeof content === "string" ||
    typeof content === "number" ||
    typeof content === "boolean" ||
    typeof content === "bigint"
  ) {
    return String(content).split("\n");
  }

  if (Array.isArray(content)) {
    if (content.length === 0) {
      return ["(empty)"];
    }

    return content.flatMap((item) => {
      const rendered = renderContentLines(item);
      return rendered.length <= 1
        ? [`- ${rendered[0]}`]
        : ["-", ...rendered.map((line) => `  ${line}`)];
    });
  }

  if (typeof content === "object") {
    const entries = Object.entries(content);
    if (entries.length === 0) {
      return ["(empty)"];
    }

    return entries.flatMap(([key, value]) => {
      if (
        value === null ||
        value === undefined ||
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
      ) {
        return [`${key}: ${String(value)}`];
      }

      return [`${key}:`, ...renderContentLines(value).map((line) => `  ${line}`)];
    });
  }

  return [String(content)];
}

async function main() {
  const [experimentName] = process.argv.slice(2);

  if (!experimentName) {
    console.error("Usage: npx tsx scripts/dump-agent-io.ts <experiment>");
    process.exit(1);
  }

  const experimentRes = await ExperimentResource.findByName(experimentName);
  if (experimentRes.isErr()) {
    console.error(experimentRes.error.message);
    process.exit(1);
  }

  const experiment = experimentRes.value;
  const experimentData = experiment.toJSON();
  const agents = await AgentResource.listByExperiment(experiment);
  agents.sort((a, b) => a.toJSON().name.localeCompare(b.toJSON().name));

  const lines: string[] = [];
  lines.push(`# experiment=${experimentData.name} id=${experimentData.id}`);
  lines.push(`# problem=${experimentData.problem}`);
  lines.push(`# generated_at=${new Date().toISOString()}`);
  lines.push("");

  for (const agent of agents) {
    const agentData = agent.toJSON();
    const messages = await MessageResource.listMessagesByAgent(experiment, agent);

    lines.push(
      `## agent=${agentData.name} id=${agentData.id} provider=${agentData.provider} model=${agentData.model} thinking=${agentData.thinking}`,
    );
    lines.push("");

    for (const message of messages) {
      const messageData = message.toJSON();
      lines.push(
        `message id=${messageData.id} position=${message.position()} role=${messageData.role} created=${message.created().toISOString()}`,
      );

      for (const item of messageData.content) {
        switch (item.type) {
          case "text": {
            lines.push("text:");
            lines.push(indent(item.text));
            break;
          }
          case "thinking": {
            lines.push("thinking:");
            lines.push(indent(item.thinking));
            break;
          }
          case "tool_use": {
            lines.push(`tool_use name=${item.name} id=${item.id}`);
            lines.push(indent(renderContentLines(item.input).join("\n")));
            break;
          }
          case "tool_result": {
            lines.push(
              `tool_result name=${item.toolUseName} id=${item.toolUseId} error=${item.isError}`,
            );
            lines.push(indent(renderContentLines(item.content).join("\n")));
            break;
          }
        }
      }

      lines.push("");
    }
  }

  process.stdout.write(lines.join("\n"));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
