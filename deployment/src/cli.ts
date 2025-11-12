#!/usr/bin/env node

import { Command } from "commander";
import {
  createDeployment,
  deleteDeployment,
  listComputers,
  listDeployments,
  startPortForward,
} from "./index";
import { SrchdError } from "@app/lib/error";
import { Err } from "@app/lib/result";
import { buildSrchdImage, dockerFile } from "./image";

const exitWithError = (err: Err<SrchdError>) => {
  console.error(
    `\x1b[31mError [${err.error.code}] ${err.error.message}\x1b[0m`,
  );
  if (err.error.cause) {
    console.error(`\x1b[31mCause: ${err.error.cause.message}\x1b[0m`);
  }
  process.exit(1);
};

const program = new Command();

program
  .name("deployment")
  .description("Manage srchd deployments")
  .version("1.0");

program
  .command("create")
  .description("Create a new srchd deployment")
  .argument("[name]")
  .action(async (name) => {
    console.log(`Deploying srchd server: ${name}`);
    const res = await createDeployment(name, {});
    if (res.isErr()) {
      console.error(res.error.message);
      process.exit(1);
    }
  });

program
  .command("computers")
  .description("list computers of a srchd deployment")
  .argument("<name>")
  .action(async (name) => {
    const computers = await listComputers(name);
    for (const computer of computers) {
      console.log(computer.metadata?.name);
    }
  });

program
  .command("list")
  .description("List srchd deployments")
  .action(async () => {
    const deployments = await listDeployments();
    for (const deployment of deployments) {
      console.log(deployment.metadata?.namespace);
    }
  });

program
  .command("delete")
  .description("Delete a srchd deployment")
  .argument("<name>")
  .action(async (name) => {
    const res = await deleteDeployment(name);
    if (res.isErr()) {
      console.error(res.error.message);
      process.exit(1);
    }
  });

program
  .command("connect")
  .description("Port-forwards a Srchd deployment to a local port")
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

const imageCmd = program.command("image").description("Docker image utils");

imageCmd
  .command("build")
  .description("Build the srchd server Docker image")
  .action(async () => {
    const res = await buildSrchdImage();
    if (res.isErr()) {
      return exitWithError(res);
    }

    console.log(`srchd Docker image built successfully.`);
  });

imageCmd
  .command("show")
  .description("Dump the srchd server Dockerfile")
  .action(async () => {
    console.log(await dockerFile());
  });

program.parse();
