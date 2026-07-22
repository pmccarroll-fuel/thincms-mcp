import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerIntegrationTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_get_integration",
    "Get the site's email platform integration configuration.",
    {},
    async () => {
      const result = await client.get("/integrations");
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_create_integration",
    "Configure a new email platform integration (one per site). Platform: activecampaign, kit, mailchimp, gohighlevel.",
    {
      platform: z.string().describe("Platform identifier (e.g. 'activecampaign')"),
      name: z.string().describe("User-facing label (e.g. 'My ActiveCampaign')"),
      config: z.record(z.any()).describe("Platform-specific config. ActiveCampaign: { apiUrl, apiKey, listId, fromEmail?, fromName?, addressId? }. GoHighLevel: { apiKey (Private Integration Token), locationId, listId? (a Workflow ID enrolled on submission) } — note GoHighLevel has no lists and email campaigns are managed inside GoHighLevel, not via ThinCMS campaigns."),
    },
    async (params) => {
      const result = await client.post("/integrations", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_integration",
    "Update the email platform integration config.",
    {
      id: z.string().describe("Integration ID"),
      name: z.string().optional().describe("Updated name"),
      config: z.record(z.any()).optional().describe("Updated config"),
      enabled: z.boolean().optional().describe("Enable/disable"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/integrations/${id}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_test_integration",
    "Test the email platform connection.",
    {
      id: z.string().describe("Integration ID"),
    },
    async (params) => {
      const result = await client.post(`/integrations/${params.id}/test`, {});
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_sync_integration",
    "Bulk sync all subscribers to the email platform. Creates tags for lead magnets and pushes all subscribers.",
    {
      id: z.string().describe("Integration ID"),
    },
    async (params) => {
      const result = await client.post(`/integrations/${params.id}/sync`, {});
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_list_integration_tags",
    "List all tags from the connected email platform.",
    {
      id: z.string().describe("Integration ID"),
    },
    async (params) => {
      const result = await client.get(`/integrations/${params.id}/tags`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_list_integration_lists",
    "List all mailing lists from the connected email platform.",
    {
      id: z.string().describe("Integration ID"),
    },
    async (params) => {
      const result = await client.get(`/integrations/${params.id}/lists`);
      return formatResult(result);
    }
  );
}
