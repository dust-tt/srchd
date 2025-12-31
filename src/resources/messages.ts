import { db, Tx } from "@app/db";
import { messages } from "@app/db/schema";
import { eq, InferSelectModel, and, asc, lte } from "drizzle-orm";
import { ExperimentResource } from "./experiment";
import { AgentResource } from "./agent";
import { Message } from "@app/models";

export class MessageResource {
  private data: InferSelectModel<typeof messages>;
  experiment: ExperimentResource;

  private constructor(
    data: InferSelectModel<typeof messages>,
    experiment: ExperimentResource,
  ) {
    this.data = data;
    this.experiment = experiment;
  }

  static async findById(
    experiment: ExperimentResource,
    agent: AgentResource,
    id: number,
  ): Promise<MessageResource | null> {
    const result = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.experiment, experiment.toJSON().id),
          eq(messages.agent, agent.toJSON().id),
          eq(messages.id, id),
        ),
      )
      .limit(1);

    return result[0] ? new MessageResource(result[0], experiment) : null;
  }

  static async listMessagesByAgent(
    experiment: ExperimentResource,
    agent: AgentResource,
    options?: { before?: Date },
  ): Promise<MessageResource[]> {
    const whereConditions = [
      eq(messages.experiment, experiment.toJSON().id),
      eq(messages.agent, agent.toJSON().id),
    ];
    if (options?.before) {
      whereConditions.push(lte(messages.created, options.before));
    }

    const results = await db
      .select()
      .from(messages)
      .where(and(...whereConditions))
      .orderBy(asc(messages.position));

    return results.map((msg) => new MessageResource(msg, experiment));
  }

  static async listMessagesByExperiment(
    experiment: ExperimentResource,
    options?: { before?: Date },
  ): Promise<MessageResource[]> {
    const whereConditions = [eq(messages.experiment, experiment.toJSON().id)];
    if (options?.before) {
      whereConditions.push(lte(messages.created, options.before));
    }

    const results = await db
      .select()
      .from(messages)
      .where(and(...whereConditions))
      .orderBy(asc(messages.position));

    return results.map((msg) => new MessageResource(msg, experiment));
  }

  static async create(
    experiment: ExperimentResource,
    agent: AgentResource,
    message: Message,
    positon: number,
    options?: { tx?: Tx },
  ): Promise<MessageResource> {
    const executor = options?.tx ?? db;
    const [created] = await executor
      .insert(messages)
      .values({
        experiment: experiment.toJSON().id,
        agent: agent.toJSON().id,
        ...message,
        position: positon,
      })
      .returning();

    return new MessageResource(created, experiment);
  }

  id(): number {
    return this.data.id;
  }

  position(): number {
    return this.data.position;
  }

  created(): Date {
    return new Date(this.data.created);
  }

  toJSON(): Message & { id: number } {
    return {
      id: this.data.id,
      role: this.data.role,
      content: this.data.content,
    };
  }
}
