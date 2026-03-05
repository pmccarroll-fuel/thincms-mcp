import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

const formFieldSchema = z.object({
  name: z.string().describe("Field name (used as key in submissions)"),
  label: z.string().describe("Display label"),
  type: z.enum(["text", "email", "textarea", "select", "checkbox", "hidden"]).describe("Field type"),
  required: z.boolean().optional().describe("Whether field is required"),
  placeholder: z.string().optional().describe("Placeholder text"),
  options: z.array(z.string()).optional().describe("Options for select fields"),
});

export function registerFormTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_forms",
    "List all forms and surveys with submission counts.",
    {},
    async () => {
      const result = await client.get("/forms");
      return formatResult(result);
    }
  );

  server.tool(
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

  server.tool(
    "thincms_create_form",
    "Create a new form or survey. Use renderMode 'fields' for standard forms (with field definitions) or 'html' for custom HTML surveys served at /s/:slug. Use preset 'contact' or 'newsletter' for pre-configured field sets.",
    {
      name: z.string().describe("Form name (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from name if omitted)"),
      description: z.string().optional().describe("Form description"),
      preset: z.enum(["contact", "newsletter"]).optional().describe("Pre-configured field set"),
      renderMode: z.enum(["fields", "html"]).optional().describe("'fields' for standard forms, 'html' for custom survey HTML (default: fields)"),
      fields: z.array(formFieldSchema).optional().describe("Field definitions (for renderMode 'fields')"),
      htmlContent: z.string().optional().describe("Custom HTML content (for renderMode 'html', served at /s/:slug)"),
      webhookUrl: z.string().optional().describe("URL to receive submission payloads via POST"),
      webhookUrlTest: z.string().optional().describe("Test webhook URL (auto-deactivates after one delivery)"),
      webhookTestMode: z.boolean().optional().describe("Enable test mode for webhook"),
      successMessage: z.string().optional().describe("Message shown after successful submission"),
      enabled: z.boolean().optional().describe("Enable/disable form (default: true)"),
    },
    async (params) => {
      const result = await client.post("/forms", params);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_form",
    "Update an existing form or survey. Only provided fields are changed.",
    {
      id: z.string().describe("Form ID (required)"),
      name: z.string().optional().describe("Form name"),
      slug: z.string().optional().describe("URL slug"),
      description: z.string().optional().describe("Form description"),
      renderMode: z.enum(["fields", "html"]).optional().describe("Render mode"),
      fields: z.array(formFieldSchema).optional().describe("Field definitions"),
      htmlContent: z.string().optional().describe("Custom HTML content"),
      webhookUrl: z.string().optional().describe("Webhook URL"),
      webhookUrlTest: z.string().optional().describe("Test webhook URL"),
      webhookTestMode: z.boolean().optional().describe("Enable test mode"),
      successMessage: z.string().optional().describe("Success message"),
      enabled: z.boolean().optional().describe("Enable/disable form"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/forms/${id}`, body);
      return formatResult(result);
    }
  );
}
