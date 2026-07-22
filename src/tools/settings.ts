import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerSettingsTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_get_settings",
    "Get site settings: name, tagline, description, domain, logo URL, favicon URL, footer HTML, and widget configuration. Read-only via API key.",
    {},
    async () => {
      const result = await client.get("/settings");
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_settings",
    "Update site settings. Supports partial updates — only provided fields are changed. Sensitive fields (SMTP, Stripe keys, API keys, billing) remain admin-only.",
    {
      tagline: z.string().optional().describe("Short site tagline (e.g. shown under the site name in headers/OG tags)."),
      description: z.string().optional().describe("Site description used for meta description, OG tags, and structured data."),
      logoUrl: z.string().optional().describe("Path or absolute URL of the site logo (used by {{site:logo}} and Organization JSON-LD)."),
      faviconUrl: z.string().optional().describe("Path or absolute URL of the site favicon."),
      googleVerification: z.string().optional().describe("Google Search Console verification token (rendered as a meta tag)."),
      bingVerification: z.string().optional().describe("Bing Webmaster Tools verification token (rendered as <meta name=\"msvalidate.01\">)."),
      googleTagId: z.string().optional().describe("Google tag ID for analytics — gtag.js (G-/AW-/GT-) or GTM container (GTM-). The correct snippet is injected into <head> automatically. Set to empty string to clear."),
      ogImageUrl: z.string().optional().describe("Site-wide default Open Graph image URL. Used as the OG image when a page or post doesn't set its own ogImageUrl. Per-page values override this fallback."),
      memberFormSlug: z.string().optional().describe("Form slug used for membership/subscriber signup. Set to empty string to disable membership signup."),
      aiBrief: z.string().optional().describe("Customer-authored 'AI brief' — voice/positioning/about content rendered in the auto-generated /llms.txt under an 'About' heading. Use this for narrative content that doesn't fit the structured LocalBusiness fields. Set to empty string to clear."),
      emitLlmsTxt: z.boolean().optional().describe("Whether to auto-generate /llms.txt for this site (default true). When false, /llms.txt returns 404."),
      robotsAdditions: z.string().optional().describe("Free-text rules appended to the auto-generated /robots.txt. Use to opt specific user-agents in or out (e.g. 'User-agent: GPTBot\\nDisallow: /' to block OpenAI's training crawler). Set to empty string to clear."),
      locale: z.string().optional().describe("ISO locale code (e.g. 'en-NZ', 'en-US', 'en-GB', 'fr-FR', 'de-DE'). Drives date/time/number formatting on the public site. Empty defaults to en-US at render time."),
      timezone: z.string().optional().describe("IANA timezone (e.g. 'Pacific/Auckland', 'Europe/London', 'America/New_York'). Used for the timeZone property on LocalBusiness OpeningHoursSpecification and any future timezone-sensitive rendering. Empty defaults to Etc/UTC."),
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
        additionalSameAs: z.array(z.string()).optional().describe("Authoritative entity URLs to add to the LocalBusiness `sameAs` array — Google Business Profile listing, Wikidata entry, Apple Maps card, OpenStreetMap node, etc. These are appended to (and de-duped against) the URLs derived from social links. Use this for entity-disambiguation links that don't fit the social-links taxonomy."),
        emit: z.boolean().optional().describe("Whether to emit LocalBusiness JSON-LD on the homepage. Defaults to false. Once you have populated the fields, set to true to publish the schema."),
      }).optional().describe("LocalBusiness / structured data. Used to auto-emit Schema.org JSON-LD on the homepage. Partial-update — only provided sub-fields change."),
    },
    async (params) => {
      const result = await client.put("/settings", params);
      return formatResult(result);
    }
  );
}
