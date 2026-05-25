import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerContentBlockTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_content_blocks",
    "List all reusable content blocks for the site. Optional enabled filter. Content blocks are HTML fragments insertable via {{block:slug}} template tags in the page frame or page/post content.",
    {
      enabled: z.enum(["true", "false"]).optional().describe("Filter by enabled status"),
    },
    async (params) => {
      const query = params.enabled ? `?enabled=${params.enabled}` : "";
      const result = await client.get(`/content-blocks${query}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_get_content_block",
    "Get a single content block by ID.",
    {
      id: z.string().describe("Content block ID"),
    },
    async (params) => {
      const result = await client.get(`/content-blocks/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_create_content_block",
    "Create a new reusable content block. The content field holds raw HTML that gets inserted wherever {{block:slug}} appears in the page frame or page/post content. Edit the block once to update it everywhere.",
    {
      name: z.string().describe("Display name for the block"),
      slug: z.string().optional().describe("URL-safe slug (auto-generated from name if omitted)"),
      content: z.string().optional().describe("HTML content for the block"),
      enabled: z.boolean().optional().describe("Whether the block is active (default: true)"),
      sortOrder: z.number().optional().describe("Sort order for listing (default: 0)"),
    },
    async (params) => {
      const result = await client.post("/content-blocks", params);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_content_block",
    "Update an existing content block. Supports partial updates — only include fields you want to change.",
    {
      id: z.string().describe("Content block ID"),
      name: z.string().optional().describe("Display name"),
      slug: z.string().optional().describe("URL-safe slug"),
      content: z.string().optional().describe("HTML content"),
      enabled: z.boolean().optional().describe("Whether the block is active"),
      sortOrder: z.number().optional().describe("Sort order"),
    },
    async (params) => {
      const { id, ...data } = params;
      const result = await client.put(`/content-blocks/${id}`, data);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_delete_content_block",
    "Delete a content block. Any {{block:slug}} references in templates or content will render as empty.",
    {
      id: z.string().describe("Content block ID to delete"),
    },
    async (params) => {
      const result = await client.delete(`/content-blocks/${params.id}`);
      return formatResult(result);
    }
  );
}
