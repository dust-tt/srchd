#!/usr/bin/env node

import { Command } from "commander";
import { readFileContent } from "./lib/fs";
import { Err, err, ok, Result, SrchdError } from "./lib/error";
import { ExperimentResource } from "./resources/experiment";
import { AgentResource } from "./resources/agent";
import { MessageResource } from "./resources/messages";
import { PublicationResource } from "./resources/publication";
import { Runner } from "./runner";
import { isArrayOf, isString, newID4, removeNulls } from "./lib/utils";
import { isThinkingConfig } from "./models";
import { isAnthropicModel } from "./models/anthropic";
import { isOpenAIModel } from "./models/openai";
import { isGeminiModel } from "./models/gemini";
import { isMoonshotAIModel } from "./models/moonshotai";
import { serve } from "@hono/node-server";
import { createApp, type BasicAuthConfig } from "./server";
import { isMistralModel } from "./models/mistral";
import {
  messageMetricsByExperiment,
  tokenUsageMetricsByExperiment,
  publicationMetricsByExperiment,
  runtimeMetricsByExperiment,
  findTimestampAtRuntimeOffset,
} from "./metrics";
import { ExperimentMetrics } from "./metrics";
import {
  buildComputerImage,
  dockerFile,
  dockerFileForIdentity,
} from "./computer/image";
import { Computer, computerId } from "./computer";
import { providerFromModel } from "./models/provider";
import { copyToComputer } from "./computer/k8s";
import {
  AgentProfile,
  getAgentProfile,
  listAgentProfiles,
} from "./agent_profile";
import { isDeepseekModel } from "./models/deepseek";
import { TokenUsageResource } from "./resources/token_usage";

const exitWithError = (err: Err<SrchdError>) => {
  console.error(
    `\x1b[31mError [${err.error.code}] ${err.error.message}\x1b[0m`,
  );
  if (err.error.cause) {
    console.error(`\x1b[31mCause: ${err.error.cause.message}\x1b[0m`);
  }
  process.exit(1);
};

async function experimentAndAgents({
  experiment,
  agent,
}: {
  experiment: string;
  agent?: string;
}): Promise<Result<[ExperimentResource, AgentResource[]]>> {
  const experimentRes = await ExperimentResource.findByName(experiment);
  if (experimentRes.isErr()) {
    return experimentRes;
  }
  if (!agent) {
    return ok([experimentRes.value, []]);
  }

  const agentResources: AgentResource[] = [];

  if (agent === "all") {
    agentResources.push(
      ...(await AgentResource.listByExperiment(experimentRes.value)),
    );
    return ok([experimentRes.value, agentResources]);
  }

  const agentRes = await AgentResource.findByName(experimentRes.value, agent);
  if (agentRes.isErr()) {
    return agentRes;
  }
  agentResources.push(agentRes.value);
  return ok([experimentRes.value, agentResources]);
}

const DEFAULT_REVIEWERS_COUNT = 4;

const program = new Command();

program
  .name("srchd")
  .description("Research experiment management CLI")
  .version("1.0.0");

const metricsCmd = program.command("metrics").description("Show metrics");

async function displayMetrics<M>(
  experiment: string,
  metricsByExperiment: (
    e: ExperimentResource,
    options?: { before?: Date },
  ) => Promise<ExperimentMetrics<M>>,
  options?: { before?: Date },
): Promise<void> {
  const res = await experimentAndAgents({ experiment });
  if (res.isErr()) {
    return exitWithError(res);
  }
  const [experimentRes] = res.value;
  const metrics = await metricsByExperiment(experimentRes, options);
  if (!metrics) {
    return exitWithError(
      err("not_found_error", `Experiment '${experiment}' not found.`),
    );
  }

  console.table([metrics.experiment]);
  const agents = [];
  for (const [name, agentMetrics] of Object.entries(metrics.agents)) {
    agents.push({ name, ...agentMetrics });
  }
  console.table(agents);
}

async function displayRuntimeAndCost(
  experiment: ExperimentResource,
  options?: { before?: Date },
): Promise<void> {
  const cost = await TokenUsageResource.experimentCost(experiment, options);
  const formattedCost = cost < 0.01
    ? `$${cost.toFixed(6)}`
    : cost < 1
      ? `$${cost.toFixed(4)}`
      : `$${cost.toFixed(2)}`;

  const runtime = await runtimeMetricsByExperiment(experiment, options);
  const runtimeSeconds = runtime.totalRuntimeMs / 1000;
  const runtimeMinutes = runtimeSeconds / 60;
  const runtimeHours = runtimeMinutes / 60;

  const formattedRuntime = runtimeHours >= 1
    ? `${runtimeHours.toFixed(2)} hours`
    : runtimeMinutes >= 1
      ? `${runtimeMinutes.toFixed(2)} minutes`
      : `${runtimeSeconds.toFixed(2)} seconds`;

  console.log(`\nTotal Cost: ${formattedCost}`);
  console.log(`Total Runtime: ${formattedRuntime}`);
}

async function handleBefore(
  experiment: string,
  beforeValue: string | undefined,
): Promise<{ experimentRes: ExperimentResource; beforeDate: Date | undefined }> {
  const res = await experimentAndAgents({ experiment });
  if (res.isErr()) {
    return exitWithError(res);
  }
  const [experimentRes] = res.value;

  if (!beforeValue) {
    return { experimentRes, beforeDate: undefined };
  }

  // Determine if it's minutes (<=3 digits) or publication reference (all 4 chars) (>3 chars)
  const isMinutes = beforeValue.length <= 3;

  if (isMinutes) {
    // Parse as minutes of runtime from start
    const minutes = parseInt(beforeValue, 10);
    if (isNaN(minutes) || minutes < 1 || minutes > 999) {
      return exitWithError(
        err(
          "invalid_parameters_error",
          `Invalid minutes value '${beforeValue}'. Must be a positive number between 1 and 999.`,
        ),
      );
    }
    const targetRuntimeMs = minutes * 60 * 1000;

    // Fetch messages and calculate runtime offset
    const messages = await MessageResource.listMessagesByExperiment(experimentRes);
    const timestamp = findTimestampAtRuntimeOffset(messages, targetRuntimeMs);

    if (!timestamp) {
      console.warn(`Warning: Target runtime ${minutes} minutes exceeds total experiment runtime.`);
      return { experimentRes, beforeDate: undefined };
    }

    return { experimentRes, beforeDate: timestamp };
  } else {
    // Treat as publication reference
    const publication = await PublicationResource.findByReference(
      experimentRes,
      beforeValue,
    );
    if (!publication) {
      console.warn(`Warning: Publication with reference '${beforeValue}' not found.`);
      return { experimentRes, beforeDate: undefined };
    }

    return { experimentRes, beforeDate: publication.toJSON().updated };
  }
}

metricsCmd
  .command("messages")
  .description("Show message metrics")
  .argument("<experiment>", "Experiment name")
  .option(
    "--before <value>",
    "Only count messages before: minutes of runtime (1-999) or publication reference (e.g., ejhy)",
  )
  .action(async (experiment, cmdOptions) => {
    const { beforeDate } = await handleBefore(experiment, cmdOptions.before);
    await displayMetrics(experiment, messageMetricsByExperiment, {
      before: beforeDate,
    });
  });

metricsCmd
  .command("token-usage")
  .description("Show token usage and cost")
  .argument("<experiment>", "Experiment name")
  .option(
    "--before <value>",
    "Only count token usage before: minutes of runtime (1-999) or publication reference (e.g., ejhy)",
  )
  .action(async (experiment, cmdOptions) => {
    const { experimentRes, beforeDate } = await handleBefore(experiment, cmdOptions.before);

    await displayMetrics(experiment, tokenUsageMetricsByExperiment, {
      before: beforeDate,
    });

    await displayRuntimeAndCost(experimentRes, { before: beforeDate });
  });

metricsCmd
  .command("publications")
  .description("Calculate publication metrics")
  .argument("<experiment>", "Experiment name")
  .option(
    "--before <value>",
    "Only count publications before: minutes of runtime (1-999) or publication reference (e.g., ejhy)",
  )
  .action(async (experiment, cmdOptions) => {
    const { beforeDate } = await handleBefore(experiment, cmdOptions.before);
    await displayMetrics(experiment, publicationMetricsByExperiment, {
      before: beforeDate,
    });
  });

// Experiment commands
const experimentCmd = program
  .command("experiment")
  .description("Manage experiments");

experimentCmd
  .command("create <name>")
  .description("Create a new experiment")
  .requiredOption(
    "-p, --problem <problem_file>",
    "Problem description file path",
  )
  .action(async (name, options) => {
    console.log(`Creating experiment: ${name}`);

    // Read problem from file
    const problem = await readFileContent(options.problem);
    if (problem.isErr()) {
      return exitWithError(problem);
    }

    const experiment = await ExperimentResource.create({
      name,
      problem: problem.value,
    });

    const e = experiment.toJSON();
    e.problem =
      e.problem.substring(0, 32) + (e.problem.length > 32 ? "..." : "");
    console.table([e]);
  });

experimentCmd
  .command("list")
  .description("List all experiments")
  .action(async () => {
    const experiments = await ExperimentResource.all();

    if (experiments.length === 0) {
      return exitWithError(err("not_found_error", "No experiments found."));
    }

    console.table(
      experiments.map((exp) => {
        const e = exp.toJSON();
        e.problem =
          e.problem.substring(0, 32) + (e.problem.length > 32 ? "..." : "");
        return e;
      }),
    );
  });

// Agent commands
const agentCmd = program.command("agent").description("Manage agents");

agentCmd.command("profiles").action(async () => {
  const profiles = await listAgentProfiles();
  if (profiles.isErr()) {
    return exitWithError(profiles);
  }
  for (const profile of profiles.value) {
    console.log(`${profile.name}: ${profile.description}`);
  }
});

agentCmd
  .command("create")
  .description("Create a new agent")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .option("-n, --name <name>", "Agent name")
  .option("-m, --model <model>", "AI model", "claude-sonnet-4-5")
  .option(
    "-t, --thinking <thinking>",
    "Thinking configuration (none | low | high)",
    "low",
  )
  .option(
    "-c, --count <number>",
    "Number of agents to create (name used as prefix)",
    "1",
  )
  .requiredOption("-p, --profile <profile>", "Agent profile")
  .action(async (options) => {
    // Find the experiment first
    const res = await experimentAndAgents({ experiment: options.experiment });
    if (res.isErr()) {
      return exitWithError(res);
    }
    const [experiment] = res.value;

    const count = parseInt(options.count);
    if (isNaN(count) || count < 1) {
      return exitWithError(
        err("invalid_parameters_error", `Count must be a positive integer.`),
      );
    }

    const agents = [];

    for (let i = 0; i < count; i++) {
      const name =
        count > 1
          ? options.name
            ? `${options.name}-${newID4()}`
            : `${newID4()}`
          : (options.name ?? newID4());
      console.log(
        `Creating agent: ${name} for experiment: ${options.experiment}`,
      );
      const profileRes = await getAgentProfile(options.profile);
      if (profileRes.isErr()) {
        return exitWithError(profileRes);
      }
      const profile = profileRes.value;
      const model = options.model;
      const thinking = options.thinking;
      const tools = profile.tools;

      if (
        !(
          isAnthropicModel(model) ||
          isOpenAIModel(model) ||
          isGeminiModel(model) ||
          isMistralModel(model) ||
          isMoonshotAIModel(model) ||
          isDeepseekModel(model)
        )
      ) {
        return exitWithError(
          err("invalid_parameters_error", `Model '${model}' is not supported.`),
        );
      }
      const provider = providerFromModel(model);

      if (!isThinkingConfig(thinking)) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            `Thinking configuration '${thinking}' is not valid. Use 'none', 'low', or 'high'.`,
          ),
        );
      }

      const agent = await AgentResource.create(
        experiment,
        {
          name,
          model,
          provider,
          thinking,
          tools,
        },
        { system: profile.prompt },
      );
      agents.push(agent);

      if (tools.includes("computer")) {
        await Computer.create(
          computerId(experiment, agent),
          undefined,
          profile.imageName,
          profile.env,
        );
      }
    }

    console.table(
      agents.map((agent) => {
        const a = agent.toJSON();
        a.system =
          a.system.substring(0, 32) + (a.system.length > 32 ? "..." : "");
        // @ts-expect-error: clean-up hack
        delete a.evolutions;
        return a;
      }),
    );
  });

agentCmd
  .command("list")
  .description("List agents for a given experiment")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .action(async (options) => {
    // Find the experiment first
    const res = await experimentAndAgents({
      experiment: options.experiment,
      agent: "all",
    });
    if (res.isErr()) {
      return exitWithError(res);
    }
    const [_experiment, agents] = res.value;

    if (agents.length === 0) {
      return exitWithError(err("not_found_error", "No agents found."));
    }

    console.table(
      agents.map((agent) => {
        const a = agent.toJSON();
        a.system =
          a.system.substring(0, 32) + (a.system.length > 32 ? "..." : "");
        // @ts-expect-error: clean-up hack
        delete a.evolutions;
        return a;
      }),
    );
  });

agentCmd
  .command("show <name>")
  .description("Show agent details")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .action(async (name, options) => {
    // Find the experiment first
    const res = await experimentAndAgents({
      experiment: options.experiment,
      agent: name,
    });
    if (res.isErr()) {
      return exitWithError(res);
    }
    const [_experiment, [agent]] = res.value;

    const a = agent.toJSON();
    a.system = a.system.substring(0, 32) + (a.system.length > 32 ? "..." : "");
    // @ts-expect-error: clean-up hack
    delete a.evolutions;
    console.table([a]);
  });

agentCmd
  .command("delete <name>")
  .description("Delete an agent")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .action(async (name, options) => {
    // Find the experiment first
    const res = await experimentAndAgents({
      experiment: options.experiment,
      agent: name,
    });
    if (res.isErr()) {
      return exitWithError(res);
    }
    const [_experiment, [agent]] = res.value;

    await agent.delete();
    console.log(`Agent '${name}' deleted successfully.`);
  });

agentCmd
  .command("run <name>")
  .description("Run an agent")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .option(
    "-r, --reviewers <reviewers>",
    "Number of required reviewers for each publication",
    DEFAULT_REVIEWERS_COUNT.toString(),
  )
  .option("-p, --path <path...>", "Add a file or directory to the computer")
  .option("-t, --tick", "Run one tick only")
  .action(async (name, options) => {
    const res = await experimentAndAgents({
      experiment: options.experiment,
      agent: name,
    });
    if (res.isErr()) {
      return exitWithError(res);
    }
    const [experiment, agents] = res.value;

    let reviewers = DEFAULT_REVIEWERS_COUNT;
    if (options.reviewers) {
      reviewers = parseInt(options.reviewers);
      if (isNaN(reviewers) || reviewers < 0) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            "Reviewers must be a valid integer greater than 0",
          ),
        );
      }
    }

    if (options.path && isArrayOf(options.path, isString)) {
      // Copy paths to all agents with computers
      for (const agent of agents.filter((a) =>
        a.toJSON().tools.includes("computer"),
      )) {
        for (const path of options.path) {
          const res = await copyToComputer(computerId(experiment, agent), path);
          if (res.isErr()) {
            return exitWithError(res);
          }
        }
      }
    }

    const builders = await Promise.all(
      agents.map((a) =>
        Runner.builder(experiment, a, {
          reviewers,
        }),
      ),
    );
    for (const res of builders) {
      if (res.isErr()) {
        return exitWithError(res);
      }
    }
    const runners = removeNulls(
      builders.map((res) => {
        if (res.isOk()) {
          return res.value;
        }
        return null;
      }),
    );

    // Run agents independently - each agent ticks without waiting for others
    if (options.tick) {
      // For single tick, run all concurrently and wait for completion
      const tickResults = await Promise.all(runners.map((r) => r.tick()));
      for (const tick of tickResults) {
        if (tick.isErr()) {
          return exitWithError(tick);
        }
      }
      return;
    }

    // For continuous running, start each agent in its own independent loop
    const runnerPromises = runners.map(async (runner) => {
      while (true) {
        const tick = await runner.tick();
        if (tick.isErr()) {
          // eslint-disable-next-line
          throw tick;
        }
      }
    });

    // Wait for any agent to fail, then exit
    try {
      await Promise.all(runnerPromises);
    } catch (error) {
      return exitWithError(error as any);
    }
  });

agentCmd
  .command("replay <name> <message>")
  .description("Replay an agent message (warning: tools side effects)")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .option(
    "-r, --reviewers",
    "Number of reviewers for each publication",
    DEFAULT_REVIEWERS_COUNT.toString(),
  )
  .action(async (name, message, options) => {
    let reviewers = DEFAULT_REVIEWERS_COUNT;
    if (options.reviewers) {
      reviewers = parseInt(options.reviewers);
      if (isNaN(reviewers) || reviewers < 0) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            "Reviewers must be a valid integer greater than 0",
          ),
        );
      }
    }
    const res = await experimentAndAgents({
      experiment: options.experiment,
      agent: name,
    });
    if (res.isErr()) {
      return exitWithError(res);
    }
    const [experiment, [agent]] = res.value;

    const buildRes = await Runner.builder(experiment, agent, {
      reviewers,
    });
    if (buildRes.isErr()) {
      return exitWithError(buildRes);
    }

    const replay = await buildRes.value.replayAgentMessage(parseInt(message));
    if (replay.isErr()) {
      return exitWithError(replay);
    }
  });

// Computer command
const imageCmd = program.command("image").description("Docker image utils");

imageCmd
  .command("build")
  .description("Build a computer Docker image")
  .option("-p, --profile <profile>", "Profile to build image for")
  .option(
    "-i, --identity <private_key_path>",
    "Path to SSH private key for Git access",
  )
  .action(async (options) => {
    let profile: AgentProfile | undefined = undefined;
    if (options.profile) {
      const profileRes = await getAgentProfile(options.profile);
      if (profileRes.isErr()) {
        return exitWithError(profileRes);
      }
      profile = profileRes.value;
      if (!profile.dockerFilePath) {
        return exitWithError(
          new Err(
            new SrchdError(
              "invalid_parameters_error",
              `Profile '${options.profile}' does not have a Dockerfile.`,
            ),
          ),
        );
      }
    }
    const res = await buildComputerImage(
      options.identity,
      profile?.dockerFilePath,
      profile?.imageName,
    );
    if (res.isErr()) {
      return exitWithError(res);
    }

    console.log(
      `computer Docker image ${profile?.imageName ?? ""} built successfully.`,
    );
  });

imageCmd
  .command("show")
  .description("Dump the computer Docker image")
  .option(
    "-i, --identity <private_key_path>",
    "Path to SSH private key for Git access",
  )
  .action(async (options) => {
    if (options.identity) {
      const res = await dockerFileForIdentity(options.identity);
      if (res.isErr()) {
        return exitWithError(res);
      }
      console.log(res.value);
    } else {
      console.log(await dockerFile());
    }
  });

// Serve command
program
  .command("serve")
  .description("Start the web UI server")
  .option("-p, --port <port>", "Port to serve on", "1337")
  .option("-a, --auth <user:password>", "Require HTTP basic auth credentials")
  .action(async (options) => {
    const port = parseInt(options.port);
    if (isNaN(port) || port < 1 || port > 65535) {
      return exitWithError(
        err(
          "invalid_parameters_error",
          "Port must be a valid number between 1 and 65535",
        ),
      );
    }

    let authConfig: BasicAuthConfig | undefined;
    if (options.auth) {
      const separator = String(options.auth).indexOf(":");
      if (separator === -1) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            "Auth must be provided as user:password",
          ),
        );
      }
      const username = options.auth.slice(0, separator);
      const password = options.auth.slice(separator + 1);
      if (!username || !password) {
        return exitWithError(
          err(
            "invalid_parameters_error",
            "Auth must include both user and password",
          ),
        );
      }
      authConfig = { username, password };
    }

    console.log(`Starting server on http://localhost:${port}`);
    if (authConfig) {
      console.log(`Basic auth enabled for user '${authConfig.username}'`);
    }

    const app = createApp(authConfig);

    serve({
      fetch: app.fetch,
      port,
    });
  });

program.parse();
