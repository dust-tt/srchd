import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorToCallToolResult } from "@app/lib/mcp";
import { err } from "@app/lib/error";
import Firecrawl from "@mendable/firecrawl";
import { WEB_SERVER_NAME as SERVER_NAME } from "./constants";

const SERVER_VERSION = "0.1.0";

export async function createWebServer(): Promise<McpServer> {
  const server = new McpServer({
    name: SERVER_NAME,
    title: "Web Browsing & Search: Tools to search and browse the web",
    version: SERVER_VERSION,
  });

  // The Firecrawl SDK doesn't fetch the key automatically from env.
  const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

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
          8192, defaults to 8192).",
        )
        .default(8192),
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
      if (length > 8192) {
        return errorToCallToolResult(
          err(
            "web_fetch_error",
            `The length of ${length} characters is too large. It must be less than 8192.`,
          ),
        );
      }

      try {
        const document = await firecrawl.scrape(url, {
          // By default cache-expiry is already set to 2 days.
          formats: ["markdown"],
        });
        const text = document.markdown
          ? document.markdown.slice(offset, length + offset)
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
      } catch (error) {
        return errorToCallToolResult(
          err(
            "web_fetch_error",
            "Failed to fetch the webpage",
            error,
          ),
        );
      }
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

      try {
        const searchResponse = await firecrawl.search(query, {
          limit: count,
        });
        let results = "";
        for (const [i, res] of (searchResponse.web ?? []).entries()) {
          const title = "url" in res ? res.title : res.metadata?.title;
          const url =
            "url" in res
              ? res.url
              : (res.metadata?.url ?? res.metadata?.sourceURL);
          const description =
            "url" in res ? res.description : res.metadata?.description;
          results += `${i + 1}. [${title ?? url ?? "Untitled"}](${url ?? ""})\n${description ?? ""}\n\n`;
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
      } catch (error) {
        return errorToCallToolResult(
          err(
            "web_search_error",
            "Failed to search for the query",
            error,
          ),
        );
      }
    },
  );

  return server;
}
