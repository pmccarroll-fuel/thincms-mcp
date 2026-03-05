import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerTagTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_tags",
    "List all tags with post counts.",
    {},
    async () => {
      const result = await client.get("/tags");
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_create_tag",
    "Create a new tag. Note: tags are also auto-created when included in the tags array of a post.",
    {
      name: z.string().describe("Tag name (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from name if omitted)"),
    },
    async (params) => {
      const result = await client.post("/tags", params);
      return formatResult(result);
    }
  );
}
