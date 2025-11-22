#!/usr/bin/env node

import { Command, Option } from "commander";
import { readFileContent } from "./lib/fs";
import { SrchdError } from "./lib/error";
import { Err } from "./lib/result";
import { ExperimentResource } from "./resources/experiment";
import { AgentResource } from "./resources/agent";
import { Runner } from "./runner";
import { newID4, removeNulls } from "./lib/utils";
import { isProvider, isThinkingConfig } from "./models";
import { isAnthropicModel } from "./models/anthropic";
import { isOpenAIModel } from "./models/openai";
import { isGeminiModel } from "./models/gemini";
import { isMoonshotAIModel } from "./models/moonshotai";
import { serve } from "@hono/node-server";
import { createApp, type BasicAuthConfig } from "./server";
import { isMistralModel } from "./models/mistral";
import {
  DEFAULT_TOOLS,
  NON_DEFAULT_TOOLS,
  isNonDefaultToolNameList,
} from "./tools/constants";
import {
  messageMetricsByExperiment,
  tokenUsageMetricsByExperiment,
  publicationMetricsByExperiment,
} from "./metrics";
import { ExperimentMetrics } from "./metrics";
import { buildImage, dockerFile, dockerFileForIdentity } from "./lib/image";
import { Computer, computerId } from "./computer";
import {
  createWorkspace,
  deleteWorkspace,
  listComputers,
  listWorkspaces,
} from "./workspace";
import { startPortForward } from "./workspace";
import { podExec } from "./lib/k8s";

const exitWithError = (err: Err<SrchdError>) => {
  console.error(
    `\x1b[31mError [${err.error.code}] ${err.error.message}\x1b[0m`,
  );
  if (err.error.cause) {
    console.error(`\x1b[31mCause: ${err.error.cause.message}\x1b[0m`);
  }
  process.exit(1);
};

const DEFAULT_REVIEWERS_COUNT = 4;

const program = new Command();

program
  .name("srchd")
  .description("Research experiment management CLI")
  .version("1.0.0");

const metricsCmd = program.command("metrics").description("Show metrics");

async function displayMetrics<M>(
  experiment: string,
  metricsByExperiment: (e: ExperimentResource) => Promise<ExperimentMetrics<M>>,
): Promise<void> {
  const experimentRes = await ExperimentResource.findByName(experiment);
  if (!experimentRes) {
    return exitWithError(
      new Err(
        new SrchdError(
          "not_found_error",
          `Experiment '${experiment}' not found.`,
        ),
      ),
    );
  }

  const metrics = await metricsByExperiment(experimentRes);
  if (!metrics) {
    return exitWithError(
      new Err(
        new SrchdError(
          "not_found_error",
          `Experiment '${experiment}' not found.`,
        ),
      ),
    );
  }

  if (!metrics) {
    return exitWithError(
      new Err(
        new SrchdError(
          "not_found_error",
          `Experiment '${experiment}' not found.`,
        ),
      ),
    );
  }

  console.table([metrics.experiment]);
  const agents = [];
  for (const [name, agentMetrics] of Object.entries(metrics.agents)) {
    agents.push({ name, ...agentMetrics });
  }
  console.table(agents);
}

metricsCmd
  .command("messages")
  .description("Show message metrics")
  .argument("<experiment>", "Experiment name")
  .action(async (e) => displayMetrics(e, messageMetricsByExperiment));

metricsCmd
  .command("token-usage")
  .description("Show token usage")
  .argument("<experiment>", "Experiment name")
  .action(async (e) => displayMetrics(e, tokenUsageMetricsByExperiment));

metricsCmd
  .command("publications")
  .description("Calculate publication metrics")
  .argument("<experiment>", "Experiment name")
  .action(async (e) => displayMetrics(e, publicationMetricsByExperiment));

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
      return exitWithError(
        new Err(new SrchdError("not_found_error", "No experiments found.")),
      );
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

const systemPromptFilesOption = new Option(
  "-s, --system <system_prompt_file>",
  "System prompt file path (pass multiple to append)",
)
  .makeOptionMandatory()
  .argParser((value, previous: string[] | undefined) => {
    const prompts = previous ?? [];
    return [...prompts, value];
  });

agentCmd
  .command("create")
  .description("Create a new agent")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .addOption(systemPromptFilesOption)
  .option("-n, --name <name>", "Agent name")
  .option("-p, --provider <provider>", "AI provider (default: anthropic)")
  .option("-m, --model <model>", "AI model (default: claude-sonnet-4-20250514)")
  .option(
    "-t, --thinking <thinking>",
    "Thinking configuration (none | low | high, default: low)",
  )
  .option(
    "-c, --count <number>",
    "Number of agents to create (name used as prefix)",
  )
  .option("--tool <tool...>", "Tools to use (can be specified multiple times)")
  .action(async (options) => {
    // Read system prompt from file
    const systemFiles: string[] = Array.isArray(options.system)
      ? options.system
      : [options.system];

    const systemPrompts: string[] = [];
    for (const file of systemFiles) {
      const system = await readFileContent(file);
      if (system.isErr()) {
        return exitWithError(system);
      }
      systemPrompts.push(system.value);
    }
    const system = systemPrompts.join("\n");

    // Find the experiment first
    const experiment = await ExperimentResource.findByName(options.experiment);
    if (!experiment) {
      return exitWithError(
        new Err(
          new SrchdError(
            "not_found_error",
            `Experiment '${options.experiment}' not found.`,
          ),
        ),
      );
    }

    let count = 1;
    if (options.count) {
      count = parseInt(options.count);
      if (isNaN(count) || count < 1) {
        return exitWithError(
          new Err(
            new SrchdError(
              "invalid_parameters_error",
              `Count must be a positive integer.`,
            ),
          ),
        );
      }
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
      const provider = options.provider ?? "anthropic";
      const model = options.model ?? "claude-sonnet-4-5-20250929";
      const thinking = options.thinking ?? "low";
      const tools = options.tool ?? [];

      if (!isProvider(provider)) {
        return exitWithError(
          new Err(
            new SrchdError(
              "invalid_parameters_error",
              `Provider '${provider}' is not supported.`,
            ),
          ),
        );
      }

      if (
        !(
          isAnthropicModel(model) ||
          isOpenAIModel(model) ||
          isGeminiModel(model) ||
          isMistralModel(model) ||
          isMoonshotAIModel(model)
        )
      ) {
        return exitWithError(
          new Err(
            new SrchdError(
              "invalid_parameters_error",
              `Model '${model}' is not supported.`,
            ),
          ),
        );
      }

      if (!isThinkingConfig(thinking)) {
        return exitWithError(
          new Err(
            new SrchdError(
              "invalid_parameters_error",
              `Thinking configuration '${thinking}' is not valid. Use 'none', 'low', or 'high'.`,
            ),
          ),
        );
      }

      if (!isNonDefaultToolNameList(tools)) {
        return exitWithError(
          new Err(
            new SrchdError(
              "invalid_parameters_error",
              `Tools '${tools}' are not valid. Use one or more of: [${NON_DEFAULT_TOOLS.join(", ")}].
              The default tools: ${DEFAULT_TOOLS.join(", ")} are always included.`,
            ),
          ),
        );
      }

      const agent = await AgentResource.create(
        experiment,
        {
          name,
          provider,
          model,
          thinking,
          tools,
        },
        { system: system },
      );
      agents.push(agent);
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
    const experiment = await ExperimentResource.findByName(options.experiment);
    if (!experiment) {
      return exitWithError(
        new Err(
          new SrchdError(
            "not_found_error",
            `Experiment '${options.experiment}' not found.`,
          ),
        ),
      );
    }

    const agents = await AgentResource.listByExperiment(experiment);

    if (agents.length === 0) {
      return exitWithError(
        new Err(new SrchdError("not_found_error", "No agents found.")),
      );
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
    const experiment = await ExperimentResource.findByName(options.experiment);
    if (!experiment) {
      return exitWithError(
        new Err(
          new SrchdError(
            "not_found_error",
            `Experiment '${options.experiment}' not found.`,
          ),
        ),
      );
    }

    const agent = await AgentResource.findByName(experiment, name);
    if (!agent) {
      return exitWithError(
        new Err(
          new SrchdError(
            "not_found_error",
            `Agent '${name}' not found in experiment '${options.experiment}'.`,
          ),
        ),
      );
    }

    console.table([agent.toJSON()]);
  });

agentCmd
  .command("delete <name>")
  .description("Delete an agent")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .action(async (name, options) => {
    // Find the experiment first
    const experiment = await ExperimentResource.findByName(options.experiment);
    if (!experiment) {
      return exitWithError(
        new Err(
          new SrchdError(
            "not_found_error",
            `Experiment '${options.experiment}' not found.`,
          ),
        ),
      );
    }

    const agent = await AgentResource.findByName(experiment, name);
    if (!agent) {
      return exitWithError(
        new Err(
          new SrchdError(
            "not_found_error",
            `Agent '${name}' not found in experiment '${options.experiment}'.`,
          ),
        ),
      );
    }

    await agent.delete();
    console.log(`Agent '${name}' deleted successfully.`);
  });

agentCmd
  .command("run <name>")
  .description("Run an agent")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .option(
    "-r, --reviewers <reviewers>",
    "Number of required reviewers for each publication (default: 4)",
  )
  .option("-t, --tick", "Run one tick only")
  .action(async (name, options) => {
    let agents: AgentResource[] = [];
    const experiment = await ExperimentResource.findByName(options.experiment);
    if (!experiment) {
      return exitWithError(
        new Err(
          new SrchdError(
            "not_found_error",
            `Experiment '${options.experiment}' not found.`,
          ),
        ),
      );
    }

    if (name === "all") {
      agents = await AgentResource.listByExperiment(experiment);
    } else {
      const agent = await AgentResource.findByName(experiment, name);
      if (!agent) {
        return exitWithError(
          new Err(
            new SrchdError(
              "not_found_error",
              `Agent '${options.name}' not found.`,
            ),
          ),
        );
      }
      agents = [agent];
    }

    let reviewers = DEFAULT_REVIEWERS_COUNT;
    if (options.reviewers) {
      reviewers = parseInt(options.reviewers);
      if (isNaN(reviewers) || reviewers < 0) {
        return exitWithError(
          new Err(
            new SrchdError(
              "invalid_parameters_error",
              "Reviewers must be a valid integer greater than 0",
            ),
          ),
        );
      }
    }

    // Ensure all agents with computer tool have computers
    for (const agent of agents.filter((a) =>
      a.toJSON().tools.includes("computer"),
    )) {
      await Computer.ensure(computerId(experiment, agent));
    }

    const builders = await Promise.all(
      agents.map((a) =>
        Runner.builder(options.experiment, a.toJSON().name, {
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
          return res.value.runner;
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
          throw tick.error;
        }
      }
    });

    // Wait for any agent to fail, then exit
    try {
      await Promise.all(runnerPromises);
    } catch (error) {
      return exitWithError(new Err(error as any));
    }
  });

agentCmd
  .command("replay <name> <message>")
  .description("Replay an agent message (warning: tools side effects)")
  .requiredOption("-e, --experiment <experiment>", "Experiment name")
  .option(
    "-r, --reviewers",
    "Number of reviewers for each publication (default: 4",
  )
  .action(async (name, message, options) => {
    let reviewers = DEFAULT_REVIEWERS_COUNT;
    if (options.reviewers) {
      reviewers = parseInt(options.reviewers);
      if (isNaN(reviewers) || reviewers < 0) {
        return exitWithError(
          new Err(
            new SrchdError(
              "invalid_parameters_error",
              "Reviewers must be a valid integer greater than 0",
            ),
          ),
        );
      }
    }

    const res = await Runner.builder(options.experiment, name, {
      reviewers,
    });
    if (res.isErr()) {
      return exitWithError(res);
    }

    const replay = await res.value.runner.replayAgentMessage(parseInt(message));
    if (replay.isErr()) {
      return exitWithError(replay);
    }
  });

// Computer command
const imageCmd = program.command("image").description("Docker image utils");

imageCmd
  .command("build")
  .description("Build a Docker image")
  .argument("[image]: computer | srchd", "Image to build (default: computer)")
  .option(
    "-i, --identity <private_key_path>",
    "Path to SSH private key for Git access (Only for computer image)",
  )
  .action(async (image, options) => {
    const res = await buildImage(image, options.identity);
    if (res.isErr()) {
      return exitWithError(res);
    }

    console.log(`${image} Docker image built successfully.`);
  });

imageCmd
  .command("show")
  .description("Dump the Docker image")
  .argument("[image]: computer | srchd", "Image to dump (default: computer)")
  .option(
    "-i, --identity <private_key_path>",
    "Path to SSH private key for Git access",
  )
  .action(async (image, options) => {
    if (options.identity) {
      const res = await dockerFileForIdentity(options.identity);
      if (res.isErr()) {
        return exitWithError(res);
      }
      console.log(res.value);
    } else {
      console.log(await dockerFile(image));
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
        new Err(
          new SrchdError(
            "invalid_parameters_error",
            "Port must be a valid number between 1 and 65535",
          ),
        ),
      );
    }

    let authConfig: BasicAuthConfig | undefined;
    if (options.auth) {
      const separator = String(options.auth).indexOf(":");
      if (separator === -1) {
        return exitWithError(
          new Err(
            new SrchdError(
              "invalid_parameters_error",
              "Auth must be provided as user:password",
            ),
          ),
        );
      }
      const username = options.auth.slice(0, separator);
      const password = options.auth.slice(separator + 1);
      if (!username || !password) {
        return exitWithError(
          new Err(
            new SrchdError(
              "invalid_parameters_error",
              "Auth must include both user and password",
            ),
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

const workspaceCmd = program
  .command("workspace")
  .description("Manage srchd workspaces");

workspaceCmd
  .command("create")
  .description("Create a new srchd workspace")
  .argument("[name]")
  .action(async (name) => {
    console.log(`Deploying srchd server: ${name}`);
    const res = await createWorkspace(name, {});
    if (res.isErr()) {
      console.error(res.error.message);
      process.exit(1);
    }
  });

workspaceCmd
  .command("computers")
  .description("list computers of a srchd workspace")
  .argument("<name>")
  .action(async (name) => {
    const computers = await listComputers(name);
    for (const computer of computers) {
      console.log(computer.metadata?.name);
    }
  });

workspaceCmd
  .command("list")
  .description("List srchd workspaces")
  .action(async () => {
    const workspaces = await listWorkspaces();
    for (const workspace of workspaces) {
      console.log(workspace.metadata?.namespace);
    }
  });

workspaceCmd
  .command("delete")
  .description("Delete a srchd workspace")
  .argument("<name>")
  .action(async (name) => {
    const res = await deleteWorkspace(name);
    if (res.isErr()) {
      console.error(res.error.message);
      process.exit(1);
    }
  });

workspaceCmd
  .command("connect")
  .description("Port-forwards a Srchd workspace to a local port")
  .argument("<name>")
  .option("-p, --port <port>")
  .action(async (name, options) => {
    console.log(`Access at: http://localhost:${options.port ?? 1337}`);

    const res = await startPortForward(name, options.port ?? 1337);
    if (res.isErr()) {
      console.error(res.error.message);
      process.exit(1);
    }
  });

workspaceCmd
  .enablePositionalOptions()
  .command("exec")
  .argument("<name>")
  .description("Execute a command in a Srchd workspace")
  .allowExcessArguments()
  .allowUnknownOption()
  .action(async (name, _options, command) => {
    console.log(`Executing command in workspace: ${name}`);

    const args = command.args.slice(1);
    const res = await podExec(["npx", "tsx", "src/srchd.ts", ...args], name);
    if (res.isErr()) {
      console.error(res.error.message);
      process.exit(1);
    } else {
      const { exitCode, stdout, stderr } = res.value;
      console.log(stdout);
      if (stderr.length > 0) {
        console.error(stderr);
      }
      process.exit(exitCode);
    }
  });

program.parse();
