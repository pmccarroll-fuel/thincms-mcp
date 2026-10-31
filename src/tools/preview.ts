import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool, resolveContentInput, uploadIdField } from "../helpers.js";

const contentOverrideSchema = z.object({
  type: z.enum(["post", "page"]).describe("Content type"),
  id: z.string().describe("Post or page ID"),
  overrides: z.object({
    title: z.string().optional(),
    content: z.string().optional(),
    contentUploadId: uploadIdField("the draft HTML content"),
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
      stylesheetUploadId: uploadIdField("the draft CSS"),
      pageFrameUploadId: uploadIdField("the draft page frame HTML"),
      customHeadHtmlUploadId: uploadIdField("the draft custom head HTML"),
      contentOverrides: z.array(contentOverrideSchema).optional().describe("Array of post/page content overrides to preview"),
    },
    async (params) => {
      const p = params as Record<string, any>;
      const body: Record<string, any> = {};
      for (const field of ["stylesheet", "pageFrame", "customHeadHtml"]) {
        const resolved = await resolveContentInput(
          client,
          { inline: p[field], uploadId: p[`${field}UploadId`] },
          { inline: field, file: `${field}File`, upload: `${field}UploadId` },
        );
        if (!resolved.ok) return formatResult(resolved.error);
        if (resolved.value !== undefined) body[field] = resolved.value;
      }
      if (params.contentOverrides) {
        body.contentOverrides = [];
        for (const item of params.contentOverrides) {
          const { contentUploadId, ...overrides } = item.overrides;
          const resolved = await resolveContentInput(
            client,
            { inline: overrides.content, uploadId: contentUploadId },
            { inline: "content", file: "contentFile", upload: "contentUploadId" },
          );
          if (!resolved.ok) return formatResult(resolved.error);
          body.contentOverrides.push({ ...item, overrides: { ...overrides, content: resolved.value } });
        }
      }
      const result = await client.post("/preview", body);
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
