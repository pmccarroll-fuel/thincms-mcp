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
      description: z.string().optional().describe("Tag description (displayed on tag archive page, used in meta description)"),
    },
    async (params) => {
      const result = await client.post("/tags", params);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_get_tag",
    "Get a single tag by ID, including associated posts.",
    {
      id: z.string().describe("Tag ID"),
    },
    async (params) => {
      const result = await client.get(`/tags/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_tag",
    "Update a tag's name, slug, or description.",
    {
      id: z.string().describe("Tag ID (required)"),
      name: z.string().optional().describe("Tag name"),
      slug: z.string().optional().describe("URL slug"),
      description: z.string().optional().describe("Tag description (displayed on tag archive page)"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/tags/${id}`, body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_delete_tag",
    "Delete a tag by ID. Removes the tag from all posts.",
    {
      id: z.string().describe("Tag ID"),
    },
    async (params) => {
      const result = await client.delete(`/tags/${params.id}`);
      return formatResult(result);
    }
  );
}
