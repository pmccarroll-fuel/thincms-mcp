import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, formatText } from "../helpers.js";

export function registerSiteTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_sites",
    "List all configured ThinCMS sites with preview URLs and status (preview/live). Shows which site is currently active.",
    {},
    async () => {
      const sites = client.getSites();
      const originalActive = client.getActiveSite();

      // Sequential — switchSite mutates shared client state, so parallel
      // iterations would race and could leave the client on the wrong site
      // (which then drifts the marker on subsequent calls). The latency
      // cost of N sequential GETs is negligible for the typical N (1–10).
      const lines: Array<{ line: string; isActive: boolean }> = [];
      try {
        for (const s of sites) {
          client.switchSite(s.name);
          const result = await client.get("/settings");

          const settings = result.ok ? result.data?.settings : null;
          const isActive = s.siteId === originalActive.siteId;
          const marker = isActive ? "▸ ACTIVE" : "  ";
          const status = settings?.siteStatus || "unknown";
          const previewUrl = settings?.previewUrl || null;

          let line = `${marker}  ${s.name} [${s.siteId}] — status: ${status}`;
          if (settings?.domain) line += `\n          domain: ${settings.domain}`;
          if (previewUrl) line += `\n          preview: ${previewUrl}`;
          lines.push({ line, isActive });
        }
      } finally {
        // Always restore the original active site, even if a fetch threw.
        client.switchSite(originalActive.name);
      }

      lines.sort((a, b) => (a.isActive ? -1 : b.isActive ? 1 : 0));

      return formatText(
        `Configured sites (active site listed first):\n${lines.map(l => l.line).join("\n")}\n\n` +
        `Tip: every tool response is prefixed with the active site name. Use thincms_switch_site to change tenants.`
      );
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
        return formatText("Only one site is configured. Nothing to switch to.", true);
      }

      const result = client.switchSite(name);
      if (!result) {
        const available = sites.map((s) => s.name).join(", ");
        return formatText(`Site "${name}" not found. Available sites: ${available}`, true);
      }

      return formatText(`Switched to "${result.name}" [${result.siteId}]. All API calls will now target this site.`);
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
