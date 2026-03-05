import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerMediaTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
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

  server.tool(
    "thincms_get_media",
    "Get a single media item by ID with full metadata.",
    {
      id: z.string().describe("Media ID"),
    },
    async (params) => {
      const result = await client.get(`/media/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_upload_media",
    "Upload an image or file to the media library. Provide exactly one source: filePath (local file), url (download from URL), or base64 (encoded content with filename).",
    {
      filePath: z.string().optional().describe("Absolute path to a local file"),
      url: z.string().optional().describe("URL to download and upload"),
      base64: z.string().optional().describe("Base64-encoded file content"),
      filename: z.string().optional().describe("Filename (required for base64, optional otherwise)"),
      altText: z.string().optional().describe("Alt text for accessibility"),
      caption: z.string().optional().describe("Image caption"),
      visibility: z.enum(["public", "private"]).optional().describe("Visibility (default: public)"),
    },
    async (params) => {
      const sources = [params.filePath, params.url, params.base64].filter(Boolean);
      if (sources.length !== 1) {
        return {
          content: [{ type: "text" as const, text: "Error: provide exactly one of filePath, url, or base64" }],
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
        filename: params.filename,
        fields,
      });
      return formatResult(result);
    }
  );

  server.tool(
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

  server.tool(
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
}
