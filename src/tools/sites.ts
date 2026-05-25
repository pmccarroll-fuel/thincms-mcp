import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerSiteTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_sites",
    "List all configured ThinCMS sites with preview URLs and status (preview/live). Shows which site is currently active.",
    {},
    async () => {
      const sites = client.getSites();
      const active = client.getActiveSite();

      // Fetch settings for each site to get previewSlug, previewUrl, siteStatus
      const enriched = await Promise.all(
        sites.map(async (s) => {
          const prev = client.getActiveSite();
          client.switchSite(s.name);
          const result = await client.get("/settings");
          // Restore previous active site
          client.switchSite(prev.name);

          const settings = result.ok ? result.data?.settings : null;
          const marker = s.siteId === active.siteId ? " (active)" : "";
          const status = settings?.siteStatus || "unknown";
          const previewSlug = settings?.previewSlug || null;
          const previewUrl = settings?.previewUrl || null;

          let line = `- ${s.name}${marker} [${s.siteId}] — status: ${status}`;
          if (previewSlug) {
            line += `\n  preview: ${previewUrl}`;
          }
          if (settings?.domain) {
            line += `\n  domain: ${settings.domain}`;
          }
          return line;
        })
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Configured sites:\n${enriched.join("\n")}\n\nActive: ${active.name}`,
          },
        ],
      };
    }
  );

  server.tool(
    "thincms_switch_site",
    "Switch the active ThinCMS site. All subsequent API calls will use this site's credentials.",
    {
      name: z.string().describe("The name of the site to switch to (case-insensitive)"),
    },
    async ({ name }) => {
      const sites = client.getSites();
      if (sites.length <= 1) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Only one site is configured. Nothing to switch to.",
            },
          ],
          isError: true,
        };
      }

      const result = client.switchSite(name);
      if (!result) {
        const available = sites.map((s) => s.name).join(", ");
        return {
          content: [
            {
              type: "text" as const,
              text: `Site "${name}" not found. Available sites: ${available}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Switched to "${result.name}" [${result.siteId}]. All API calls will now target this site.`,
          },
        ],
      };
    }
  );

  server.tool(
    "thincms_go_live",
    "Take a site live by provisioning SSL for the production domain and transitioning from 'preview' to 'live' status. Requires the production domain's DNS to be pointed to the server first. This calls the go-live endpoint which provisions Nginx config + SSL certificate.",
    {
      siteId: z.string().describe("The site ID to take live"),
    },
    async ({ siteId }) => {
      const result = await client.post(`/sites/${siteId}/go-live`, {});
      return formatResult(result);
    }
  );
}
