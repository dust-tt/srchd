import { db } from "@app/db";
import { agents, evolutions } from "@app/db/schema";
import { eq, InferSelectModel, InferInsertModel, and, desc } from "drizzle-orm";
import { ExperimentResource } from "./experiment";
import { Result, err, ok } from "@app/lib/error";
import { concurrentExecutor } from "@app/lib/async";
import { getAgentProfile, AgentProfile } from "@app/agent_profile";

export type Agent = InferSelectModel<typeof agents>;
export type Evolution = InferSelectModel<typeof evolutions>;

export class AgentResource {
  private data: Agent;
  private evolutions: Evolution[];
  experiment: ExperimentResource;

  private constructor(data: Agent, experiment: ExperimentResource) {
    this.data = data;
    this.evolutions = [];
    this.experiment = experiment;
  }

  private async finalize(): Promise<AgentResource> {
    const results = await db
      .select()
      .from(evolutions)
      .where(eq(evolutions.agent, this.data.id))
      .orderBy(desc(evolutions.created));

    this.evolutions = results;
    return this;
  }

  static async findByName(
    experiment: ExperimentResource,
    name: string,
  ): Promise<Result<AgentResource>> {
    const [result] = await db
      .select()
      .from(agents)
      .where(
        and(
          eq(agents.name, name),
          eq(agents.experiment, experiment.toJSON().id),
        ),
      )
      .limit(1);

    if (!result) {
      return err(
        "not_found_error",
        `Agent '${name}' not found in experiment ${experiment.toJSON().name}`,
      );
    }

    return ok(await new AgentResource(result, experiment).finalize());
  }

  static async findById(
    experiment: ExperimentResource,
    id: number,
  ): Promise<AgentResource | null> {
    const [result] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);

    if (!result) return null;

    return await new AgentResource(result, experiment).finalize();
  }

  static async listByExperiment(
    experiment: ExperimentResource,
  ): Promise<AgentResource[]> {
    const results = await db
      .select()
      .from(agents)
      .where(eq(agents.experiment, experiment.toJSON().id));

    // TODO(spolu): optimize with a join?
    return await concurrentExecutor(
      results,
      async (data) => {
        return await new AgentResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );
  }

  static async create(
    experiment: ExperimentResource,
    data: Omit<
      InferInsertModel<typeof agents>,
      "id" | "created" | "updated" | "experiment"
    >,
    evolution: Omit<
      InferInsertModel<typeof evolutions>,
      "id" | "created" | "updated" | "experiment" | "agent"
    >,
  ): Promise<AgentResource> {
    const [created] = await db
      .insert(agents)
      .values({
        ...data,
        experiment: experiment.toJSON().id,
      })
      .returning();

    await db.insert(evolutions).values({
      ...evolution,
      experiment: created.experiment,
      agent: created.id,
    });

    return await new AgentResource(created, experiment).finalize();
  }

  async update(
    data: Partial<Omit<InferInsertModel<typeof agents>, "id" | "created">>,
  ): Promise<AgentResource> {
    const [updated] = await db
      .update(agents)
      .set({ ...data, updated: new Date() })
      .where(eq(agents.id, this.data.id))
      .returning();

    this.data = updated;
    return this;
  }

  async delete(): Promise<void> {
    await db.delete(evolutions).where(eq(evolutions.agent, this.data.id));
    await db.delete(agents).where(eq(agents.id, this.data.id));
  }

  async evolve(
    data: Omit<
      InferInsertModel<typeof evolutions>,
      "id" | "created" | "updated" | "experiment" | "agent"
    >,
  ): Promise<Result<AgentResource>> {
    try {
      const [created] = await db
        .insert(evolutions)
        .values({
          ...data,
          experiment: this.data.experiment,
          agent: this.data.id,
        })
        .returning();

      this.evolutions = [created, ...this.evolutions];
      return ok(this);
    } catch (error) {
      return err(
        "resource_creation_error",
        "Failed to create agent evolution",
        error,
      );
    }
  }

  async getProfile(): Promise<Result<AgentProfile>> {
    if (!this.data.profile) {
      return err(
        "not_found_error",
        `Agent '${this.data.name}' does not have a profile set`,
      );
    }
    return await getAgentProfile(this.data.profile);
  }

  async toJSONWithProfile() {
    const profileRes = await this.getProfile();
    if (profileRes.isErr()) {
      return profileRes;
    }
    const profile = profileRes.value;

    return ok({
      ...this.data,
      tools: profile.tools, // From profile
      imageName: profile.imageName, // From profile
      env: profile.env, // From profile
      system: this.evolutions[0].system, // From DB (allows customization)
      evolutions: this.evolutions,
    });
  }

  toJSON() {
    return {
      ...this.data,
      system: this.evolutions[0].system,
      evolutions: this.evolutions,
    };
  }
}
