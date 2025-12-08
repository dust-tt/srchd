import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorToCallToolResult } from "@app/lib/mcp";
import { err } from "@app/lib/error";
import { WEB_SERVER_NAME as SERVER_NAME } from "./constants";
import { createWebClient, WebProviderType } from "./web-providers";

const SERVER_VERSION = "0.1.0";

export async function createWebServer(): Promise<McpServer> {
  const provider = (process.env.WEB_PROVIDER || "firecrawl") as WebProviderType;

  const server = new McpServer({
    name: SERVER_NAME,
    title: "Web Browsing & Search",
    description: `Tools to search and browse the web (provider: ${provider})`,
    version: SERVER_VERSION,
  });

  const client = createWebClient(provider);

  server.tool(
    "fetch",
    "Returns a Markdown-formatted content of the webpage at url.",
    {
      url: z.string().describe("The URL of the webpage to fetch."),
      offset: z
        .number()
        .describe(
          "The offset (in number of characters) of the content to fetch (supports unauthenticated\
        web pages and PDFs). (default: 0)",
        )
        .default(0),
      length: z
        .number()
        .describe(
          "length (in number of characters) of the data returned from the fetched content (max\
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
      if (length > 8196) {
        return errorToCallToolResult(
          err(
            "web_fetch_error",
            `The length of ${length} characters is too large. It must be less than 8196.`,
          ),
        );
      }

      const fetchResponse = await client.fetch(url);

      if (fetchResponse.success) {
        const text = fetchResponse.content
          ? fetchResponse.content.slice(offset, 8196 + offset)
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
        err(
          "web_fetch_error",
          "Failed to fetch the webpage",
          new Error(fetchResponse.error),
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
          err(
            "web_search_error",
            `The count of ${count} results is too large. It must be less than 20.`,
          ),
        );
      }

      const searchResponse = await client.search(query, count);

      if (searchResponse.success && searchResponse.results) {
        let results = "";
        for (const [i, res] of searchResponse.results.entries()) {
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
        err(
          "web_search_error",
          "Failed to search for the query",
          new Error(searchResponse.error),
        ),
      );
    },
  );

  return server;
}
