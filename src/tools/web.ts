import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorToCallToolResult } from "../lib/mcp";
import { SrchdError } from "../lib/error";
import Firecrawl from "@mendable/firecrawl-js";

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
    "Returns a Markdown-formatted content of the webpage at url.",
    {
      url: z
        .string()
        .describe("The URL of the webpage to fetch. Must be a valid URL."),
    },
    async ({ url }: { url: string }) => {
      const scrapeResponse = await firecrawl.scrapeUrl(url, {
        // By default cache-expiry is already set to 2 days.
        formats: ["markdown"],
      });

      if (scrapeResponse.success) {
        // console.log("WEBPAGE CONTENT:", scrapeResponse.markdown);
        return {
          isError: false,
          content: [
            {
              type: "text",
              text: scrapeResponse.markdown ?? "",
            },
          ],
        };
      }
      return errorToCallToolResult(
        new SrchdError(
          "fetch_error",
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
      const searchResponse = await firecrawl.search(query);

      if (searchResponse.success) {
        let results = "";
        for (const [i, res] of searchResponse.data.entries()) {
          results += `${i + 1}. [${res.title}](${res.url})\n`;
        }
        // console.log("SEARCH RESULTS:\n", results);
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
          "search_error",
          "Failed to search for the query",
          new Error(searchResponse.error),
        ),
      );
    },
  );

  return server;
}
