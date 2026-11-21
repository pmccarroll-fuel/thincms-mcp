import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool, resolveContentInput, uploadIdField, LOCAL_ONLY } from "../helpers.js";

const formFieldSchema = z.object({
  name: z.string().describe("Field name (used as key in submissions)"),
  label: z.string().describe("Display label"),
  type: z.enum(["text", "email", "textarea", "select", "checkbox", "hidden"]).describe("Field type"),
  required: z.boolean().optional().describe("Whether field is required"),
  placeholder: z.string().optional().describe("Placeholder text"),
  options: z.array(z.string()).optional().describe("Options for select fields"),
});

const fieldMappingSchema = z.object({
  formField: z.string().describe("Key in the submitted data (for HTML forms, the key the form's script sends, e.g. 'firmName')"),
  type: z.enum(["field", "tag"]).describe("'field' sets a contact field; 'tag' adds a tag built from the value"),
  acField: z.string().optional().describe("For type 'field': 'contact.firstName', 'contact.lastName' or 'contact.companyName' for built-in contact fields, otherwise the platform custom field name (e.g. 'Firm Size'). Missing custom fields are created on save where the platform allows it."),
  prefix: z.string().optional().describe("For type 'tag': text before the lowercased value (default '<formField>:')"),
});

/** Email platform (GoHighLevel / ActiveCampaign) sync settings shared by create and update. */
const integrationParams = {
  integrationTags: z.array(z.string()).optional().describe("Extra tags applied to the contact on every submission (form:<slug> is always added)"),
  integrationListId: z.string().optional().describe("Override the default list (ActiveCampaign) or Workflow (GoHighLevel) for this form; empty string clears it"),
  integrationFieldMappings: z.array(fieldMappingSchema).nullable().optional().describe("Send submitted values to the contact as built-in fields, custom fields or tags. Replaces the whole list; [] or null clears it."),
  integrationNote: z.boolean().optional().describe("Add each submission as a note on the contact listing every submitted value"),
  doubleOptIn: z.boolean().optional().describe("Require email confirmation: new subscribers get a confirmation link + 6-digit code, and are added to the list/sequence and unlock members content only after confirming. Recommended for the newsletter form; needs site SMTP."),
};

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
    "Create a new form or survey. Use renderMode 'fields' for standard forms (with field definitions) or 'html' for custom HTML surveys served at /s/:slug. Use preset 'contact' or 'newsletter' for pre-configured field sets. For large HTML content (>10KB), use htmlContentFile (local) or htmlContentUploadId (hosted; see thincms_prepare_upload) instead of htmlContent to pass a local file path.",
    {
      name: z.string().describe("Form name (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from name if omitted)"),
      description: z.string().optional().describe("Form description"),
      preset: z.enum(["contact", "newsletter"]).optional().describe("Pre-configured field set"),
      renderMode: z.enum(["fields", "html"]).optional().describe("'fields' for standard forms, 'html' for custom survey HTML (default: fields)"),
      fields: z.array(formFieldSchema).optional().describe("Field definitions (for renderMode 'fields')"),
      htmlContent: z.string().optional().describe("Custom HTML content (for renderMode 'html', served at /s/:slug)"),
      htmlContentFile: z.string().optional().describe("Local file path containing HTML content — use this instead of htmlContent for large surveys (>10KB). The file is read and sent as htmlContent." + LOCAL_ONLY),
      htmlContentUploadId: uploadIdField("the HTML content"),
      webhookUrl: z.string().optional().describe("URL to receive submission payloads via POST"),
      webhookUrlTest: z.string().optional().describe("Test webhook URL (auto-deactivates after one delivery)"),
      webhookTestMode: z.boolean().optional().describe("Enable test mode for webhook"),
      successMessage: z.string().optional().describe("Message shown after successful submission"),
      enabled: z.boolean().optional().describe("Enable/disable form (default: true)"),
      ...integrationParams,
    },
    async (params) => {
      const { htmlContentFile, htmlContentUploadId, ...body } = params;
      const resolved = await resolveContentInput(client, { inline: (body as any).htmlContent, file: htmlContentFile, uploadId: htmlContentUploadId }, { inline: "htmlContent", file: "htmlContentFile", upload: "htmlContentUploadId" });
      if (!resolved.ok) return formatResult(resolved.error);
      (body as any).htmlContent = resolved.value;
      const result = await client.post("/forms", body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_form",
    "Update an existing form or survey. Only provided fields are changed. For large HTML content (>10KB), use htmlContentFile (local) or htmlContentUploadId (hosted; see thincms_prepare_upload) instead of htmlContent.",
    {
      id: z.string().describe("Form ID (required)"),
      name: z.string().optional().describe("Form name"),
      slug: z.string().optional().describe("URL slug"),
      description: z.string().optional().describe("Form description"),
      renderMode: z.enum(["fields", "html"]).optional().describe("Render mode"),
      fields: z.array(formFieldSchema).optional().describe("Field definitions"),
      htmlContent: z.string().optional().describe("Custom HTML content"),
      htmlContentFile: z.string().optional().describe("Local file path containing HTML content — use this instead of htmlContent for large surveys (>10KB)." + LOCAL_ONLY),
      htmlContentUploadId: uploadIdField("the HTML content"),
      webhookUrl: z.string().optional().describe("Webhook URL"),
      webhookUrlTest: z.string().optional().describe("Test webhook URL"),
      webhookTestMode: z.boolean().optional().describe("Enable test mode"),
      successMessage: z.string().optional().describe("Success message"),
      enabled: z.boolean().optional().describe("Enable/disable form"),
      ...integrationParams,
    },
    async (params) => {
      const { id, htmlContentFile, htmlContentUploadId, ...body } = params;
      const resolved = await resolveContentInput(client, { inline: (body as any).htmlContent, file: htmlContentFile, uploadId: htmlContentUploadId }, { inline: "htmlContent", file: "htmlContentFile", upload: "htmlContentUploadId" });
      if (!resolved.ok) return formatResult(resolved.error);
      (body as any).htmlContent = resolved.value;
      const result = await client.put(`/forms/${id}`, body);
      return formatResult(result);
    }
  );
}
