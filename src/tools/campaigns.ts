import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerCampaignTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_campaigns",
    "List email campaigns with optional status filter and pagination.",
    {
      status: z.string().optional().describe("Filter by status: draft, sending, sent"),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(100).optional(),
    },
    async (params) => {
      const q: Record<string, string> = {};
      if (params.status) q.status = params.status;
      if (params.page) q.page = String(params.page);
      if (params.limit) q.limit = String(params.limit);
      const result = await client.get("/campaigns", q);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_create_campaign",
    "Create a new email campaign (broadcast).",
    {
      name: z.string().describe("Campaign name"),
      subject: z.string().describe("Email subject line"),
      htmlContent: z.string().describe("Email HTML body"),
      listId: z.string().optional().describe("Override default list ID"),
      tagFilter: z.string().optional().describe("Only send to contacts with this tag"),
      scheduledAt: z.string().optional().describe("ISO 8601 date for scheduled send (omit for immediate)"),
    },
    async (params) => {
      const result = await client.post("/campaigns", params);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_get_campaign",
    "Get a campaign by ID.",
    { id: z.string().describe("Campaign ID") },
    async (params) => {
      const result = await client.get(`/campaigns/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_campaign",
    "Update a draft or scheduled campaign.",
    {
      id: z.string().describe("Campaign ID"),
      name: z.string().optional(),
      subject: z.string().optional(),
      htmlContent: z.string().optional(),
      listId: z.string().optional(),
      tagFilter: z.string().optional(),
      scheduledAt: z.string().optional().describe("ISO 8601 date for scheduled send, or null to clear"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/campaigns/${id}`, body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_delete_campaign",
    "Delete a campaign.",
    { id: z.string().describe("Campaign ID") },
    async (params) => {
      const result = await client.delete(`/campaigns/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_send_campaign",
    "Send or schedule a campaign via the connected email platform. If scheduledAt is set on the campaign, it will be scheduled for future delivery; otherwise sent immediately.",
    { id: z.string().describe("Campaign ID") },
    async (params) => {
      const result = await client.post(`/campaigns/${params.id}/send`, {});
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_campaign_stats",
    "Get campaign performance statistics (sent, opens, clicks, unsubscribes).",
    { id: z.string().describe("Campaign ID") },
    async (params) => {
      const result = await client.get(`/campaigns/${params.id}/stats`);
      return formatResult(result);
    }
  );
}
