import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";
import { scheduledForSchema } from "../validation.js";

export function registerCampaignTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
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

  siteAwareTool(server, client, 
    "thincms_create_campaign",
    "Create a campaign record in ThinCMS. This stores the email content; it does NOT push to the connected mail platform (e.g. ActiveCampaign) or deliver to recipients. Use thincms_send_campaign as the second step.",
    {
      name: z.string().describe("Campaign name"),
      subject: z.string().describe("Email subject line"),
      htmlContent: z.string().describe("Email HTML body"),
      listId: z.string().optional().describe("Override default list ID"),
      tagFilter: z.string().optional().describe("Only send to contacts with this tag"),
      scheduledFor: scheduledForSchema.optional().describe(
        'When the campaign should be delivered. Pass "immediate" to push to the mail platform now, or an ISO 8601 timestamp at least 60 minutes in the future to schedule. Omitting this is currently allowed (legacy fallback) but DEPRECATED — Phase 3 will require it.'
      ),
      scheduledAt: z.string().optional().describe("DEPRECATED — use scheduledFor. ISO 8601 timestamp."),
    },
    async (params) => {
      const result = await client.post("/campaigns", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_campaign",
    "Get a campaign by ID.",
    { id: z.string().describe("Campaign ID") },
    async (params) => {
      const result = await client.get(`/campaigns/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_campaign",
    "Update a draft or scheduled campaign.",
    {
      id: z.string().describe("Campaign ID"),
      name: z.string().optional(),
      subject: z.string().optional(),
      htmlContent: z.string().optional(),
      listId: z.string().optional(),
      tagFilter: z.string().optional(),
      scheduledFor: scheduledForSchema.optional().describe(
        'Override the schedule: "immediate" or an ISO 8601 timestamp at least 60 minutes in the future.'
      ),
      scheduledAt: z.string().optional().describe("DEPRECATED — use scheduledFor. ISO 8601 timestamp, or null to clear."),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/campaigns/${id}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_campaign",
    "Delete a campaign.",
    { id: z.string().describe("Campaign ID") },
    async (params) => {
      const result = await client.delete(`/campaigns/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_send_campaign",
    'Push the campaign to the connected mail platform (e.g. ActiveCampaign) and request delivery. If scheduledFor is "immediate" (or the legacy scheduledAt is empty), the platform begins sending right away. If scheduledFor is a future timestamp (or scheduledAt is set), the platform queues it for that time. Returns success when the platform accepts the queue request — actual recipient delivery is asynchronous and reported via thincms_campaign_stats. Optionally pass scheduledFor here to override the stored schedule in the same call. WARNING — the platform locks the schedule at first send. To reschedule a campaign you have already sent, delete it and recreate it; a /send with a changed schedule against an already-queued campaign returns 409.',
    {
      id: z.string().describe("Campaign ID"),
      scheduledFor: scheduledForSchema.optional().describe(
        'Optional override of the stored schedule. "immediate" or an ISO 8601 timestamp at least 60 minutes in the future.'
      ),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.post(`/campaigns/${id}/send`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_campaign_stats",
    "Get campaign performance statistics (sent, opens, clicks, unsubscribes).",
    { id: z.string().describe("Campaign ID") },
    async (params) => {
      const result = await client.get(`/campaigns/${params.id}/stats`);
      return formatResult(result);
    }
  );
}
