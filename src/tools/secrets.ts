import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerSecretTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_list_secrets",
    "List environment variable secrets. Returns key names and descriptions only — values are never returned for security.",
    {},
    async () => {
      const result = await client.get("/secrets");
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_create_secret",
    "Create a new environment variable secret. The value is stored securely and never returned in API responses.",
    {
      key: z.string().describe("Variable name, e.g. 'STRIPE_KEY' (required)"),
      value: z.string().describe("Secret value (required)"),
      description: z.string().optional().describe("Description of what this secret is for"),
    },
    async (params) => {
      const result = await client.post("/secrets", params);
      return formatResult(result);
    }
  );
}
