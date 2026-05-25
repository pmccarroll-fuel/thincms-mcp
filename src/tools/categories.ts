import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerCategoryTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_list_categories",
    "List all categories with post counts and hierarchy information.",
    {},
    async () => {
      const result = await client.get("/categories");
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_create_category",
    "Create a new category. Optionally nest it under a parent category for hierarchy.",
    {
      name: z.string().describe("Category name (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from name if omitted)"),
      description: z.string().optional().describe("Category description"),
      parentId: z.string().optional().describe("Parent category ID for nesting"),
      sortOrder: z.number().int().optional().describe("Sort order (lower = first)"),
    },
    async (params) => {
      const result = await client.post("/categories", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_category",
    "Update an existing category. Only provided fields are changed.",
    {
      id: z.string().describe("Category ID (required)"),
      name: z.string().optional().describe("Category name"),
      slug: z.string().optional().describe("URL slug"),
      description: z.string().optional().describe("Category description"),
      parentId: z.string().optional().describe("Parent category ID"),
      sortOrder: z.number().int().optional().describe("Sort order"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/categories/${id}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_category",
    "Delete a category by ID. Posts in this category will be uncategorized.",
    {
      id: z.string().describe("Category ID"),
    },
    async (params) => {
      const result = await client.delete(`/categories/${params.id}`);
      return formatResult(result);
    }
  );
}
