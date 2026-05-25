import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

const formFieldSchema = z.object({
  name: z.string().describe("Field name (used as key in submissions)"),
  label: z.string().describe("Display label"),
  type: z.enum(["text", "email", "textarea", "select", "checkbox", "hidden"]).describe("Field type"),
  required: z.boolean().optional().describe("Whether field is required"),
  placeholder: z.string().optional().describe("Placeholder text"),
  options: z.array(z.string()).optional().describe("Options for select fields"),
});

export function registerFormTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_list_forms",
    "List all forms and surveys with submission counts.",
    {},
    async () => {
      const result = await client.get("/forms");
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_form",
    "Get a single form by ID with full field definitions and configuration.",
    {
      id: z.string().describe("Form ID"),
    },
    async (params) => {
      const result = await client.get(`/forms/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_create_form",
    "Create a new form or survey. Use renderMode 'fields' for standard forms (with field definitions) or 'html' for custom HTML surveys served at /s/:slug. Use preset 'contact' or 'newsletter' for pre-configured field sets. For large HTML content (>10KB), use htmlContentFile instead of htmlContent to pass a local file path.",
    {
      name: z.string().describe("Form name (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from name if omitted)"),
      description: z.string().optional().describe("Form description"),
      preset: z.enum(["contact", "newsletter"]).optional().describe("Pre-configured field set"),
      renderMode: z.enum(["fields", "html"]).optional().describe("'fields' for standard forms, 'html' for custom survey HTML (default: fields)"),
      fields: z.array(formFieldSchema).optional().describe("Field definitions (for renderMode 'fields')"),
      htmlContent: z.string().optional().describe("Custom HTML content (for renderMode 'html', served at /s/:slug)"),
      htmlContentFile: z.string().optional().describe("Local file path containing HTML content — use this instead of htmlContent for large surveys (>10KB). The file is read and sent as htmlContent."),
      webhookUrl: z.string().optional().describe("URL to receive submission payloads via POST"),
      webhookUrlTest: z.string().optional().describe("Test webhook URL (auto-deactivates after one delivery)"),
      webhookTestMode: z.boolean().optional().describe("Enable test mode for webhook"),
      successMessage: z.string().optional().describe("Message shown after successful submission"),
      enabled: z.boolean().optional().describe("Enable/disable form (default: true)"),
    },
    async (params) => {
      const { htmlContentFile, ...body } = params;
      if (htmlContentFile) {
        try {
          body.htmlContent = await readFile(htmlContentFile, "utf-8");
        } catch (err: any) {
          return formatResult({ ok: false, status: 0, data: { error: `Failed to read file: ${err.message}` } });
        }
      }
      const result = await client.post("/forms", body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_form",
    "Update an existing form or survey. Only provided fields are changed. For large HTML content (>10KB), use htmlContentFile instead of htmlContent.",
    {
      id: z.string().describe("Form ID (required)"),
      name: z.string().optional().describe("Form name"),
      slug: z.string().optional().describe("URL slug"),
      description: z.string().optional().describe("Form description"),
      renderMode: z.enum(["fields", "html"]).optional().describe("Render mode"),
      fields: z.array(formFieldSchema).optional().describe("Field definitions"),
      htmlContent: z.string().optional().describe("Custom HTML content"),
      htmlContentFile: z.string().optional().describe("Local file path containing HTML content — use this instead of htmlContent for large surveys (>10KB)."),
      webhookUrl: z.string().optional().describe("Webhook URL"),
      webhookUrlTest: z.string().optional().describe("Test webhook URL"),
      webhookTestMode: z.boolean().optional().describe("Enable test mode"),
      successMessage: z.string().optional().describe("Success message"),
      enabled: z.boolean().optional().describe("Enable/disable form"),
    },
    async (params) => {
      const { id, htmlContentFile, ...body } = params;
      if (htmlContentFile) {
        try {
          body.htmlContent = await readFile(htmlContentFile, "utf-8");
        } catch (err: any) {
          return formatResult({ ok: false, status: 0, data: { error: `Failed to read file: ${err.message}` } });
        }
      }
      const result = await client.put(`/forms/${id}`, body);
      return formatResult(result);
    }
  );
}
