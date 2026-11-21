import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

// Connecting, changing, disconnecting and bulk-syncing the email integration
// are deliberately NOT exposed here: the REST API only allows them from an
// admin session in the ThinCMS admin panel (requireAdminSession). Agents can
// read the integration, test it, and list its tags and lists/workflows.
export function registerIntegrationTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_get_integration",
    "Get the site's email platform integration configuration.",
    {},
    async () => {
      const result = await client.get("/integrations");
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_test_integration",
    "Test the email platform connection.",
    {
      id: z.string().describe("Integration ID"),
    },
    async (params) => {
      const result = await client.post(`/integrations/${params.id}/test`, {});
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_list_integration_tags",
    "List all tags from the connected email platform.",
    {
      id: z.string().describe("Integration ID"),
    },
    async (params) => {
      const result = await client.get(`/integrations/${params.id}/tags`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_list_integration_lists",
    "List all mailing lists from the connected email platform.",
    {
      id: z.string().describe("Integration ID"),
    },
    async (params) => {
      const result = await client.get(`/integrations/${params.id}/lists`);
      return formatResult(result);
    }
  );
}
