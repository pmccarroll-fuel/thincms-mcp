import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerSubscriberTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_list_subscribers",
    "List subscribers/members with optional search and pagination.",
    {
      search: z.string().optional().describe("Search by email or name"),
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().max(100).optional().describe("Items per page (default: 20)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.search) queryParams.search = params.search;
      if (params.page) queryParams.page = String(params.page);
      if (params.limit) queryParams.limit = String(params.limit);
      const result = await client.get("/subscribers", queryParams);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_export_subscribers_csv",
    "Export all subscribers as CSV data.",
    {},
    async () => {
      const result = await client.get("/subscribers", { format: "csv" });
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_subscriber",
    "Delete a subscriber by ID.",
    {
      id: z.string().describe("The subscriber ID to delete"),
    },
    async (params) => {
      const result = await client.delete(`/subscribers/${params.id}`);
      return formatResult(result);
    }
  );
}
