import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the providers module
vi.mock("./web-providers", () => ({
  createWebClient: vi.fn().mockReturnValue({
    fetch: vi.fn().mockResolvedValue({
      success: true,
      content: "# Mocked Content\n\nThis is test content.",
    }),
    search: vi.fn().mockResolvedValue({
      success: true,
      results: [
        {
          title: "Result 1",
          url: "https://example.com/1",
          description: "Description 1",
        },
        {
          title: "Result 2",
          url: "https://example.com/2",
          description: "Description 2",
        },
      ],
    }),
  }),
}));

import { createWebServer } from "./web";
import { createWebClient } from "./web-providers";

describe("Web Tool", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Provider Selection", () => {
    it("defaults to firecrawl when WEB_PROVIDER is not set", async () => {
      delete process.env.WEB_PROVIDER;
      await createWebServer();
      expect(createWebClient).toHaveBeenCalledWith("firecrawl");
    });

    it("uses linkup when WEB_PROVIDER=linkup", async () => {
      process.env.WEB_PROVIDER = "linkup";
      await createWebServer();
      expect(createWebClient).toHaveBeenCalledWith("linkup");
    });

    it("uses firecrawl when WEB_PROVIDER=firecrawl", async () => {
      process.env.WEB_PROVIDER = "firecrawl";
      await createWebServer();
      expect(createWebClient).toHaveBeenCalledWith("firecrawl");
    });
  });

  describe("Server Creation", () => {
    it("creates server with correct name", async () => {
      const server = await createWebServer();
      // @ts-ignore - accessing private property for test
      expect(server.server._serverInfo.name).toBe("web");
    });

    it("includes provider in description", async () => {
      process.env.WEB_PROVIDER = "linkup";
      const server = await createWebServer();
      // @ts-ignore - accessing private property for test
      expect(server.server._serverInfo.description).toContain("linkup");
    });
  });
});
