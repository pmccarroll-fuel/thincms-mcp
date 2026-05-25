import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerLeadMagnetTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_lead_magnets",
    "List all lead magnets for the site.",
    {},
    async () => {
      const result = await client.get("/lead-magnets");
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_get_lead_magnet",
    "Get a single lead magnet by ID.",
    {
      id: z.string().describe("Lead magnet ID"),
    },
    async (params) => {
      const result = await client.get(`/lead-magnets/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_create_lead_magnet",
    "Create a new lead magnet. A lead magnet is a downloadable resource offered in exchange for a form submission (e.g., newsletter signup).",
    {
      title: z.string().describe("Lead magnet title (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from title if omitted)"),
      description: z.string().optional().describe("Description of the lead magnet"),
      formSlug: z.string().optional().describe("Form slug to associate with this lead magnet"),
      mediaId: z.string().optional().describe("Media ID of the downloadable file"),
      thumbnailUrl: z.string().optional().describe("Thumbnail image URL"),
      ctaText: z.string().optional().describe("CTA button text shown on the resources page (default: 'Get this resource'). Examples: 'Join the webinar', 'Take the survey', 'Download the guide'."),
      landingUrl: z.string().optional().describe("Custom landing URL override. When set, resource cards link here instead of /resources/:slug. Use for standalone pages (e.g., '/webinar')."),
      enabled: z.boolean().optional().describe("Enable/disable lead magnet (default: true)"),
      sortOrder: z.number().optional().describe("Sort order for listing"),
    },
    async (params) => {
      const result = await client.post("/lead-magnets", params);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_lead_magnet",
    "Update an existing lead magnet. Supports partial updates.",
    {
      id: z.string().describe("Lead magnet ID (required)"),
      title: z.string().optional().describe("Lead magnet title"),
      slug: z.string().optional().describe("URL slug"),
      description: z.string().optional().describe("Description"),
      formSlug: z.string().optional().describe("Form slug"),
      mediaId: z.string().optional().describe("Media ID of the downloadable file"),
      thumbnailUrl: z.string().optional().describe("Thumbnail image URL"),
      ctaText: z.string().optional().describe("CTA button text shown on the resources page (e.g., 'Join the webinar', 'Take the survey')"),
      landingUrl: z.string().optional().describe("Custom landing URL override. When set, resource cards link here instead of /resources/:slug."),
      enabled: z.boolean().optional().describe("Enable/disable lead magnet"),
      sortOrder: z.number().optional().describe("Sort order"),
    },
    async (params) => {
      const { id, ...data } = params;
      const result = await client.put(`/lead-magnets/${id}`, data);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_delete_lead_magnet",
    "Delete a lead magnet by ID.",
    {
      id: z.string().describe("Lead magnet ID to delete"),
    },
    async (params) => {
      const result = await client.delete(`/lead-magnets/${params.id}`);
      return formatResult(result);
    }
  );
}
