import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool, resolveContentInput, uploadIdField, LOCAL_ONLY } from "../helpers.js";

export function registerLessonTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_create_lesson",
    "Create a new lesson within a module. Content is raw HTML. Lessons are auto-ordered within their module. For large content (>10KB), use contentFile (local) or contentUploadId (hosted; see thincms_prepare_upload) instead of content.",
    {
      moduleId: z.string().describe("Module ID (required)"),
      title: z.string().describe("Lesson title (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from title if omitted)"),
      content: z.string().optional().describe("HTML content of the lesson"),
      contentFile: z.string().optional().describe("Local file path containing HTML content — use instead of content for large lessons" + LOCAL_ONLY),
      contentUploadId: uploadIdField("the HTML content"),
      videoUrl: z.string().optional().describe("Video embed URL (YouTube, Vimeo, etc.)"),
      videoDuration: z.string().optional().describe("Video duration (e.g., '10:30')"),
      recordingDate: z.string().optional().describe("ISO date when the live session was held (for community recordings, distinct from createdAt)"),
      duration: z.number().int().optional().describe("Recording duration in seconds (e.g., 2700 for 45 minutes)"),
      isFree: z.boolean().optional().describe("Make this a free preview lesson (default: false)"),
      isUnlocked: z.boolean().optional().describe("Manually unlock this lesson regardless of drip settings"),
      dripDate: z.string().optional().describe("ISO date when this lesson becomes available (for scheduled drip mode)"),
    },
    async (params) => {
      const { contentFile, contentUploadId, ...body } = params;
      const resolved = await resolveContentInput(client, { inline: (body as any).content, file: contentFile, uploadId: contentUploadId }, { inline: "content", file: "contentFile", upload: "contentUploadId" });
      if (!resolved.ok) return formatResult(resolved.error);
      (body as any).content = resolved.value;
      const result = await client.post("/lessons", body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_lesson",
    "Get a single lesson by ID, including its attachments.",
    {
      id: z.string().describe("Lesson ID"),
    },
    async (params) => {
      const result = await client.get(`/lessons/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_lesson",
    "Update an existing lesson. Only provided fields are changed (partial update). For large content (>10KB), use contentFile (local) or contentUploadId (hosted).",
    {
      id: z.string().describe("Lesson ID (required)"),
      title: z.string().optional().describe("Lesson title"),
      slug: z.string().optional().describe("URL slug"),
      content: z.string().optional().describe("HTML content"),
      contentFile: z.string().optional().describe("Local file path containing HTML content" + LOCAL_ONLY),
      contentUploadId: uploadIdField("the HTML content"),
      videoUrl: z.string().optional().describe("Video embed URL"),
      videoDuration: z.string().optional().describe("Video duration"),
      recordingDate: z.string().optional().describe("ISO date when the live session was held"),
      duration: z.number().int().optional().describe("Recording duration in seconds"),
      isFree: z.boolean().optional().describe("Free preview lesson"),
      isUnlocked: z.boolean().optional().describe("Manually unlock this lesson"),
      dripDate: z.string().optional().describe("ISO date for scheduled drip"),
    },
    async (params) => {
      const { id, contentFile, contentUploadId, ...body } = params;
      const resolved = await resolveContentInput(client, { inline: (body as any).content, file: contentFile, uploadId: contentUploadId }, { inline: "content", file: "contentFile", upload: "contentUploadId" });
      if (!resolved.ok) return formatResult(resolved.error);
      (body as any).content = resolved.value;
      const result = await client.put(`/lessons/${id}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_lesson",
    "Delete a lesson and its attachments.",
    {
      id: z.string().describe("Lesson ID"),
    },
    async (params) => {
      const result = await client.delete(`/lessons/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_upload_lesson_attachment",
    "Upload a file attachment to a lesson. Provide a local file path (stdio server only), a staged uploadId (from thincms_prepare_upload; use on the hosted server), a URL to download from, or base64-encoded content.",
    {
      lessonId: z.string().describe("Lesson ID (required)"),
      filePath: z.string().optional().describe("Local file path to upload (local stdio server only; not available on the hosted server)"),
      url: z.string().optional().describe("URL to download and attach"),
      base64: z.string().optional().describe("Base64-encoded file content (small files only — the bytes pass through the model)"),
      uploadId: z.string().optional().describe("ID of a staged upload from thincms_prepare_upload, after PUTting the file to its uploadUrl. The way to upload local files on the hosted server; the response includes the file's sha256. Single use."),
      filename: z.string().optional().describe("Filename (required for base64, optional otherwise)"),
    },
    async (params) => {
      const result = await client.uploadFile(`/lessons/${params.lessonId}/attachments`, {
        filePath: params.filePath,
        url: params.url,
        base64: params.base64,
        uploadId: params.uploadId,
        filename: params.filename,
      });
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_lesson_attachment",
    "Delete a file attachment from a lesson.",
    {
      lessonId: z.string().describe("Lesson ID (required)"),
      attachmentId: z.string().describe("Attachment ID (required)"),
    },
    async (params) => {
      const result = await client.delete(`/lessons/${params.lessonId}/attachments/${params.attachmentId}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_lesson_attachment_url",
    "Get the download URL for a lesson attachment. Returns the URL path — append to your base URL to download.",
    {
      lessonId: z.string().describe("Lesson ID (required)"),
      attachmentId: z.string().describe("Attachment ID (required)"),
    },
    async (params) => {
      const url = `/api/v1/lessons/${params.lessonId}/attachments/${params.attachmentId}/download`;
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ downloadUrl: url }, null, 2) }],
      };
    }
  );
}
