import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorToCallToolResult } from "../lib/mcp";
import { SrchdError } from "../lib/error";
import Firecrawl from "@mendable/firecrawl";

const SERVER_NAME = "web";
const SERVER_VERSION = "0.1.0";

export async function createWebServer(): Promise<McpServer> {
  const server = new McpServer({
    name: SERVER_NAME,
    title: "Web Tools",
    description: "Tools to Search and browse the web",
    version: SERVER_VERSION,
  });

  // The Firecrawl SDK dosen't fetch the key automatically from env.
  const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

  server.tool(
    "fetch",
    "Returns a Markdown-formatted content of the webpage at url. (Capped at 8196 characters)",
    {
      url: z
        .string()
        .describe("The URL of the webpage to fetch. Must be a valid URL."),
      offset: z
        .number()
        .describe("The offset (in chars) of the content to fetch.")
        .default(0),
      limit: z
        .number()
        .describe("The limit (in chars) of the content to fetch. (Max 8196)")
        .default(8196),
    },
    async ({
      url,
      offset,
      limit,
    }: {
      url: string;
      offset: number;
      limit: number;
    }) => {
      const scrapeResponse = await firecrawl.scrapeUrl(url, {
        // By default cache-expiry is already set to 2 days.
        formats: ["markdown"],
      });

      if (limit > 8196) {
        return errorToCallToolResult(
          new SrchdError(
            "web_fetch_error",
            `The limit of ${limit} characters is too large. It must be less than 8196.`,
          ),
        );
      }

      if (scrapeResponse.success) {
        const text = scrapeResponse.markdown
          ? scrapeResponse.markdown.slice(offset, 8196 + offset)
          : "";
        return {
          isError: false,
          content: [
            {
              type: "text",
              text,
            },
          ],
        };
      }
      return errorToCallToolResult(
        new SrchdError(
          "web_fetch_error",
          "Failed to fetch the webpage",
          new Error(scrapeResponse.error),
        ),
      );
    },
  );

  server.tool(
    "search",
    "Returns list of search results for the query.",
    {
      query: z
        .string()
        .describe("The query to search for. Must be a valid query."),
    },
    async ({ query }: { query: string }) => {
      const searchResponse = await firecrawl.search(query, {
        limit: 10,
      });

      if (searchResponse.success) {
        let results = "";
        for (const [i, res] of searchResponse.data.entries()) {
          results += `${i + 1}. [${res.title}](${res.url})\n${res.description}\n\n`;
        }
        return {
          isError: false,
          content: [
            {
              type: "text",
              text: results,
            },
          ],
        };
      }

      return errorToCallToolResult(
        new SrchdError(
          "web_search_error",
          "Failed to search for the query",
          new Error(searchResponse.error),
        ),
      );
    },
  );

  return server;
}
