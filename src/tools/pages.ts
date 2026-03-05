import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerPageTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_pages",
    "List static pages with optional status filter and pagination.",
    {
      status: z.enum(["draft", "published"]).optional().describe("Filter by status"),
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().optional().describe("Items per page (default: 50)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.status) queryParams.status = params.status;
      if (params.page) queryParams.page = String(params.page);
      if (params.limit) queryParams.limit = String(params.limit);
      const result = await client.get("/pages", queryParams);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_get_page",
    "Get a single static page by ID, including full HTML content.",
    {
      id: z.string().describe("Page ID"),
    },
    async (params) => {
      const result = await client.get(`/pages/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_create_page",
    "Create a new static page. Content should be raw HTML. Use renderMode 'wrapped' for pages that use the site template, or 'standalone' for full custom HTML.",
    {
      title: z.string().describe("Page title (required)"),
      content: z.string().optional().describe("HTML content"),
      slug: z.string().optional().describe("URL slug (auto-generated from title if omitted)"),
      status: z.enum(["draft", "published"]).optional().describe("Page status (default: draft)"),
      renderMode: z.enum(["wrapped", "standalone"]).optional().describe("Render mode (default: wrapped)"),
      metaTitle: z.string().optional().describe("SEO meta title"),
      metaDescription: z.string().optional().describe("SEO meta description"),
      ogImageUrl: z.string().optional().describe("Open Graph image URL"),
      canonicalUrl: z.string().optional().describe("Canonical URL"),
      noIndex: z.boolean().optional().describe("Set true to add noindex meta tag"),
    },
    async (params) => {
      const result = await client.post("/pages", params);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_page",
    "Update an existing static page. Only provided fields are changed (partial update). Content should be raw HTML.",
    {
      id: z.string().describe("Page ID (required)"),
      title: z.string().optional().describe("Page title"),
      content: z.string().optional().describe("HTML content"),
      slug: z.string().optional().describe("URL slug"),
      status: z.enum(["draft", "published"]).optional().describe("Page status"),
      renderMode: z.enum(["wrapped", "standalone"]).optional().describe("Render mode"),
      metaTitle: z.string().optional().describe("SEO meta title"),
      metaDescription: z.string().optional().describe("SEO meta description"),
      ogImageUrl: z.string().optional().describe("Open Graph image URL"),
      canonicalUrl: z.string().optional().describe("Canonical URL"),
      noIndex: z.boolean().optional().describe("Set true to add noindex meta tag"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/pages/${id}`, body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_delete_page",
    "Permanently delete a static page by ID.",
    {
      id: z.string().describe("Page ID"),
    },
    async (params) => {
      const result = await client.delete(`/pages/${params.id}`);
      return formatResult(result);
    }
  );
}
