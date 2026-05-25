import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerContentBlockTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
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

  siteAwareTool(server, client, 
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

  siteAwareTool(server, client,
    "thincms_create_content_block",
    "Create a new reusable content block. For type='html' (default) the `content` field holds raw HTML inserted wherever {{block:slug}} appears. For type='reviews-widget', the block renders the published Google reviews widget server-side with config options (maxReviews, displayMode, minRating, showDate, showAvatar). Edit once, updates everywhere.",
    {
      name: z.string().describe("Display name for the block"),
      slug: z.string().optional().describe("URL-safe slug (auto-generated from name if omitted)"),
      content: z.string().optional().describe("HTML content (only used for type='html')"),
      type: z.enum(["html", "reviews-widget"]).optional().describe("Block type. Default: 'html'."),
      config: z.string().optional().describe("JSON config blob for typed widgets (e.g. reviews-widget: '{\"maxReviews\":5,\"displayMode\":\"grid\"}'). Ignored for type='html'."),
      enabled: z.boolean().optional().describe("Whether the block is active (default: true)"),
      sortOrder: z.number().optional().describe("Sort order for listing (default: 0)"),
    },
    async (params) => {
      const result = await client.post("/content-blocks", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_update_content_block",
    "Update an existing content block. Supports partial updates — only include fields you want to change.",
    {
      id: z.string().describe("Content block ID"),
      name: z.string().optional().describe("Display name"),
      slug: z.string().optional().describe("URL-safe slug"),
      content: z.string().optional().describe("HTML content (type='html' blocks)"),
      type: z.enum(["html", "reviews-widget"]).optional().describe("Switch the block type. Switching to a typed widget clears the HTML content unless you pass content explicitly."),
      config: z.string().optional().describe("JSON config blob for typed widgets. Pass empty string or null to clear."),
      enabled: z.boolean().optional().describe("Whether the block is active"),
      sortOrder: z.number().optional().describe("Sort order"),
    },
    async (params) => {
      const { id, ...data } = params;
      const result = await client.put(`/content-blocks/${id}`, data);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
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
