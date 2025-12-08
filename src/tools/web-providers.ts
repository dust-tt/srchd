import Firecrawl from "@mendable/firecrawl";
import { LinkupClient } from "linkup-sdk";

export type WebProviderType = "firecrawl" | "linkup";

export interface FetchResult {
  success: boolean;
  content?: string;
  error?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export interface SearchResponse {
  success: boolean;
  results?: SearchResult[];
  error?: string;
}

export interface WebClient {
  fetch(url: string): Promise<FetchResult>;
  search(query: string, count: number): Promise<SearchResponse>;
}

export function createFirecrawlClient(): WebClient {
  const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

  return {
    async fetch(url: string): Promise<FetchResult> {
      const response = await firecrawl.scrapeUrl(url, {
        formats: ["markdown"],
      });
      if (response.success) {
        return { success: true, content: response.markdown || "" };
      }
      return { success: false, error: response.error };
    },

    async search(query: string, count: number): Promise<SearchResponse> {
      const response = await firecrawl.search(query, { limit: count });
      if (response.success) {
        return {
          success: true,
          results: response.data.map((r) => ({
            title: r.title || "Untitled",
            url: r.url,
            description: r.description || "",
          })),
        };
      }
      return { success: false, error: response.error };
    },
  };
}

export function createLinkupClient(): WebClient {
  const client = new LinkupClient({
    apiKey: process.env.LINKUP_API_KEY || "",
  });

  return {
    async fetch(url: string): Promise<FetchResult> {
      try {
        const response = await client.fetch({
          url,
          renderJs: false,
          includeRawHtml: false,
          extractImages: false,
        });
        return { success: true, content: response.content || "" };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async search(query: string, count: number): Promise<SearchResponse> {
      try {
        const response = await client.search({
          query,
          depth: "standard",
          outputType: "searchResults",
          maxResults: count,
        });
        const results: SearchResult[] = [];
        if (response.results && Array.isArray(response.results)) {
          for (const r of response.results) {
            results.push({
              title: r.name || "Untitled",
              url: r.url,
              description: r.content || "",
            });
          }
        }
        return { success: true, results };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

export function createWebClient(provider: WebProviderType): WebClient {
  return provider === "linkup"
    ? createLinkupClient()
    : createFirecrawlClient();
}
