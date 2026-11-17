import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerSeoTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_seo_audit",
    "Run an SEO audit across all published posts and pages. Reports missing meta descriptions, missing meta titles, title length issues, missing OG images, thin content, missing excerpts, and duplicate titles. Returns a summary with score and a list of issues per item.",
    {},
    async () => {
      const result = await client.get("/seo/audit");
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
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

  siteAwareTool(server, client, 
    "thincms_seo_check_links",
    "Scan published content for broken links. scope='internal' (default, fast) checks links to this site's pages and posts; scope='external' verifies only outbound URLs via HEAD requests (slower, up to 50 unique URLs); scope='all' does both. Each broken link reports its source page (title, path and full URL) and its target URL. Optionally limit to a single post or page by providing type and id.",
    {
      scope: z.enum(["internal", "external", "all"]).optional().describe("Which links to check. Default: internal"),
      checkExternal: z.boolean().optional().describe("Deprecated: same as scope='all'"),
      type: z.enum(["post", "page"]).optional().describe("Scope to a single content type"),
      id: z.string().optional().describe("Scope to a single post or page ID"),
    },
    async ({ scope, checkExternal, type, id }) => {
      const params: Record<string, string> = {};
      params.scope = scope ?? (checkExternal ? "all" : "internal");
      if (type && id) {
        params.type = type;
        params.id = id;
      }
      const result = await client.get("/seo/links", params);
      return formatResult(result);
    }
  );
}
