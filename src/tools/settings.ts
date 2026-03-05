import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
}
