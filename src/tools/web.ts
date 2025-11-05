import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { errorToCallToolResult } from "../lib/mcp";
import { SrchdError } from "../lib/error";
<<<<<<< HEAD
import Firecrawl from "@mendable/firecrawl";
=======
import Firecrawl from "@mendable/firecrawl-js";
>>>>>>> 36c60d9 (made-fetch-server)

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
<<<<<<< HEAD
        const text = scrapeResponse.markdown
          ? scrapeResponse.markdown.slice(0, 40000) // Approximately 10k tokens.
          : "";
=======
        console.log("WEBPAGE CONTENT:", scrapeResponse.markdown);
>>>>>>> 36c60d9 (made-fetch-server)
        return {
          isError: false,
          content: [
            {
              type: "text",
<<<<<<< HEAD
              text,
=======
              text: scrapeResponse.markdown ?? "",
>>>>>>> 36c60d9 (made-fetch-server)
            },
          ],
        };
      }
      return errorToCallToolResult(
        new SrchdError(
<<<<<<< HEAD
          "web_fetch_error",
=======
          "fetch_error",
>>>>>>> 36c60d9 (made-fetch-server)
          "Failed to fetch the webpage",
          new Error(scrapeResponse.error),
        ),
      );
    },
  );

  return server;
}
