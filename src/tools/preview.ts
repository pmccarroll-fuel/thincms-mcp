import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

const contentOverrideSchema = z.object({
  type: z.enum(["post", "page"]).describe("Content type"),
  id: z.string().describe("Post or page ID"),
  overrides: z.object({
    title: z.string().optional(),
    content: z.string().optional(),
    status: z.string().optional(),
  }).describe("Fields to override in the preview"),
});

export function registerPreviewTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_create_preview",
    "Create a preview session with draft template or content overrides. Returns a token-based preview URL (valid for 2 hours). Use this to preview CSS/template changes or draft content without publishing.",
    {
      stylesheet: z.string().optional().describe("Draft CSS to preview"),
      pageFrame: z.string().optional().describe("Draft HTML page frame to preview"),
      customHeadHtml: z.string().optional().describe("Draft custom head HTML to preview"),
      contentOverrides: z.array(contentOverrideSchema).optional().describe("Array of post/page content overrides to preview"),
    },
    async (params) => {
      const result = await client.post("/preview", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_preview_url",
    "Get the full preview URL for a preview token. The URL can be opened in a browser to view the preview — no authentication required.",
    {
      token: z.string().describe("Preview token from thincms_create_preview"),
    },
    async (params) => {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            previewUrl: `${process.env.THINCMS_BASE_URL}/api/v1/preview/${params.token}`,
            token: params.token,
          }, null, 2),
        }],
      };
    }
  );
}
