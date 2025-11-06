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
    title: "Web Browsing & Search",
    description: "Tools to search and browse the web",
    version: SERVER_VERSION,
  });

  // The Firecrawl SDK dosen't fetch the key automatically from env.
  const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

  server.tool(
    "fetch",
    "Returns a Markdown-formatted content of the webpage at url.",
    {
      url: z.string().describe("The URL of the webpage to fetch."),
      offset: z
        .number()
        .describe(
          "The offset (in number of characters) of the content to fetch. (Default: 0)",
        )
        .default(0),
      length: z
        .number()
        .describe(
          " length (in number of characters) of the data returned from the fetched content (max\
          8169, defaults to 8196).",
        )
        .default(8196),
    },
    async ({
      url,
      offset,
      length,
    }: {
      url: string;
      offset: number;
      length: number;
    }) => {
      const scrapeResponse = await firecrawl.scrapeUrl(url, {
        // By default cache-expiry is already set to 2 days.
        formats: ["markdown"],
      });

      if (length > 8196) {
        return errorToCallToolResult(
          new SrchdError(
            "web_fetch_error",
            `The length of ${length} characters is too large. It must be less than 8196.`,
          ),
        );
      }

      if (scrapeResponse.success) {
        const text = scrapeResponse.markdown
          ? scrapeResponse.markdown.slice(offset, 8196 + offset)
          : "";
        console.log("WEBPAGE CONTENT:", text);
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
      query: z.string().describe("The query to search for."),
      count: z
        .number()
        .describe("The number of results to return (max 20, defaults to 10).")
        .default(10),
    },
    async ({ query, count }: { query: string; count: number }) => {
      if (count > 20) {
        return errorToCallToolResult(
          new SrchdError(
            "web_search_error",
            `The count of ${count} results is too large. It must be less than 20.`,
          ),
        );
      }

      const searchResponse = await firecrawl.search(query, {
        limit: count,
      });

      if (searchResponse.success) {
        let results = "";
        for (const [i, res] of searchResponse.data.entries()) {
          results += `${i + 1}. [${res.title}](${res.url})\n${res.description}\n\n`;
        }
        console.log("SEARCH RESULTS:\n", results);
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
