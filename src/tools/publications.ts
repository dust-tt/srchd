import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgentResource } from "@app/resources/agent";
import { errorToCallToolResult } from "@app/lib/mcp";
import { PublicationResource, Review } from "@app/resources/publication";
import { ExperimentResource } from "@app/resources/experiment";
import { err } from "@app/lib/error";
import { PUBLICATIONS_SERVER_NAME as SERVER_NAME } from "@app/tools/constants";
import { RunConfig } from "@app/runner/config";
import { copyFromComputer, copyToComputer } from "@app/computer/k8s";
import { computerId } from "@app/computer";
import fs from "fs";
import path from "path";

const SERVER_VERSION = "0.1.0";

export const reviewHeader = (review: Review) => {
  return `\
reviewer=${review.author.name}
grade=${review.grade ?? "PENDING"}`;
};


export function getAttachmentPath(experimentId: number, reference: string, filename?: string) {
  const pth = [
    "attachments",
    `${experimentId}`,
    `${reference}`,
  ];
  if (filename) {
    pth.push(path.basename(filename));
  }
  return path.join(...pth);
}

export const publicationHeader = (
  publication: PublicationResource,
  { withAbstract }: { withAbstract: boolean },
) => {
  const experimentId = publication.toJSON().experiment;
  const reference = publication.toJSON().reference;

  const attachmentsDir = getAttachmentPath(experimentId, reference);
  const attachments = fs.existsSync(attachmentsDir) ? fs.readdirSync(attachmentsDir) : [];

  return (
    `\
reference=[${publication.toJSON().reference}]
title=${publication.toJSON().title}
author=${publication.toJSON().author.name}
reviews:${publication
      .toJSON()
      .reviews.map((r) => `${r.grade ?? "PENDING"}`)
      .join(", ")}
status=${publication.toJSON().status}
citations_count=${publication.toJSON().citations.to.length}
attachments=[${attachments.join(",") + "]" +
    (withAbstract
      ? `\nabstract = ${publication.toJSON().abstract.replace("\n", " ")}`
      : "")}`
  );
};

export const renderListOfPublications = (
  publications: PublicationResource[],
  {
    withAbstract,
  }: {
    withAbstract: boolean;
  },
) => {
  if (publications.length === 0) {
    return "(0 found)";
  }
  return publications
    .map((p) => {
      return publicationHeader(p, { withAbstract });
    })
    .join("\n\n");
};

export async function createPublicationsServer(
  experiment: ExperimentResource,
  agent: AgentResource,
  config: RunConfig,
): Promise<McpServer> {
  const server = new McpServer({
    name: SERVER_NAME,
    title: "Publications: Tools to submit, review and access publications.",
    version: SERVER_VERSION,
  });


  server.tool(
    "list_publications",
    "List publications available in the system.",
    {
      order: z
        .enum(["latest", "citations"])
        .optional()
        .describe(
          `\
Ordering to use:
\`latest\` lists the most recent publications.
\`citations\` lists the most cited publications.
Defaults to \`latest\`.`,
        ),
      status: z
        .enum(["PUBLISHED", "SUBMITTED", "REJECTED"])
        .optional()
        .describe(
          `The status of the publications to list. Defaults to \`PUBLISHED\``,
        ),
      withAbstract: z
        .boolean()
        .optional()
        .describe(
          "Whether to include the abstract in the listing. Defaults to true.",
        ),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of publications to return. Defaults to 10."),
      offset: z
        .number()
        .optional()
        .describe("Offset for pagination. Defaults to 0."),
    },
    async ({
      order = "latest",
      status = "PUBLISHED",
      withAbstract = true,
      limit = 10,
      offset = 0,
    }) => {
      const publications = await PublicationResource.listPublishedByExperiment(
        experiment,
        {
          order,
          status,
          limit,
          offset,
        },
      );

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: renderListOfPublications(publications, {
              withAbstract,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "get_publication",
    "Retrieve a specific publication.",
    {
      reference: z.string().describe("Reference of the publication."),
    },
    async ({ reference }) => {
      const publicationRes = await PublicationResource.findByReference(
        experiment,
        reference,
      );
      if (publicationRes.isErr()) {
        return errorToCallToolResult(
          publicationRes,
        );
      }
      const publication = publicationRes.value;

      return {
        isError: false,
        content: [
          {
            type: "text",
            text:
              `\
${publicationHeader(publication, { withAbstract: true })}

${publication.toJSON().content}` +
              "\n\n" +
              `\
${publication
                .toJSON()
                .reviews.map((r) => {
                  return `\
${reviewHeader(r)}
${r.content}`;
                })
                .join("\n\n")}`,
          },
        ],
      };
    },
  );

  const hasComputerTool = agent.toJSON().profile.tools.includes("computer");

  server.tool(
    "submit_publication",
    "Submit a new publication for review and publication.",
    {
      title: z.string().describe("Title of the publication."),
      abstract: z
        .string()
        .describe("Abstract of the publication (avoid newlines)."),
      content: z
        .string()
        .describe(
          "Full content of the publication. Use [{ref}] or [{ref},{ref}] inlined in content for citations.",
        ),
      ...(hasComputerTool ? {
        attachments: z
          .array(z.string())
          .optional()
          .describe(
            "Optional paths to files in your computer to attach to the publication.",
          ) } : {}),
    },
    async ({ title, abstract, content, attachments }) => {
      const pendingReviews =
        await PublicationResource.listByExperimentAndReviewRequested(
          experiment,
          agent,
        );
      if (pendingReviews.length > 0) {
        return errorToCallToolResult(
          err(
            "publication_error",
            "You have pending reviews. Please complete them before submitting a new publication.",
          ),
        );
      }

      const agents = await AgentResource.listByExperiment(experiment);
      const pool = agents.filter((a) => a.toJSON().id !== agent.toJSON().id);
      if (pool.length < config.reviewers) {
        return errorToCallToolResult(
          err("publication_error", "Not enough reviewers available"),
        );
      }
      const reviewers = pool
        .sort(() => 0.5 - Math.random())
        .slice(0, config.reviewers);

      const publication = await PublicationResource.submit(experiment, agent, {
        title,
        abstract,
        content,
      });
      if (publication.isErr()) {
        return errorToCallToolResult(publication);
      }

      if (attachments && hasComputerTool) {
        const reference = publication.value.toJSON().reference;
        const attachmentsDir = getAttachmentPath(experiment.toJSON().id, reference);

        // Ensure attachments directory exists
        if (!fs.existsSync(attachmentsDir)) {
          fs.mkdirSync(attachmentsDir, { recursive: true });
        }

        for (const attachmentPath of attachments) {
          const localFilePath = getAttachmentPath(experiment.toJSON().id, reference, attachmentPath);
          const copyRes = await copyFromComputer(
            computerId(experiment, agent),
            attachmentPath,
            localFilePath,
          );

          if (copyRes.isErr()) {
            return errorToCallToolResult(copyRes);
          }
        }
      }

      const reviews = await publication.value.requestReviewers(reviewers);
      if (reviews.isErr()) {
        return errorToCallToolResult(reviews);
      }
      if (reviewers.length === 0) {
        await publication.value.maybePublishOrReject();
      }

      const res = publication.value.toJSON();

      delete (res as any).reviews;

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: "Publication submitted.",
          },
        ],
      };
    },
  );

  if (hasComputerTool) {
    server.tool(
      "download_publication_attachments",
      "Download the attachments of a publication to your computer. The attachments will be saved under the folder /home/agent/publications/`${reference}` in your computer.",
      {
        reference: z.string().describe("Reference of the publication."),
      },
      async ({ reference }) => {
        const publicationRes = await PublicationResource.findByReference(
          experiment,
          reference,
        );
        if (publicationRes.isErr()) {
          return errorToCallToolResult(
            publicationRes,
          );
        }
        const publication = publicationRes.value;

        const attachmentsDir = getAttachmentPath(publication.experiment.toJSON().id, reference);
        if (!fs.existsSync(attachmentsDir)) {
          return errorToCallToolResult(
            err("not_found_error", "Attachment files not found"),
          );
        }

        const copyRes = await copyToComputer(
          computerId(experiment, agent),
          attachmentsDir,
          undefined,
          "publications",
        );

        if (copyRes.isErr()) {
          return errorToCallToolResult(copyRes);
        }

        return {
          isError: false,
          content: [
            {
              type: "text",
              text: `Attachment downloaded to /home/agent/publications/${reference}.`,
            },
          ],
        };
      },
    );
  }

  server.tool(
    "list_review_requests",
    "List pending review requests received by the caller.",
    {},
    async () => {
      const publications =
        await PublicationResource.listByExperimentAndReviewRequested(
          experiment,
          agent,
        );

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: renderListOfPublications(publications, {
              withAbstract: false,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "list_submitted_publications",
    "List publications submitted by the caller.",
    {},
    async () => {
      const publications = await PublicationResource.listByAuthor(
        experiment,
        agent,
      );

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: renderListOfPublications(publications, {
              withAbstract: false,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "submit_review",
    "Submit a review for a publication.",
    {
      publication: z
        .string()
        .describe("The reference of the publication to review."),
      grade: z
        .enum(["STRONG_ACCEPT", "ACCEPT", "REJECT", "STRONG_REJECT"])
        .describe("Grade for the publication."),
      content: z.string().describe("Content of the review."),
    },
    async ({ publication: reference, grade, content }) => {
      const publicationRes = await PublicationResource.findByReference(
        experiment,
        reference,
      );
      if (publicationRes.isErr()) {
        return errorToCallToolResult(
          publicationRes,
        );
      }
      const publication = publicationRes.value;

      const review = await publication.submitReview(agent, {
        grade,
        content,
      });

      if (review.isErr()) {
        return errorToCallToolResult(review);
      }

      await publication.maybePublishOrReject();

      return {
        isError: false,
        content: [
          {
            type: "text",
            text: `Review submitted for publication [${reference}].`,
          },
        ],
      };
    },
  );

  return server;
}
