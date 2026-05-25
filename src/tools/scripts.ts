import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerScriptTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_list_scripts",
    "List all script injections (analytics, chat widgets, tracking pixels, etc.).",
    {},
    async () => {
      const result = await client.get("/scripts");
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_create_script",
    "Create a script injection for the public site. Scripts can be placed in the <head> or before </body>.",
    {
      name: z.string().describe("Script name, e.g. 'Google Analytics' (required)"),
      code: z.string().describe("Script code including <script> tags (required)"),
      placement: z.enum(["head", "body"]).optional().describe("Where to inject: 'head' or 'body' (default: head)"),
      enabled: z.boolean().optional().describe("Enable/disable the script (default: true)"),
      sortOrder: z.number().int().optional().describe("Sort order for execution priority"),
    },
    async (params) => {
      const result = await client.post("/scripts", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_script",
    "Update an existing script injection. Only provided fields are changed.",
    {
      id: z.string().describe("Script ID (required)"),
      name: z.string().optional().describe("Script name"),
      code: z.string().optional().describe("Script code including <script> tags"),
      placement: z.enum(["head", "body"]).optional().describe("Where to inject"),
      enabled: z.boolean().optional().describe("Enable/disable the script"),
      sortOrder: z.number().int().optional().describe("Sort order"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/scripts/${id}`, body);
      return formatResult(result);
    }
  );
}
