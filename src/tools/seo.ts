import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerSeoTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_seo_audit",
    "Run an SEO audit across all published posts and pages. Reports missing meta descriptions, missing meta titles, title length issues, missing OG images, thin content, missing excerpts, and duplicate titles. Returns a summary with score and a list of issues per item.",
    {},
    async () => {
      const result = await client.get("/seo/audit");
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_seo_analyze",
    "Analyze a single post or page for SEO signals. Returns word count, heading structure, image count (with missing alt detection), internal/external link counts, meta field lengths, and actionable suggestions.",
    {
      type: z.enum(["post", "page"]).describe("Content type to analyze"),
      id: z.string().describe("The post or page ID"),
    },
    async ({ type, id }) => {
      const result = await client.get(`/seo/analyze/${type}/${id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_seo_check_links",
    "Scan published content for broken links. By default checks internal links only (fast). Set checkExternal=true to also verify external URLs via HEAD requests (slower, limited to 50 URLs). Optionally scope to a single post or page by providing type and id.",
    {
      checkExternal: z.boolean().optional().describe("Also check external URLs (slower). Default: false"),
      type: z.enum(["post", "page"]).optional().describe("Scope to a single content type"),
      id: z.string().optional().describe("Scope to a single post or page ID"),
    },
    async ({ checkExternal, type, id }) => {
      const params: Record<string, string> = {};
      if (checkExternal) params.check = "true";
      if (type && id) {
        params.type = type;
        params.id = id;
      }
      const result = await client.get("/seo/links", params);
      return formatResult(result);
    }
  );
}
