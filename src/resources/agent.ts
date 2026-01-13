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
  private profile: AgentProfile;
  experiment: ExperimentResource;

  private constructor(data: Agent, experiment: ExperimentResource, profile?: AgentProfile) {
    this.data = data;
    this.evolutions = [];
    this.profile = profile as AgentProfile; // Will be set in finalize if not provided
    this.experiment = experiment;
  }

  private async finalize(): Promise<Result<AgentResource>> {
    const results = await db
      .select()
      .from(evolutions)
      .where(eq(evolutions.agent, this.data.id))
      .orderBy(desc(evolutions.created));

    this.evolutions = results;

    // Load profile if not already set (from create)
    if (!this.profile) {
      const profileRes = await getAgentProfile(this.data.profile);
      if (profileRes.isErr()) {
        return profileRes;
      }
      this.profile = profileRes.value;
    }

    return ok(this);
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

    return await new AgentResource(result, experiment).finalize();
  }

  static async findById(
    experiment: ExperimentResource,
    id: number,
  ): Promise<Result<AgentResource | null>> {
    const [result] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);

    if (!result) return ok(null);

    return await new AgentResource(result, experiment).finalize();
  }

  static async listByExperiment(
    experiment: ExperimentResource,
  ): Promise<Result<AgentResource[]>> {
    const results = await db
      .select()
      .from(agents)
      .where(eq(agents.experiment, experiment.toJSON().id));

    // TODO(spolu): optimize with a join?
    const agentResults = await concurrentExecutor(
      results,
      async (data) => {
        return await new AgentResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );

    // Check if any failed and unwrap
    const unwrapped: AgentResource[] = [];
    for (const result of agentResults) {
      if (result.isErr()) {
        return result;
      }
      unwrapped.push(result.value);
    }

    return ok(unwrapped);
  }

  static async create(
    experiment: ExperimentResource,
    data: Omit<
      InferInsertModel<typeof agents>,
      "id" | "created" | "updated" | "experiment" | "profile"
    >,
    evolution: Omit<
      InferInsertModel<typeof evolutions>,
      "id" | "created" | "updated" | "experiment" | "agent"
    >,
    profile: AgentProfile,
  ): Promise<Result<AgentResource>> {
    const [created] = await db
      .insert(agents)
      .values({
        ...data,
        profile: profile.name,
        experiment: experiment.toJSON().id,
      })
      .returning();

    await db.insert(evolutions).values({
      ...evolution,
      experiment: created.experiment,
      agent: created.id,
    });

    return await new AgentResource(created, experiment, profile).finalize();
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

  getProfile(): AgentProfile {
    return this.profile;
  }

  toJSON() {
    return {
      ...this.data,
      // Only non-default tools.
      tools: this.data.tools ?? [],
      system: this.evolutions[0].system,
      evolutions: this.evolutions,
    };
  }
}
