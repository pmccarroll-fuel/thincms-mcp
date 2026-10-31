import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { AS_DOWNLOAD_FIELD, downloadLinks, formatResult, siteAwareTool } from "../helpers.js";

export function registerSubmissionTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_list_submissions",
    "List form submissions with pagination. Returns submission data (field values) and timestamps.",
    {
      formId: z.string().describe("Form ID (required)"),
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().optional().describe("Items per page (default: 20)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.page) queryParams.page = String(params.page);
      if (params.limit) queryParams.limit = String(params.limit);
      const result = await client.get(`/forms/${params.formId}/submissions`, queryParams);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_export_submissions_csv",
    "Export all submissions for a form as CSV data. Pass asDownload=true to get a single-use download link instead of the CSV inline.",
    {
      formId: z.string().describe("Form ID (required)"),
      asDownload: AS_DOWNLOAD_FIELD,
    },
    async (params) => {
      const result = await client.get(`/forms/${params.formId}/submissions/export`);
      if (result.ok && params.asDownload) {
        const csv = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
        return downloadLinks(client, [{ filename: `submissions-${params.formId}.csv`, contentType: "text/csv", content: csv }]);
      }
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_submission",
    "Delete a form submission by ID.",
    {
      formId: z.string().describe("Form ID (required)"),
      submissionId: z.string().describe("Submission ID to delete"),
    },
    async (params) => {
      const result = await client.delete(`/forms/${params.formId}/submissions/${params.submissionId}`);
      return formatResult(result);
    }
  );
}
