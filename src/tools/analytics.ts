import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerAnalyticsTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_analytics_summary",
    "Get analytics summary: total views, unique visitors, top page, views today. Period: 7d, 30d, or 90d.",
    {
      period: z.enum(["7d", "30d", "90d"]).optional().describe("Time period (default: 30d)"),
    },
    async (params) => {
      const query = params.period ? `?period=${params.period}` : "";
      const result = await client.get(`/analytics/summary${query}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_analytics_top_pages",
    "Get top pages by views for a given period.",
    {
      period: z.enum(["7d", "30d", "90d"]).optional().describe("Time period (default: 30d)"),
      limit: z.number().int().optional().describe("Max pages to return (default: 10, max: 100)"),
    },
    async (params) => {
      const queryParts: string[] = [];
      if (params.period) queryParts.push(`period=${params.period}`);
      if (params.limit) queryParts.push(`limit=${params.limit}`);
      const query = queryParts.length ? `?${queryParts.join("&")}` : "";
      const result = await client.get(`/analytics/top-pages${query}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_analytics_referrers",
    "Get top referrer domains for a given period.",
    {
      period: z.enum(["7d", "30d", "90d"]).optional().describe("Time period (default: 30d)"),
      limit: z.number().int().optional().describe("Max referrers to return (default: 10, max: 100)"),
    },
    async (params) => {
      const queryParts: string[] = [];
      if (params.period) queryParts.push(`period=${params.period}`);
      if (params.limit) queryParts.push(`limit=${params.limit}`);
      const query = queryParts.length ? `?${queryParts.join("&")}` : "";
      const result = await client.get(`/analytics/referrers${query}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_analytics_trend",
    "Get daily views and visitors trend for a given period.",
    {
      period: z.enum(["7d", "30d", "90d"]).optional().describe("Time period (default: 30d)"),
    },
    async (params) => {
      const query = params.period ? `?period=${params.period}` : "";
      const result = await client.get(`/analytics/trend${query}`);
      return formatResult(result);
    }
  );
}
