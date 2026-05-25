import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerSettingsTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_get_settings",
    "Get site settings: name, tagline, description, domain, logo URL, favicon URL, footer HTML, and widget configuration. Read-only via API key.",
    {},
    async () => {
      const result = await client.get("/settings");
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_settings",
    "Update site settings. Supports partial updates — only provided fields are changed. Sensitive fields (SMTP, Stripe keys, API keys, billing) remain admin-only.",
    {
      tagline: z.string().optional().describe("Short site tagline (e.g. shown under the site name in headers/OG tags)."),
      description: z.string().optional().describe("Site description used for meta description, OG tags, and structured data."),
      logoUrl: z.string().optional().describe("Path or absolute URL of the site logo (used by {{site:logo}} and Organization JSON-LD)."),
      faviconUrl: z.string().optional().describe("Path or absolute URL of the site favicon."),
      googleVerification: z.string().optional().describe("Google Search Console verification token (rendered as a meta tag)."),
      memberFormSlug: z.string().optional().describe("Form slug used for membership/subscriber signup. Set to empty string to disable membership signup."),
      business: z.object({
        type: z.string().optional().describe("Schema.org @type — e.g. 'LocalBusiness', 'Restaurant', 'Store', 'MedicalBusiness', 'AnimalShelter', 'ProfessionalService', 'LegalService'. Defaults to 'LocalBusiness' when emission is enabled but type is unset."),
        address: z.object({
          street: z.string().optional(),
          locality: z.string().optional(),
          region: z.string().optional(),
          postcode: z.string().optional(),
          country: z.string().optional().describe("ISO country code or full name."),
        }).nullable().optional().describe("Postal address. Pass null to clear."),
        geo: z.object({
          latitude: z.number(),
          longitude: z.number(),
        }).nullable().optional().describe("Geographic coordinates. Pass null to clear."),
        openingHours: z.array(z.object({
          dayOfWeek: z.array(z.enum(["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"])).describe("Days this entry covers."),
          opens: z.string().describe("HH:MM 24-hour format."),
          closes: z.string().describe("HH:MM 24-hour format."),
        })).optional().describe("Opening hours. Group consecutive days with the same hours into one entry. Pass [] to clear."),
        phone: z.string().optional().describe("Contact phone number, E.164 preferred (e.g. '+64 4 123 4567')."),
        email: z.string().optional().describe("Public contact email."),
        priceRange: z.string().optional().describe("Free text or '$' / '$$' / '$$$' / '$$$$'."),
        areaServed: z.array(z.string()).optional().describe("List of cities, regions, or countries served."),
        emit: z.boolean().optional().describe("Whether to emit LocalBusiness JSON-LD on the homepage. Defaults to false. Once you have populated the fields, set to true to publish the schema."),
      }).optional().describe("LocalBusiness / structured data. Used to auto-emit Schema.org JSON-LD on the homepage. Partial-update — only provided sub-fields change."),
    },
    async (params) => {
      const result = await client.put("/settings", params);
      return formatResult(result);
    }
  );
}
