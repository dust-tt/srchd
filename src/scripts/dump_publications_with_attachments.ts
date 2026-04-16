import { ExperimentResource } from "@app/resources/experiment";
import { PublicationResource } from "@app/resources/publication";

import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";

function usage(exitCode = 1): never {
  const out = exitCode === 0 ? console.log : console.error;
  out(`Usage: npx tsx src/scripts/dump_publications_with_attachments.ts [options]

Options:
  -o, --output <file>         Output tarball path
  -e, --experiment <name>     Only dump one experiment
  -f, --force                 Overwrite output file if it exists
  -h, --help                  Show this help
`);
  process.exit(exitCode);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "publication";
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-") || "unknown";
}

function attachmentDir(experimentId: number, reference: string): string {
  return path.join("attachments", `${experimentId}`, reference);
}

async function listFilesRecursive(dir: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relPath = path.join(prefix, entry.name);
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(absolutePath, relPath));
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }

  return files.sort();
}

function renderPublicationMarkdown(
  publication: Awaited<ReturnType<typeof PublicationResource.listByExperiment>>[number],
): string {
  const pub = publication.toJSON();

  let markdown = `# ${pub.title}\n\n`;
  markdown += `**Experiment:** ${publication.experiment.toJSON().name}\n`;
  markdown += `**Author:** ${pub.author.name}\n`;
  markdown += `**Status:** ${pub.status}\n`;
  markdown += `**Reference:** ${pub.reference}\n`;
  markdown += `**Created:** ${pub.created.toISOString()}\n\n`;
  markdown += `## Abstract\n\n${pub.abstract}\n\n`;
  markdown += `${pub.content ?? ""}\n\n`;

  if (pub.citations.from.length > 0) {
    markdown += `## Citations From This Publication\n\n`;
    for (const citation of pub.citations.from) {
      markdown += `- Publication ID: ${citation.to}\n`;
    }
    markdown += `\n`;
  }

  if (pub.citations.to.length > 0) {
    markdown += `## Citations To This Publication\n\n`;
    for (const citation of pub.citations.to) {
      markdown += `- Publication ID: ${citation.from}\n`;
    }
    markdown += `\n`;
  }

  if (pub.reviews.length > 0) {
    markdown += `## Reviews\n\n`;
    for (const review of pub.reviews) {
      markdown += `### Review by ${review.author.name || "Unknown"}\n\n`;
      if (review.grade) {
        markdown += `**Grade:** ${review.grade.replace(/_/g, " ")}\n\n`;
      }
      if (review.content) {
        markdown += `${review.content}\n\n`;
      }
      markdown += `---\n\n`;
    }
  }

  return markdown;
}

async function tarDirectory(sourceDir: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["czf", outputPath, "-C", path.dirname(sourceDir), path.basename(sourceDir)]);

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar exited with code ${code}`));
      }
    });
  });
}

async function main() {
  let outputPath = path.resolve(
    `publications-with-attachments-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`,
  );
  let experimentName: string | undefined;
  let force = false;

  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "-o":
      case "--output": {
        const value = args[++i];
        if (!value) usage();
        outputPath = path.resolve(value);
        break;
      }
      case "-e":
      case "--experiment": {
        const value = args[++i];
        if (!value) usage();
        experimentName = value;
        break;
      }
      case "-f":
      case "--force":
        force = true;
        break;
      case "-h":
      case "--help":
        usage(0);
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        usage();
    }
  }

  if (fsSync.existsSync(outputPath) && !force) {
    throw new Error(`Output file already exists: ${outputPath} (use --force to overwrite)`);
  }

  const experiments = experimentName
    ? [await (async () => {
      const res = await ExperimentResource.findByName(experimentName!);
      if (res.isErr()) {
        throw new Error(res.error.message);
      }
      return res.value;
    })()]
    : await ExperimentResource.all();

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "srchd-publications-"));
  const archiveRoot = path.join(tempRoot, "publications-dump");
  await fs.mkdir(archiveRoot, { recursive: true });

  const manifest: Array<{
    experimentId: number;
    experimentName: string;
    publicationId: number;
    reference: string;
    title: string;
    status: string;
    author: string;
    created: string;
    archivePath: string;
    attachmentCount: number;
    attachments: string[];
  }> = [];

  try {
    for (const experiment of experiments) {
      const publications = await PublicationResource.listByExperiment(experiment);

      for (const publication of publications) {
        const pub = publication.toJSON();
        const srcAttachmentsDir = attachmentDir(pub.experiment, pub.reference);

        let attachments: string[] = [];
        let hasAttachmentDirectory = false;

        if (fsSync.existsSync(srcAttachmentsDir)) {
          const stat = await fs.stat(srcAttachmentsDir);
          if (stat.isDirectory()) {
            hasAttachmentDirectory = true;
            attachments = await listFilesRecursive(srcAttachmentsDir);
          }
        }

        const experimentDir = sanitizePathPart(experiment.toJSON().name);
        const publicationDirName = `${pub.reference}-${slugify(pub.title)}`;
        const archivePath = path.join(experimentDir, publicationDirName);
        const outDir = path.join(archiveRoot, archivePath);
        const outAttachmentsDir = path.join(outDir, "attachments");

        await fs.mkdir(outDir, { recursive: true });
        await fs.writeFile(
          path.join(outDir, "publication.md"),
          renderPublicationMarkdown(publication),
          "utf8",
        );
        await fs.writeFile(
          path.join(outDir, "metadata.json"),
          JSON.stringify(
            {
              experiment: experiment.toJSON(),
              publication: pub,
              attachments,
            },
            null,
            2,
          ),
          "utf8",
        );

        if (hasAttachmentDirectory) {
          await fs.mkdir(outAttachmentsDir, { recursive: true });
          await fs.cp(srcAttachmentsDir, outAttachmentsDir, { recursive: true });
        }

        manifest.push({
          experimentId: experiment.toJSON().id,
          experimentName: experiment.toJSON().name,
          publicationId: pub.id,
          reference: pub.reference,
          title: pub.title,
          status: pub.status,
          author: pub.author.name,
          created: pub.created.toISOString(),
          archivePath,
          attachmentCount: attachments.length,
          attachments,
        });
      }
    }

    await fs.writeFile(
      path.join(archiveRoot, "manifest.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          publicationCount: manifest.length,
          publications: manifest,
        },
        null,
        2,
      ),
      "utf8",
    );

    if (fsSync.existsSync(outputPath)) {
      await fs.rm(outputPath, { force: true });
    }
    await tarDirectory(archiveRoot, outputPath);

    console.log(`Wrote ${manifest.length} publication(s) to ${outputPath}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
