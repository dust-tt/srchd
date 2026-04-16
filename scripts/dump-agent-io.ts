#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentResource } from "../src/resources/agent";
import { ExperimentResource } from "../src/resources/experiment";
import { MessageResource } from "../src/resources/messages";

async function main() {
  const [experimentName, outputArg] = process.argv.slice(2);

  if (!experimentName) {
    console.error(
      "Usage: npx tsx scripts/dump-agent-io.ts <experiment> [output-file]",
    );
    process.exit(1);
  }

  const experimentRes = await ExperimentResource.findByName(experimentName);
  if (experimentRes.isErr()) {
    console.error(experimentRes.error.message);
    process.exit(1);
  }

  const experiment = experimentRes.value;
  const outputPath = path.resolve(
    outputArg ?? `./${experimentName}-agent-io.json`,
  );

  const agents = await AgentResource.listByExperiment(experiment);
  agents.sort((a, b) => a.toJSON().name.localeCompare(b.toJSON().name));

  const agentsDump = await Promise.all(
    agents.map(async (agent) => {
      const agentData = agent.toJSON();
      const messages = await MessageResource.listMessagesByAgent(experiment, agent);

      return {
        id: agentData.id,
        name: agentData.name,
        provider: agentData.provider,
        model: agentData.model,
        thinking: agentData.thinking,
        messages: messages.map((message) => {
          const messageData = message.toJSON();

          return {
            id: messageData.id,
            position: message.position(),
            created: message.created().toISOString(),
            role: messageData.role,
            content: messageData.content,
          };
        }),
      };
    }),
  );

  const dump = {
    generatedAt: new Date().toISOString(),
    experiment: {
      id: experiment.toJSON().id,
      name: experiment.toJSON().name,
      problem: experiment.toJSON().problem,
      created: experiment.toJSON().created.toISOString(),
      updated: experiment.toJSON().updated.toISOString(),
    },
    agents: agentsDump,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(dump, null, 2) + "\n", "utf8");

  console.log(`Wrote ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
