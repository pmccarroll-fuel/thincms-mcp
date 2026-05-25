import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

const targetingSchema = z.object({
  scope: z.enum(["site-wide", "specific"]).describe("'site-wide' shows on all pages; 'specific' shows only on matching paths/pages/posts"),
  paths: z.array(z.string()).optional().describe("URL path patterns with glob support (e.g., '/blog/*', '/pricing')"),
  pageIds: z.array(z.string()).optional().describe("Specific page IDs to target"),
  postIds: z.array(z.string()).optional().describe("Specific post IDs to target"),
});

const triggerConfigSchema = z.object({
  type: z.enum(["time-delay", "scroll-depth", "exit-intent", "hybrid"]).describe("Trigger type. 'hybrid' requires both time-delay AND scroll-depth to fire."),
  delaySeconds: z.number().optional().describe("Seconds before showing (for time-delay or hybrid). Best practice: 8-10 seconds."),
  scrollPercent: z.number().optional().describe("Scroll depth percentage (0-100) before showing (for scroll-depth or hybrid). Best practice: 35-50%."),
});

export function registerPopupTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_popups",
    "List all popups/CTAs for the site with their linked form names.",
    {},
    async () => {
      const result = await client.get("/popups");
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_get_popup",
    "Get a single popup by ID with full configuration.",
    {
      id: z.string().describe("Popup ID"),
    },
    async (params) => {
      const result = await client.get(`/popups/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_create_popup",
    "Create a new popup/CTA. Each popup is linked to an existing form (by formId) which handles the actual data collection. The popup provides the presentation container, trigger logic, and targeting rules. Display types: 'overlay' (centered modal), 'sticky-top'/'sticky-bottom' (fixed bars), 'slide-in' (bottom-right card). On mobile, overlay auto-downgrades to sticky-bottom to avoid Google's interstitial penalty.",
    {
      name: z.string().describe("Popup name (required)"),
      formId: z.string().describe("ID of the form to display inside the popup (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from name if omitted)"),
      displayType: z.enum(["overlay", "sticky-top", "sticky-bottom", "slide-in"]).optional().describe("Display type (default: overlay)"),
      headline: z.string().optional().describe("Headline text shown above the form"),
      bodyText: z.string().optional().describe("Body text shown between headline and form"),
      ctaButtonText: z.string().optional().describe("CTA button text shown in step 1 of the two-step popup flow (default: 'Sign up'). Examples: 'Sign up', 'Book now', 'Get started', 'Download'"),
      customCss: z.string().optional().describe("Custom CSS to override default popup styles"),
      targeting: targetingSchema.optional().describe("Page targeting rules (default: site-wide)"),
      triggerConfig: triggerConfigSchema.optional().describe("Trigger configuration (default: time-delay 8s)"),
      priority: z.number().optional().describe("Priority (higher = more important). Specific-scope always beats site-wide regardless of priority. Default: 0"),
      suppressDays: z.number().optional().describe("Days to suppress after visitor dismisses (default: 30)"),
      suppressOnConvert: z.number().optional().describe("Days to suppress after visitor submits the form (default: 180)"),
      mobileEnabled: z.boolean().optional().describe("Show on mobile devices (default: true)"),
      mobileDisplayType: z.enum(["sticky-top", "sticky-bottom", "slide-in", "overlay"]).optional().describe("Override display type on mobile (default: auto-downgrade overlay to sticky-bottom)"),
      enabled: z.boolean().optional().describe("Enable/disable popup (default: true)"),
    },
    async (params) => {
      const result = await client.post("/popups", params);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_popup",
    "Update an existing popup. Only provided fields are changed.",
    {
      id: z.string().describe("Popup ID (required)"),
      name: z.string().optional().describe("Popup name"),
      slug: z.string().optional().describe("URL slug"),
      formId: z.string().optional().describe("Form ID"),
      displayType: z.enum(["overlay", "sticky-top", "sticky-bottom", "slide-in"]).optional().describe("Display type"),
      headline: z.string().optional().describe("Headline text"),
      bodyText: z.string().optional().describe("Body text"),
      ctaButtonText: z.string().optional().describe("CTA button text for the two-step popup flow"),
      customCss: z.string().optional().describe("Custom CSS"),
      targeting: targetingSchema.optional().describe("Page targeting rules"),
      triggerConfig: triggerConfigSchema.optional().describe("Trigger configuration"),
      priority: z.number().optional().describe("Priority level"),
      suppressDays: z.number().optional().describe("Days to suppress after dismiss"),
      suppressOnConvert: z.number().optional().describe("Days to suppress after conversion"),
      mobileEnabled: z.boolean().optional().describe("Show on mobile"),
      mobileDisplayType: z.enum(["sticky-top", "sticky-bottom", "slide-in", "overlay"]).optional().describe("Mobile display override"),
      enabled: z.boolean().optional().describe("Enable/disable"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/popups/${id}`, body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_delete_popup",
    "Delete a popup by ID.",
    {
      id: z.string().describe("Popup ID"),
    },
    async (params) => {
      const result = await client.delete(`/popups/${params.id}`);
      return formatResult(result);
    }
  );
}
