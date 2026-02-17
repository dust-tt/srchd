import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tmpdir } from "os";
import path from "path";
import { unlinkSync } from "fs";

const dbPath = path.join(tmpdir(), `srchd-test-${Date.now()}.sqlite`);
process.env.DATABASE_PATH = dbPath;

import { db } from "@app/db";
import { ExperimentResource } from "@app/resources/experiment";
import { AgentResource } from "@app/resources/agent";
import { PublicationResource } from "@app/resources/publication";
import { Advisory } from "@app/runner/advisory";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

describe("PublicationResource.publish", () => {
  beforeAll(() => {
    migrate(db, { migrationsFolder: "src/migrations" });
  });

  afterAll(() => {
    try {
      unlinkSync(dbPath);
    } catch {}
  });

  it("directly publishes without reviewers (regression: 819c438)", async () => {
    const experiment = await ExperimentResource.create({
      name: `test-auto-publish-${Date.now()}`,
      problem: "test",
    });

    const agent = await AgentResource.create(
      experiment,
      {
        name: "a1",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        thinking: "low",
        profile: "research",
      },
      { system: "test" },
    );

    Advisory.register([agent.toJSON().name]);

    const pub = await PublicationResource.submit(experiment, agent, {
      title: "Test",
      abstract: "Test abstract",
      content: "Test content",
    });
    expect(pub.isOk()).toBe(true);
    if (pub.isErr()) throw new Error(pub.error.message);
    expect(pub.value.toJSON().status).toBe("SUBMITTED");

    const result = await pub.value.publish();
    expect(result.isOk()).toBe(true);
    if (result.isErr()) throw new Error(result.error.message);
    expect(result.value.toJSON().status).toBe("PUBLISHED");
  });
});
