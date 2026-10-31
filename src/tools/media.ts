import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerMediaTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_list_media",
    "List uploaded media files with pagination. Returns file metadata including paths, dimensions, and alt text.",
    {
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().optional().describe("Items per page (default: 30)"),
      visibility: z.enum(["public", "private"]).optional().describe("Filter by visibility"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.page) queryParams.page = String(params.page);
      if (params.limit) queryParams.limit = String(params.limit);
      if (params.visibility) queryParams.visibility = params.visibility;
      const result = await client.get("/media", queryParams);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_media",
    "Get a single media item by ID with full metadata. The response includes a `variants` field with optimized WebP versions (thumbnail 400px, medium 800px, large 1200px) when available.",
    {
      id: z.string().describe("Media ID"),
    },
    async (params) => {
      const result = await client.get(`/media/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_upload_media",
    "Upload an image or file to the media library. Provide exactly one source: filePath (local file, stdio server only), uploadId (staged upload from thincms_prepare_upload — use this for local files on the hosted server), url (download from URL), or base64 (encoded content with filename; small files only). For images, optimized WebP variants (thumbnail 400px, medium 800px, large 1200px) are automatically generated and returned in the `variants` field.",
    {
      filePath: z.string().optional().describe("Absolute path to a local file (local stdio server only; not available on the hosted server)"),
      url: z.string().optional().describe("URL to download and upload"),
      base64: z.string().optional().describe("Base64-encoded file content (small files only — the bytes pass through the model)"),
      uploadId: z.string().optional().describe("ID of a staged upload from thincms_prepare_upload, after PUTting the file to its uploadUrl. The way to upload local files on the hosted server; the response includes the file's sha256. Single use."),
      filename: z.string().optional().describe("Filename (required for base64, optional otherwise)"),
      altText: z.string().optional().describe("Alt text for accessibility"),
      caption: z.string().optional().describe("Image caption"),
      visibility: z.enum(["public", "private"]).optional().describe("Visibility (default: public)"),
    },
    async (params) => {
      const sources = [params.filePath, params.url, params.base64, params.uploadId].filter(Boolean);
      if (sources.length !== 1) {
        return {
          content: [{ type: "text" as const, text: "Error: provide exactly one of filePath, url, base64, or uploadId" }],
          isError: true,
        };
      }

      const fields: Record<string, string | undefined> = {};
      if (params.altText) fields.altText = params.altText;
      if (params.caption) fields.caption = params.caption;
      if (params.visibility) fields.visibility = params.visibility;

      const result = await client.uploadFile("/media", {
        filePath: params.filePath,
        url: params.url,
        base64: params.base64,
        uploadId: params.uploadId,
        filename: params.filename,
        fields,
      });
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_media",
    "Update media metadata (alt text, caption, visibility). Does not change the file itself.",
    {
      id: z.string().describe("Media ID (required)"),
      altText: z.string().optional().describe("Alt text for accessibility"),
      caption: z.string().optional().describe("Image caption"),
      visibility: z.enum(["public", "private"]).optional().describe("Visibility"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/media/${id}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_media",
    "Delete a media item and remove the file from disk.",
    {
      id: z.string().describe("Media ID"),
    },
    async (params) => {
      const result = await client.delete(`/media/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_generate_media_variants",
    "Generate optimized WebP image variants for all images in the media library that don't have them yet. Creates thumbnail (400px), medium (800px), and large (1200px) WebP versions. Admin-only.",
    {},
    async () => {
      const result = await client.post("/media/generate-variants", {});
      return formatResult(result);
    }
  );
}
