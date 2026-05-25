import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerRedirectTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_list_redirects",
    "List all URL redirects. Optionally filter by enabled status.",
    {
      enabled: z.boolean().optional().describe("Filter by enabled status"),
    },
    async (params) => {
      const query = params.enabled !== undefined ? `?enabled=${params.enabled}` : "";
      const result = await client.get(`/redirects${query}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_redirect",
    "Get a single redirect by ID.",
    {
      id: z.string().describe("Redirect ID (required)"),
    },
    async (params) => {
      const result = await client.get(`/redirects/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_create_redirect",
    "Create a URL redirect. Source path must start with /. Use /* suffix for wildcard matching.",
    {
      sourcePath: z.string().describe("Source path, e.g. '/old-page' or '/blog/*' (required)"),
      targetUrl: z.string().describe("Target URL — relative path or absolute URL (required)"),
      statusCode: z.number().int().optional().describe("301 (permanent) or 302 (temporary). Default: 301"),
      enabled: z.boolean().optional().describe("Enable/disable the redirect (default: true)"),
      note: z.string().optional().describe("Admin note explaining this redirect"),
    },
    async (params) => {
      const result = await client.post("/redirects", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_redirect",
    "Update an existing redirect. Only provided fields are changed.",
    {
      id: z.string().describe("Redirect ID (required)"),
      sourcePath: z.string().optional().describe("New source path"),
      targetUrl: z.string().optional().describe("New target URL"),
      statusCode: z.number().int().optional().describe("301 or 302"),
      enabled: z.boolean().optional().describe("Enable/disable"),
      note: z.string().optional().describe("Admin note"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/redirects/${id}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_redirect",
    "Delete a redirect by ID.",
    {
      id: z.string().describe("Redirect ID (required)"),
    },
    async (params) => {
      const result = await client.delete(`/redirects/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_import_redirects",
    "Bulk import redirects from a JSON array. Existing redirects with the same sourcePath are updated (upsert).",
    {
      redirects: z.array(z.object({
        sourcePath: z.string().describe("Source path starting with /"),
        targetUrl: z.string().describe("Target URL"),
        statusCode: z.number().int().optional().describe("301 or 302"),
        enabled: z.boolean().optional().describe("Enable/disable"),
        note: z.string().optional().describe("Admin note"),
      })).describe("Array of redirect objects to import"),
    },
    async (params) => {
      const result = await client.post("/redirects/import", params);
      return formatResult(result);
    }
  );
}
