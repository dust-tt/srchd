import { db } from "@app/db";
import { experiments } from "@app/db/schema";
import { err, ok, Result } from "@app/lib/error";
import { eq, InferSelectModel, InferInsertModel } from "drizzle-orm";
import {
  readProblemContent,
  problemDataPath,
} from "@app/lib/problem";

type Experiment = InferSelectModel<typeof experiments>;

export class ExperimentResource {
  private data: Experiment;

  private constructor(data: Experiment) {
    this.data = data;
  }

  static async findByName(name: string): Promise<Result<ExperimentResource>> {
    const result = await db
      .select()
      .from(experiments)
      .where(eq(experiments.name, name))
      .limit(1);

    return result[0]
      ? ok(new ExperimentResource(result[0]))
      : err("not_found_error", `Experiment '${name}' not found.`);
  }

  static async findById(id: number): Promise<Result<ExperimentResource>> {
    const result = await db
      .select()
      .from(experiments)
      .where(eq(experiments.id, id))
      .limit(1);

    return result[0] ? ok(new ExperimentResource(result[0])) : err("not_found_error", `Experiment not found for id: ${id}`);
  }

  static async create(
    data: Omit<
      InferInsertModel<typeof experiments>,
      "id" | "created" | "updated"
    >,
  ): Promise<ExperimentResource> {
    const [created] = await db.insert(experiments).values(data).returning();
    return new ExperimentResource(created);
  }

  static async all(): Promise<ExperimentResource[]> {
    const results = await db.select().from(experiments);
    return results.map((data) => new ExperimentResource(data));
  }

  async update(
    data: Partial<Omit<InferInsertModel<typeof experiments>, "id" | "created">>,
  ): Promise<ExperimentResource> {
    const [updated] = await db
      .update(experiments)
      .set({ ...data, updated: new Date() })
      .where(eq(experiments.id, this.data.id))
      .returning();

    this.data = updated;
    return this;
  }

  async delete(): Promise<void> {
    await db.delete(experiments).where(eq(experiments.id, this.data.id));
  }

  // Return raw data if needed
  toJSON() {
    return this.data;
  }

  /**
   * Reads and returns the problem content from the problem ID.
   */
  async getProblemContent(): Promise<Result<string>> {
    return readProblemContent(this.data.problem);
  }

  /**
   * Returns the path to the problem's data/ directory, or null if none exists.
   */
  problemDataPath(): string | null {
    return problemDataPath(this.data.problem);
  }
}
