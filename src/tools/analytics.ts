import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

const periodSchema = z.enum(["7d", "30d", "90d"]).optional().describe("Time period (default: 30d)");
const includeAssetsSchema = z
  .boolean()
  .optional()
  .describe(
    "Include non-page requests (images under /serve-media, .json/.txt/.xml files, icons, fonts). Default false: real HTML page views only, matching the admin Analytics page."
  );

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== false && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

export function registerAnalyticsTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client,
    "thincms_analytics_summary",
    "Get analytics summary for a period: totalViews (page views only unless includeAssets), uniqueVisitors (each visitor counted once per period; visitor IDs rotate monthly, so uniqueVisitorsExact=false means the window still contains older daily IDs), visitorDays (sum of daily distinct visitors), viewsPerVisitor, viewsToday, topPage/topPageTitle, plus previous-period values and % change. A rising viewsPerVisitor with flat visitors usually means one page or a bot is generating repeat requests — follow up with thincms_analytics_top_pages and thincms_analytics_trend with path.",
    {
      period: periodSchema,
      includeAssets: includeAssetsSchema,
    },
    async (params) => {
      const result = await client.get(`/analytics/summary${buildQuery(params)}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_analytics_top_pages",
    "Get top pages by views for a period, with page/post titles and distinct visitors per page. Excludes images, data files and icons unless includeAssets is true.",
    {
      period: periodSchema,
      limit: z.number().int().optional().describe("Max pages to return (default: 10, max: 100)"),
      includeAssets: includeAssetsSchema,
    },
    async (params) => {
      const result = await client.get(`/analytics/top-pages${buildQuery(params)}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_analytics_referrers",
    "Get top external referrer sources for a period. Variants are grouped (facebook.com, m.facebook.com, l.facebook.com and the Facebook app ID → \"Facebook\"; each row lists its domains). The site's own domain is excluded and reported as `internal` (internal navigation / reloads) unless includeInternal is true. Bare-IP referrers are flagged likelyBot.",
    {
      period: periodSchema,
      limit: z.number().int().optional().describe("Max referrers to return (default: 10, max: 100)"),
      includeAssets: includeAssetsSchema,
      includeInternal: z.boolean().optional().describe("Include the site's own domain in the list (default false)"),
    },
    async (params) => {
      const result = await client.get(`/analytics/referrers${buildQuery(params)}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_analytics_trend",
    "Get daily views, distinct visitors and views-per-visitor for a period, plus any date annotations in range. Pass `path` (e.g. \"/\" or \"/grooming\") to get the series for a single page.",
    {
      period: periodSchema,
      includeAssets: includeAssetsSchema,
      path: z.string().optional().describe("Restrict the series to one tracked path"),
    },
    async (params) => {
      const result = await client.get(`/analytics/trend${buildQuery(params)}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_analytics_annotations_list",
    "List notes pinned to dates on the analytics chart (e.g. \"Grooming page launched\"). Use them to explain traffic changes.",
    {
      period: z.enum(["7d", "30d", "90d"]).optional().describe("Only annotations in this period (default: all)"),
    },
    async (params) => {
      const result = await client.get(`/analytics/annotations${buildQuery(params)}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_analytics_annotations_create",
    "Pin a note to a date on the analytics chart. Good practice after publishing a page, launching a campaign or changing the site, so later traffic changes can be read against it.",
    {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Date (YYYY-MM-DD, UTC)"),
      note: z.string().min(1).max(200).describe("Short note, up to 200 characters"),
    },
    async (params) => {
      const result = await client.post(`/analytics/annotations`, { date: params.date, note: params.note });
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_analytics_annotations_delete",
    "Delete an analytics chart annotation by ID.",
    {
      id: z.string().describe("Annotation ID"),
    },
    async (params) => {
      const result = await client.delete(`/analytics/annotations/${encodeURIComponent(params.id)}`);
      return formatResult(result);
    }
  );
}
