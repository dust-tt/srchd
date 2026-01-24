import { db } from "@app/db";
import { citations, publications, reviews, solutions } from "@app/db/schema";
import {
  eq,
  InferSelectModel,
  InferInsertModel,
  and,
  desc,
  inArray,
  count,
  isNull,
  getTableColumns,
} from "drizzle-orm";
import { ExperimentResource } from "./experiment";
import { Agent, AgentResource } from "./agent";
import { Result, err, ok } from "@app/lib/error";
import { newID4, removeNulls } from "@app/lib/utils";
import { concurrentExecutor } from "@app/lib/async";
import { assertNever } from "@app/lib/assert";
import assert from "assert";
import { PLACEHOLDER_AGENT_PROFILE } from "@app/agent_profile";
import { Advisory } from "@app/runner/advisory";

export type Publication = InferSelectModel<typeof publications>;
export type Review = Omit<InferInsertModel<typeof reviews>, "author"> & {
  author: Agent;
};
export type Citation = InferInsertModel<typeof citations>;

export class PublicationResource {
  private data: Publication;
  private citations: { from: Citation[]; to: Citation[] };
  private reviews: Review[];
  private author: Agent;
  experiment: ExperimentResource;

  private constructor(data: Publication, experiment: ExperimentResource) {
    this.data = data;
    this.citations = { from: [], to: [] };
    this.reviews = [];
    this.author = {
      id: 0,
      name: "",
      created: new Date(),
      updated: new Date(),
      experiment: experiment.toJSON().id,
      provider: "anthropic" as const,
      model: "claude-sonnet-4-5" as const,
      thinking: "low" as const,
      profile: PLACEHOLDER_AGENT_PROFILE,
    };
    this.experiment = experiment;
  }

  private async finalize(): Promise<PublicationResource> {
    const fromCitationsQuery = db
      .select()
      .from(citations)
      .where(eq(citations.from, this.data.id));
    const toCitationsQuery = db
      .select()
      .from(citations)
      .where(eq(citations.to, this.data.id));
    const reviewsQuery = db
      .select()
      .from(reviews)
      .where(eq(reviews.publication, this.data.id));
    const authorQuery = AgentResource.findById(
      this.experiment,
      this.data.author,
    );

    const [fromCitationsResults, toCitationsResults, reviewsResults, authorRes] =
      await Promise.all([
        fromCitationsQuery,
        toCitationsQuery,
        reviewsQuery,
        authorQuery,
      ]);

    assert(authorRes.isOk());
    this.author = authorRes.value.toJSON();

    this.citations.from = fromCitationsResults;
    this.citations.to = toCitationsResults;

    this.reviews = await concurrentExecutor(
      reviewsResults,
      async (review) => {
        const reviewAgentRes = await AgentResource.findById(
          this.experiment,
          review.author,
        );
        assert(reviewAgentRes.isOk());
        const reviewAgent = reviewAgentRes.value;
        return {
          ...review,
          author: reviewAgent.toJSON(),
        };
      },
      { concurrency: 8 },
    );

    return this;
  }

  static async findById(
    experiment: ExperimentResource,
    id: number,
  ): Promise<Result<PublicationResource>> {
    const [result] = await db
      .select()
      .from(publications)
      .where(eq(publications.id, id))
      .limit(1);

    if (!result) return err("not_found_error", `Publication not found for id: ${id}`);

    return ok(await new PublicationResource(result, experiment).finalize());
  }

  static async listPublishedByExperiment(
    experiment: ExperimentResource,
    options: {
      order: "latest" | "citations";
      status: "PUBLISHED" | "SUBMITTED" | "REJECTED";
      limit: number;
      offset: number;
    },
  ): Promise<PublicationResource[]> {
    const { order, limit, offset } = options;

    const baseQuery = db
      .select({
        ...getTableColumns(publications),
        citationsCount: count(citations.id),
      })
      .from(publications)
      .leftJoin(citations, eq(citations.to, publications.id))
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          eq(publications.status, "PUBLISHED"),
        ),
      )
      .groupBy(publications.id)
      .limit(limit)
      .offset(offset);

    const query = (() => {
      switch (order) {
        case "latest": {
          return baseQuery.orderBy(desc(publications.created));
        }
        case "citations": {
          return baseQuery.orderBy(desc(count(citations.id)));
        }
        default:
          assertNever(order);
      }
    })();
    const results = await query;

    return await concurrentExecutor(
      results,
      async (data) => {
        return await new PublicationResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );
  }

  static async listByExperimentAndReviewRequested(
    experiment: ExperimentResource,
    reviewer: AgentResource,
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.experiment, experiment.toJSON().id),
          eq(reviews.author, reviewer.toJSON().id),
          isNull(reviews.grade),
        ),
      );

    if (results.length === 0) return [];

    const publicationIds = results.map((r) => r.publication);
    const publicationsQuery = db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          inArray(publications.id, publicationIds),
        ),
      );

    const publicationsResults = await publicationsQuery;

    return await concurrentExecutor(
      publicationsResults,
      async (data) => {
        return await new PublicationResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );
  }

  static async listByAuthor(
    experiment: ExperimentResource,
    author: AgentResource,
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          eq(publications.author, author.toJSON().id),
        ),
      );

    return await concurrentExecutor(
      results,
      async (data) => {
        return await new PublicationResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );
  }

  static async listByExperiment(
    experiment: ExperimentResource,
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(publications)
      .where(eq(publications.experiment, experiment.toJSON().id))
      .orderBy(desc(publications.created));

    return await concurrentExecutor(
      results,
      async (data) => {
        return await new PublicationResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );
  }

  static async findByReference(
    experiment: ExperimentResource,
    reference: string,
  ): Promise<Result<PublicationResource>> {
    const [r] = await PublicationResource.findByReferences(experiment, [
      reference,
    ]);

    return r ? ok(r) : err("not_found_error", `Publication not found for reference: ${reference}`);
  }

  static async findByReferences(
    experiment: ExperimentResource,
    references: string[],
  ): Promise<PublicationResource[]> {
    const results = await db
      .select()
      .from(publications)
      .where(
        and(
          eq(publications.experiment, experiment.toJSON().id),
          inArray(publications.reference, references),
        ),
      );

    return await concurrentExecutor(
      results,
      async (data) => {
        return await new PublicationResource(data, experiment).finalize();
      },
      { concurrency: 8 },
    );
  }

  private static extractReferences(content: string) {
    const regex = /\[([a-z0-9]{4}(?:\s*,\s*[a-z0-9]{4})*)\]/g;
    const matches = [];

    let match;
    while ((match = regex.exec(content)) !== null) {
      // Split by comma and trim whitespace to get individual IDs
      const ids = match[1].split(",").map((id) => id.trim());
      matches.push(...ids);
    }

    return matches;
  }

  static async submit(
    experiment: ExperimentResource,
    author: AgentResource,
    data: {
      title: string;
      abstract: string;
      content: string;
    },
  ): Promise<Result<PublicationResource>> {
    const references = PublicationResource.extractReferences(data.content);
    const found = await PublicationResource.findByReferences(
      experiment,
      references,
    );

    const foundFilter = new Set(found.map((c) => c.toJSON().reference));
    const notFound = references.filter((r) => !foundFilter.has(r));

    if (notFound.length > 0) {
      return err(
        "reference_not_found_error",
        "Reference not found in publication submission content: " +
        notFound.join(","),
      );
    }

    const [created] = await db
      .insert(publications)
      .values({
        experiment: experiment.toJSON().id,
        author: author.toJSON().id,
        ...data,
        reference: newID4(),
        status: "SUBMITTED",
      })
      .returning();

    // We don't create citations until the publication gets published.

    return ok(await new PublicationResource(created, experiment).finalize());
  }

  async maybePublishOrReject(): Promise<
    "SUBMITTED" | "PUBLISHED" | "REJECTED"
  > {
    const grades = removeNulls(this.reviews.map((r) => r.grade ?? null));

    // If we are mising reviews return early
    if (grades.length < this.reviews.length) {
      return "SUBMITTED";
    }

    // publish only if we only have accept or strong_accept
    if (grades.some((g) => g === "REJECT" || g === "STRONG_REJECT")) {
      await this.reject();
    } else {
      await this.publish();
    }

    return this.data.status;
  }

  async publish(): Promise<Result<PublicationResource>> {
    const references = PublicationResource.extractReferences(this.data.content);
    const found = await PublicationResource.findByReferences(
      this.experiment,
      references,
    );

    try {
      if (found.length > 0) {
        await db.insert(citations).values(
          found.map((c) => ({
            experiment: this.experiment.toJSON().id,
            from: this.data.id,
            to: c.toJSON().id,
          })),
        );
      }

      const [updated] = await db
        .update(publications)
        .set({
          status: "PUBLISHED",
          updated: new Date(),
        })
        .where(eq(publications.id, this.data.id))
        .returning();

      if (!updated) {
        return err("not_found_error", "Publication not found");
      }

      this.data = updated;
      Advisory.push(this.author.name, { type: "publication_status_update", reference: this.toJSON().reference, status: "PUBLISHED", title: this.data.title })
      return ok(this);
    } catch (error) {
      return err(
        "resource_update_error",
        "Failed to publish publication",
        error,
      );
    }
  }

  async reject(): Promise<Result<PublicationResource>> {
    try {
      const [updated] = await db
        .update(publications)
        .set({
          status: "REJECTED",
          updated: new Date(),
        })
        .where(eq(publications.id, this.data.id))
        .returning();

      if (!updated) {
        return err("not_found_error", "Publication not found");
      }

      Advisory.push(this.author.name, { type: "publication_status_update", reference: this.toJSON().reference, status: "REJECTED", title: this.data.title })
      this.data = updated;
      return ok(this);
    } catch (error) {
      return err(
        "resource_update_error",
        "Failed to reject publication",
        error,
      );
    }
  }

  async requestReviewers(
    reviewers: AgentResource[],
  ): Promise<Result<Review[]>> {
    if (this.reviews.length > 0) {
      return err(
        "resource_creation_error",
        "Reviews already exist for this publication",
      );
    }

    for (const reviewer of reviewers) {
      Advisory.push(reviewer.toJSON().name, { type: "review_requested", reference: this.toJSON().reference, title: this.data.title });
    }

    const created = await db
      .insert(reviews)
      .values(
        reviewers.map((reviewer) => ({
          experiment: this.experiment.toJSON().id,
          publication: this.data.id,
          author: reviewer.toJSON().id,
        })),
      )
      .returning();

    this.reviews = created.map((r) => ({
      ...r,
      author: reviewers.find((rev) => rev.toJSON().id === r.author)!.toJSON(),
    }));

    return ok(this.reviews);
  }

  async submitReview(
    reviewer: AgentResource,
    data: Omit<
      InferInsertModel<typeof reviews>,
      "id" | "created" | "updated" | "experiment" | "publication" | "author"
    >,
  ): Promise<Result<Review>> {
    const idx = this.reviews.findIndex(
      (r) => r.author?.id === reviewer.toJSON().id,
    );
    if (idx === -1) {
      return err(
        "resource_creation_error",
        "Review submitted does not match any review request.",
      );
    }

    Advisory.push(this.author.name, { type: "review_received", author: reviewer.toJSON().name, reference: this.toJSON().reference, grade: data.grade!, title: this.data.title })

    const [updated] = await db
      .update(reviews)
      .set({
        grade: data.grade,
        content: data.content,
        updated: new Date(),
      })
      .where(
        and(
          eq(reviews.experiment, this.experiment.toJSON().id),
          eq(reviews.publication, this.data.id),
          eq(reviews.author, reviewer.toJSON().id),
        ),
      )
      .returning();

    if (!updated) {
      return err("not_found_error", "Review not found");
    }

    this.reviews[idx] = { ...updated, author: reviewer.toJSON() };

    return ok(this.reviews[idx]);
  }

  async delete(): Promise<void> {
    const pubId = this.data.id;

    // Delete citations where this publication is referenced (from or to)
    await db.delete(citations).where(eq(citations.from, pubId));
    await db.delete(citations).where(eq(citations.to, pubId));

    // Delete reviews for this publication
    await db.delete(reviews).where(eq(reviews.publication, pubId));

    // Nullify solutions that reference this publication
    await db
      .update(solutions)
      .set({ publication: null })
      .where(eq(solutions.publication, pubId));

    // Delete the publication itself
    await db.delete(publications).where(eq(publications.id, pubId));
  }

  toJSON() {
    return {
      ...this.data,
      citations: this.citations,
      reviews: this.reviews,
      author: this.author,
    };
  }
}
