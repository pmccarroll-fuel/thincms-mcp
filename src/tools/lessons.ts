import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool, resolveContentInput, uploadIdField, LOCAL_ONLY } from "../helpers.js";

// A lesson page renders: contentBefore (HTML) → video (videoEmbed) → contentAfter (HTML).
// The REST API stores contentAfter as `description`.
const VIDEO_PLATFORMS = ["none", "youtube", "vimeo", "loom", "other"] as const;

function lessonContentFields() {
  const opt = <T extends z.ZodTypeAny>(s: T) => s.optional();
  return {
    contentBefore: opt(z.string()).describe("HTML shown before the video"),
    contentBeforeFile: opt(z.string()).describe("Local file path with the contentBefore HTML" + LOCAL_ONLY),
    contentBeforeUploadId: uploadIdField("the contentBefore HTML"),
    contentAfter: opt(z.string()).describe("HTML shown after the video (the main lesson body when there is no video). Stored as the lesson's `description`."),
    contentAfterFile: opt(z.string()).describe("Local file path with the contentAfter HTML" + LOCAL_ONLY),
    contentAfterUploadId: uploadIdField("the contentAfter HTML"),
    videoEmbed: opt(z.string()).describe("Video embed URL (e.g. https://player.vimeo.com/video/123, https://www.youtube.com/embed/abc) or full <iframe> embed code"),
    videoPlatform: opt(z.enum(VIDEO_PLATFORMS)).describe("Video platform: none, youtube, vimeo, loom or other"),
    recordingDate: opt(z.string()).describe("ISO date when the live session was held (community recordings)"),
    duration: opt(z.number().int()).describe("Video/recording length in whole seconds (e.g. 2700 for 45 minutes)"),
    isFree: opt(z.boolean()).describe("Free preview lesson"),
    isUnlocked: opt(z.boolean()).describe("Manually unlock this lesson regardless of drip settings"),
    dripDate: opt(z.string()).describe("ISO date when this lesson becomes available (scheduled drip mode)"),
    requiredForCompletion: opt(z.boolean()).describe("Counts toward course completion (default true). Set false for reference pages (start pages, reading, bonus): learners see no Mark complete and progress leaves the lesson out."),
  };
}

type LessonParams = Record<string, any>;

/** Resolve the inline/file/upload variants and map to the REST field names. */
export async function buildLessonBody(client: ThinCMSClient, params: LessonParams) {
  const {
    contentBefore, contentBeforeFile, contentBeforeUploadId,
    contentAfter, contentAfterFile, contentAfterUploadId,
    ...rest
  } = params;
  const before = await resolveContentInput(client, { inline: contentBefore, file: contentBeforeFile, uploadId: contentBeforeUploadId },
    { inline: "contentBefore", file: "contentBeforeFile", upload: "contentBeforeUploadId" });
  if (!before.ok) return before;
  const after = await resolveContentInput(client, { inline: contentAfter, file: contentAfterFile, uploadId: contentAfterUploadId },
    { inline: "contentAfter", file: "contentAfterFile", upload: "contentAfterUploadId" });
  if (!after.ok) return after;
  const body: Record<string, unknown> = { ...rest };
  if (before.value !== undefined) body.contentBefore = before.value;
  if (after.value !== undefined) body.description = after.value;
  return { ok: true as const, body };
}

export function registerLessonTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_create_lesson",
    "Create a lesson in a module. A lesson page shows contentBefore (HTML), then the video (videoEmbed), then contentAfter (HTML); use contentAfter alone for a text-only lesson. New lessons go to the end of the module (after any quizzes and workbooks). For large HTML use the *File (local) or *UploadId (hosted; see thincms_prepare_upload) variants.",
    {
      moduleId: z.string().describe("Module ID (required)"),
      title: z.string().describe("Lesson title (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from title if omitted)"),
      ...lessonContentFields(),
    },
    async (params) => {
      const built = await buildLessonBody(client, params);
      if (!built.ok) return formatResult(built.error);
      const result = await client.post("/lessons", built.body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_lesson",
    "Get a single lesson by ID, including its attachments. Content fields: contentBefore, videoEmbed, videoPlatform, description (= contentAfter).",
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
    "Update a lesson. Only the fields you pass change. Content fields: contentBefore, videoEmbed + videoPlatform, contentAfter (each HTML field also has *File and *UploadId variants). Pass an empty string to clear a content field.",
    {
      id: z.string().describe("Lesson ID (required)"),
      title: z.string().optional().describe("Lesson title"),
      slug: z.string().optional().describe("URL slug"),
      moduleId: z.string().optional().describe("Move the lesson to another module"),
      ...lessonContentFields(),
    },
    async (params) => {
      const { id, ...rest } = params;
      const built = await buildLessonBody(client, rest);
      if (!built.ok) return formatResult(built.error);
      const result = await client.put(`/lessons/${id}`, built.body);
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
