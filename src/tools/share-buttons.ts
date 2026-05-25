import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerShareButtonTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_get_share_buttons",
    "Get the site's share button configuration. Returns { enabled: boolean, platforms: string[] }. Platforms: 'twitter', 'linkedin', 'facebook', 'email', 'copy'.",
    {},
    async () => {
      const result = await client.get("/share-buttons");
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_share_buttons",
    "Update the site's share button configuration. Share buttons appear on blog posts and let readers share via social platforms or copy the link. Only provided fields are changed.",
    {
      enabled: z.boolean().optional().describe("Enable or disable share buttons on blog posts"),
      platforms: z.array(z.enum(["twitter", "linkedin", "facebook", "email", "copy"])).optional().describe("Platforms to show. Order determines display order."),
    },
    async (params) => {
      const result = await client.put("/share-buttons", params);
      return formatResult(result);
    }
  );
}
