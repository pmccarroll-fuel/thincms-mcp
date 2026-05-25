import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

const fieldsArraySchema = z.array(z.record(z.any())).describe(
  "Ordered array of field definitions. Each field is an object with at minimum { fieldId, type, label }. v1 field types: short_text, long_text, number, rating, select, multi_select, date, prompt_display, markdown_display. Input fields may include `prefillFrom: { courseSlug, workbookSlug, fieldId }` for cross-workbook references.",
);

async function resolveFields(
  fields: unknown,
  fieldsFile: string | undefined,
): Promise<{ ok: true; fields: any[] } | { ok: false; error: string }> {
  if (fieldsFile) {
    try {
      const raw = await readFile(fieldsFile, "utf-8");
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return { ok: false, error: "fieldsFile must contain a JSON array" };
      }
      return { ok: true, fields: parsed };
    } catch (err: any) {
      return { ok: false, error: `Failed to read fieldsFile: ${err.message}` };
    }
  }
  if (Array.isArray(fields)) {
    return { ok: true, fields };
  }
  return { ok: false, error: "Either `fields` (array) or `fieldsFile` (path to JSON array) is required" };
}

export function registerWorkbookTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(
    server,
    client,
    "thincms_create_workbook",
    "Create a workbook inside a module. Workbooks are fillable forms that live alongside lessons and quizzes — use thincms_reorder_module_items to position them. The `fields` array defines the form spec. For large specs (>10KB), use `fieldsFile` instead.",
    {
      moduleId: z.string().describe("Module ID (required)"),
      title: z.string().describe("Workbook title (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from title if omitted)"),
      description: z.string().optional().describe("HTML content shown above the form"),
      introContent: z.string().optional().describe("Optional additional HTML intro shown after the description"),
      fields: fieldsArraySchema.optional(),
      fieldsFile: z.string().optional().describe("Local file path containing a JSON array of field definitions — use for large workbook specs"),
      requiredForCompletion: z.boolean().optional().describe("Whether marking the workbook complete is required for module completion (default: true)"),
      allowExportBeforeComplete: z.boolean().optional().describe("Whether learners can export before marking complete (default: true)"),
      isFree: z.boolean().optional().describe("Make this workbook a free preview (default: false)"),
      isUnlocked: z.boolean().optional().describe("Manually unlock regardless of drip settings"),
      dripDate: z.string().optional().describe("ISO date when this workbook becomes available (scheduled drip mode)"),
    },
    async (params) => {
      const { fieldsFile, fields, ...rest } = params;
      const resolved = await resolveFields(fields, fieldsFile);
      if (!resolved.ok) {
        return formatResult({ ok: false, status: 0, data: { error: resolved.error } });
      }
      const result = await client.post("/workbooks", { ...rest, fields: resolved.fields });
      return formatResult(result);
    },
  );

  siteAwareTool(
    server,
    client,
    "thincms_get_workbook",
    "Get a workbook by ID. Returns the workbook with its full field spec (already JSON-parsed).",
    {
      id: z.string().describe("Workbook ID"),
    },
    async (params) => {
      const result = await client.get(`/workbooks/${params.id}`);
      return formatResult(result);
    },
  );

  siteAwareTool(
    server,
    client,
    "thincms_update_workbook",
    "Update a workbook (partial — only provided fields change). If `fields` is provided and differs from the current spec, the workbook's version is incremented and any removed-field values in existing responses are archived (not deleted).",
    {
      id: z.string().describe("Workbook ID (required)"),
      title: z.string().optional().describe("Workbook title"),
      slug: z.string().optional().describe("URL slug"),
      description: z.string().optional().describe("HTML content shown above the form"),
      introContent: z.string().optional().describe("Optional additional HTML intro"),
      fields: fieldsArraySchema.optional(),
      fieldsFile: z.string().optional().describe("Local file path containing a JSON array of field definitions"),
      requiredForCompletion: z.boolean().optional(),
      allowExportBeforeComplete: z.boolean().optional(),
      sortOrder: z.number().int().optional().describe("Position within the module (shared with lessons and quizzes)"),
      isFree: z.boolean().optional(),
      isUnlocked: z.boolean().optional(),
      dripDate: z.string().optional(),
    },
    async (params) => {
      const { id, fieldsFile, fields, ...rest } = params;
      const body: Record<string, any> = { ...rest };
      if (fieldsFile || fields !== undefined) {
        const resolved = await resolveFields(fields, fieldsFile);
        if (!resolved.ok) {
          return formatResult({ ok: false, status: 0, data: { error: resolved.error } });
        }
        body.fields = resolved.fields;
      }
      const result = await client.put(`/workbooks/${id}`, body);
      return formatResult(result);
    },
  );

  siteAwareTool(
    server,
    client,
    "thincms_delete_workbook",
    "Delete a workbook and all its learner responses. This is destructive — there is no soft delete.",
    {
      id: z.string().describe("Workbook ID"),
    },
    async (params) => {
      const result = await client.delete(`/workbooks/${params.id}`);
      return formatResult(result);
    },
  );

  siteAwareTool(
    server,
    client,
    "thincms_list_workbooks",
    "List workbooks across the site, optionally filtered by course or module. Each result includes module info and a response count.",
    {
      courseId: z.string().optional().describe("Filter by course ID"),
      moduleId: z.string().optional().describe("Filter by module ID"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.courseId) queryParams.courseId = params.courseId;
      if (params.moduleId) queryParams.moduleId = params.moduleId;
      const result = await client.get("/workbooks", queryParams);
      return formatResult(result);
    },
  );

  // --- Exports ---

  async function saveBytesTo(outputPath: string, bytes: Uint8Array): Promise<string> {
    const abs = isAbsolute(outputPath) ? outputPath : resolve(process.cwd(), outputPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
    return abs;
  }

  siteAwareTool(
    server,
    client,
    "thincms_export_workbook_response",
    "Export a single learner's workbook response as PDF or Markdown. Pass outputPath to write the file to disk (required for PDF; recommended for Markdown). Without outputPath, Markdown is returned inline.",
    {
      workbookId: z.string().describe("Workbook ID (required)"),
      userId: z.string().describe("Learner user ID (required)"),
      format: z.enum(["pdf", "markdown"]).describe("Output format"),
      outputPath: z.string().optional().describe("Local file path to write the export to. Required for PDF."),
    },
    async (params) => {
      if (params.format === "pdf" && !params.outputPath) {
        return formatResult({
          ok: false,
          status: 0,
          data: { error: "outputPath is required for PDF exports — PDFs are binary and cannot be returned inline." },
        });
      }
      const raw = await client.getRaw(
        `/workbooks/${params.workbookId}/responses/${params.userId}/export`,
        { format: params.format },
      );
      if (!raw.ok) return formatResult(raw);
      if (params.outputPath) {
        const saved = await saveBytesTo(params.outputPath, raw.bytes);
        return formatResult({
          ok: true,
          status: 200,
          data: { savedPath: saved, bytes: raw.bytes.length, contentType: raw.contentType },
        });
      }
      const text = new TextDecoder().decode(raw.bytes);
      return formatResult({ ok: true, status: 200, data: text });
    },
  );

  siteAwareTool(
    server,
    client,
    "thincms_export_course_portfolio",
    "Export a learner's full course portfolio (every workbook in module order) as PDF or Markdown. Pass outputPath for PDF (required) or to save the Markdown to disk.",
    {
      courseId: z.string().describe("Course ID (required)"),
      userId: z.string().describe("Learner user ID (required)"),
      format: z.enum(["pdf", "markdown"]).describe("Output format"),
      outputPath: z.string().optional().describe("Local file path to write the export to. Required for PDF."),
    },
    async (params) => {
      if (params.format === "pdf" && !params.outputPath) {
        return formatResult({
          ok: false,
          status: 0,
          data: { error: "outputPath is required for PDF exports — PDFs are binary and cannot be returned inline." },
        });
      }
      const raw = await client.getRaw(
        `/courses/${params.courseId}/portfolio/${params.userId}/export`,
        { format: params.format },
      );
      if (!raw.ok) return formatResult(raw);
      if (params.outputPath) {
        const saved = await saveBytesTo(params.outputPath, raw.bytes);
        return formatResult({
          ok: true,
          status: 200,
          data: { savedPath: saved, bytes: raw.bytes.length, contentType: raw.contentType },
        });
      }
      const text = new TextDecoder().decode(raw.bytes);
      return formatResult({ ok: true, status: 200, data: text });
    },
  );

  siteAwareTool(
    server,
    client,
    "thincms_export_workbook_responses_csv",
    "Export every learner response for a workbook as CSV (admin). Pass outputPath to save to disk; otherwise the CSV body is returned inline.",
    {
      workbookId: z.string().describe("Workbook ID (required)"),
      outputPath: z.string().optional().describe("Local file path to write the CSV to"),
    },
    async (params) => {
      const raw = await client.getRaw(`/workbooks/${params.workbookId}/responses/export`, { format: "csv" });
      if (!raw.ok) return formatResult(raw);
      if (params.outputPath) {
        const saved = await saveBytesTo(params.outputPath, raw.bytes);
        return formatResult({
          ok: true,
          status: 200,
          data: { savedPath: saved, bytes: raw.bytes.length },
        });
      }
      const text = new TextDecoder().decode(raw.bytes);
      return formatResult({ ok: true, status: 200, data: text });
    },
  );
}
