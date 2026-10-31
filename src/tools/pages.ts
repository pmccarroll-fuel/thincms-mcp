import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import {
  formatResult, summarizeContentResponse, siteAwareTool, resolveContentInput, checkExpectedHash,
  metadataOnly, uploadIdField, LOCAL_ONLY, EXPECTED_SHA_FIELD, METADATA_ONLY_FIELD,
} from "../helpers.js";

const CONTENT_NAMES = { inline: "content", file: "contentFile", upload: "contentUploadId" };

export function registerPageTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
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

  siteAwareTool(server, client, 
    "thincms_get_page",
    "Get a single static page by ID, including full HTML content. Pass metadataOnly=true to get bytes/sha256 of the content instead of the HTML.",
    {
      id: z.string().describe("Page ID"),
      metadataOnly: METADATA_ONLY_FIELD,
    },
    async (params) => {
      const result = await client.get(`/pages/${params.id}`);
      if (result.ok && params.metadataOnly) result.data = metadataOnly(result.data, ["content"]);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_create_page",
    "Create a new static page. Content should be raw HTML. Use renderMode 'wrapped' for pages that use the site template, or 'standalone' for full custom HTML. For large content (>10KB), use contentFile (local stdio server) or contentUploadId (hosted server; see thincms_prepare_upload) instead of content. The response includes the stored content's bytes and sha256.",
    {
      title: z.string().describe("Page title (required)"),
      content: z.string().optional().describe("HTML content"),
      contentFile: z.string().optional().describe("Local file path containing HTML content — use this instead of content for large pages (>10KB). The file is read and sent as content." + LOCAL_ONLY),
      contentUploadId: uploadIdField("the page HTML"),
      slug: z.string().optional().describe("URL slug (auto-generated from title if omitted)"),
      status: z.enum(["draft", "published"]).optional().describe("Page status (default: draft)"),
      renderMode: z.enum(["wrapped", "standalone"]).optional().describe("Render mode (default: wrapped)"),
      metaTitle: z.string().optional().describe("SEO meta title"),
      metaDescription: z.string().optional().describe("SEO meta description"),
      ogImageUrl: z.string().optional().describe("Open Graph image URL"),
      canonicalUrl: z.string().optional().describe("Canonical URL"),
      noIndex: z.boolean().optional().describe("Set true to add noindex meta tag"),
      jsonLd: z.string().optional().describe("Custom JSON-LD (Schema.org) injected verbatim into the page <head>. Pass valid JSON as a string. Use for Service, Event, BreadcrumbList, HowTo, Article, etc. Set to empty string to clear."),
    },
    async (params) => {
      const { contentFile, contentUploadId, ...body } = params;
      const content = await resolveContentInput(client, { inline: body.content, file: contentFile, uploadId: contentUploadId }, CONTENT_NAMES);
      if (!content.ok) return formatResult(content.error);
      body.content = content.value;
      const result = await client.post("/pages", body);
      if (result.ok) result.data = summarizeContentResponse(result.data);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_page",
    "Update an existing static page. Only provided fields are changed (partial update). Content should be raw HTML. For large content (>10KB), use contentFile (local stdio server) or contentUploadId (hosted server; see thincms_prepare_upload) instead of content. The response includes the stored content's bytes and sha256. Changing slug auto-creates a 301 redirect from the old URL.",
    {
      id: z.string().describe("Page ID (required)"),
      title: z.string().optional().describe("Page title"),
      content: z.string().optional().describe("HTML content"),
      contentFile: z.string().optional().describe("Local file path containing HTML content — use this instead of content for large pages (>10KB)." + LOCAL_ONLY),
      contentUploadId: uploadIdField("the page HTML"),
      expectedSha256: EXPECTED_SHA_FIELD("content"),
      slug: z.string().optional().describe("URL slug"),
      status: z.enum(["draft", "published"]).optional().describe("Page status"),
      renderMode: z.enum(["wrapped", "standalone"]).optional().describe("Render mode"),
      metaTitle: z.string().optional().describe("SEO meta title"),
      metaDescription: z.string().optional().describe("SEO meta description"),
      ogImageUrl: z.string().optional().describe("Open Graph image URL"),
      canonicalUrl: z.string().optional().describe("Canonical URL"),
      noIndex: z.boolean().optional().describe("Set true to add noindex meta tag"),
      jsonLd: z.string().optional().describe("Custom JSON-LD (Schema.org) injected verbatim into the page <head>. Pass valid JSON as a string. Use for Service, Event, BreadcrumbList, HowTo, Article, etc. Set to empty string to clear."),
    },
    async (params) => {
      const { id, contentFile, contentUploadId, expectedSha256, ...body } = params;
      if (expectedSha256) {
        const current = await client.get(`/pages/${id}`);
        if (!current.ok) return formatResult(current);
        const conflict = checkExpectedHash(current.data?.content, expectedSha256, "content");
        if (conflict) return formatResult(conflict);
      }
      const content = await resolveContentInput(client, { inline: body.content, file: contentFile, uploadId: contentUploadId }, CONTENT_NAMES);
      if (!content.ok) return formatResult(content.error);
      body.content = content.value;
      const result = await client.put(`/pages/${id}`, body);
      if (result.ok) result.data = summarizeContentResponse(result.data);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
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
