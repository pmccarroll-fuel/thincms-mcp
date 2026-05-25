import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

const socialLinkSchema = z.object({
  platform: z.enum([
    "linkedin", "twitter", "youtube", "facebook", "instagram",
    "tiktok", "github", "email", "website", "custom",
  ]).describe("Social platform identifier"),
  url: z.string().describe("Profile URL or email address (for email platform)"),
  label: z.string().optional().describe("Override tooltip/aria-label text"),
  iconUrl: z.string().optional().describe("Custom icon URL (overrides built-in SVG icon)"),
});

export function registerSocialLinksTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_get_social_links",
    "Get the site's social media links. These render in the footer via the {{social:links}} template tag.",
    {},
    async () => {
      const result = await client.get("/social-links");
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_social_links",
    "Replace the site's social media links (max 20). Each link needs a platform and URL. Supported platforms: linkedin, twitter, youtube, facebook, instagram, tiktok, github, email, website, custom. Use {{social:links}} in the page frame template to render them.",
    {
      socialLinks: z.array(socialLinkSchema).max(20).describe("Social media links array (full replacement)"),
    },
    async (params) => {
      const result = await client.put("/social-links", params);
      return formatResult(result);
    }
  );
}
