import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerSearchTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_search",
    "Full-text search across published posts and pages. Searches titles, excerpts, and content.",
    {
      q: z.string().describe("Search query (required)"),
      type: z.enum(["post", "page", "all"]).optional().describe("Limit search to posts, pages, or both (default: all)"),
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().optional().describe("Items per page (default: 20)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { q: params.q };
      if (params.type) queryParams.type = params.type;
      if (params.page) queryParams.page = String(params.page);
      if (params.limit) queryParams.limit = String(params.limit);
      const result = await client.get("/search", queryParams);
      return formatResult(result);
    }
  );
}
