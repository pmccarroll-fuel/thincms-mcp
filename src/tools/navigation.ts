import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

const navItemSchema = z.object({
  label: z.string().describe("Display text for the link"),
  type: z.enum(["page", "route", "external"]).describe("Link type: 'page' (slug), 'route' (CMS path like /blog), 'external' (full URL)"),
  target: z.string().describe("Page slug, CMS route path, or external URL"),
});

export function registerNavigationTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_get_navigation",
    "Get the site's header and footer navigation arrays. Each nav item has a label, type (page/route/external), and target.",
    {},
    async () => {
      const result = await client.get("/navigation");
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_navigation",
    "Update header and/or footer navigation. Each is a full replacement array (max 20 items). Item types: 'page' (target = page slug, must exist and be published), 'route' (target = CMS path like /blog or /search), 'external' (target = full URL).",
    {
      headerNav: z.array(navItemSchema).max(20).optional().describe("Header navigation items"),
      footerNav: z.array(navItemSchema).max(20).optional().describe("Footer navigation items"),
    },
    async (params) => {
      const result = await client.put("/navigation", params);
      return formatResult(result);
    }
  );
}
