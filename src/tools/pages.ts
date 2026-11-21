import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import {
  formatResult, summarizeContentResponse, siteAwareTool, resolveContentInput, checkExpectedHash,
  metadataOnly, uploadIdField, LOCAL_ONLY, EXPECTED_SHA_FIELD, METADATA_ONLY_FIELD,
  AS_DOWNLOAD_FIELD, downloadLinks, dryRunField, DRY_RUN_REPLACE_FIELD,
} from "../helpers.js";

const CONTENT_NAMES = { inline: "content", file: "contentFile", upload: "contentUploadId" };

export function registerPageTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_list_pages",
    "List static pages with optional status filter and pagination.",
    {
      status: z.enum(["draft", "published"]).optional().describe("Filter by status"),
      visibility: z.enum(["public", "chat-only"]).optional().describe("Filter by visibility (chat-only = chat assistant knowledge pages)"),
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().optional().describe("Items per page (default: 50)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.status) queryParams.status = params.status;
      if (params.visibility) queryParams.visibility = params.visibility;
      if (params.page) queryParams.page = String(params.page);
      if (params.limit) queryParams.limit = String(params.limit);
      const result = await client.get("/pages", queryParams);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_page",
    "Get a single static page by ID, including full HTML content. Options: metadataOnly=true returns bytes/sha256 of the content instead of the HTML; asDownload=true returns a single-use download link for the HTML; sections=true lists the page's named <!-- START:/END: --> sections (for thincms_patch_page).",
    {
      id: z.string().describe("Page ID"),
      metadataOnly: METADATA_ONLY_FIELD,
      asDownload: AS_DOWNLOAD_FIELD,
      sections: z.boolean().optional().describe("List the page's named sections with their sizes instead of returning the content."),
    },
    async (params) => {
      if (params.sections) return formatResult(await client.get(`/pages/${params.id}/sections`));
      const result = await client.get(`/pages/${params.id}`);
      if (!result.ok) return formatResult(result);
      if (params.asDownload) {
        return downloadLinks(client, [
          { field: "content", filename: `${result.data.slug || params.id}.html`, contentType: "text/html", content: result.data.content ?? "" },
        ]);
      }
      if (params.metadataOnly) result.data = metadataOnly(result.data, ["content"]);
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
      visibility: z.enum(["public", "chat-only"]).optional().describe("\"chat-only\" = unlisted knowledge page for the chat assistant: never served at a URL, never in the sitemap, navigation, llms.txt or site search. Must still be status \"published\" for the assistant to use it. Visitors can see anything in it by asking the assistant, so never put confidential information there."),
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
      dryRun: DRY_RUN_REPLACE_FIELD,
      slug: z.string().optional().describe("URL slug"),
      status: z.enum(["draft", "published"]).optional().describe("Page status"),
      renderMode: z.enum(["wrapped", "standalone"]).optional().describe("Render mode"),
      metaTitle: z.string().optional().describe("SEO meta title"),
      metaDescription: z.string().optional().describe("SEO meta description"),
      ogImageUrl: z.string().optional().describe("Open Graph image URL"),
      canonicalUrl: z.string().optional().describe("Canonical URL"),
      noIndex: z.boolean().optional().describe("Set true to add noindex meta tag"),
      visibility: z.enum(["public", "chat-only"]).optional().describe("\"chat-only\" = unlisted knowledge page for the chat assistant: never served at a URL, never in the sitemap, navigation, llms.txt or site search. Must still be status \"published\" for the assistant to use it. Visitors can see anything in it by asking the assistant, so never put confidential information there."),
      jsonLd: z.string().optional().describe("Custom JSON-LD (Schema.org) injected verbatim into the page <head>. Pass valid JSON as a string. Use for Service, Event, BreadcrumbList, HowTo, Article, etc. Set to empty string to clear."),
    },
    async (params) => {
      const { id, contentFile, contentUploadId, expectedSha256, dryRun, ...body } = params;
      let current: any;
      if (expectedSha256 || dryRun) {
        const res = await client.get(`/pages/${id}`);
        if (!res.ok) return formatResult(res);
        current = res.data;
        const conflict = checkExpectedHash(current?.content, expectedSha256, "content");
        if (conflict) return formatResult(conflict);
      }
      const content = await resolveContentInput(client, { inline: body.content, file: contentFile, uploadId: contentUploadId }, CONTENT_NAMES, { peek: dryRun });
      if (!content.ok) return formatResult(content.error);
      body.content = content.value;
      if (dryRun) {
        return formatResult({
          ok: true,
          status: 200,
          data: {
            dryRun: true,
            id,
            fieldsUpdated: Object.keys(body).filter((k) => (body as any)[k] !== undefined),
            content: dryRunField(current?.content, content.value),
          },
        });
      }
      const result = await client.put(`/pages/${id}`, body);
      if (result.ok) result.data = summarizeContentResponse(result.data);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_patch_page",
    "Replace one named section of a page's HTML without resending the whole page. The page must contain <!-- START:<section> --> and <!-- END:<section> --> comments (the START comment may carry more text and span lines). Only the HTML between them is replaced; the comments are kept.\n\nSend ONLY the section body. If your input contains its own START/END markers for the same section, the body between them is extracted; markers for a different section are rejected. Use thincms_get_page with sections=true to list a page's sections, and dryRun=true to check the size change first.",
    {
      id: z.string().describe("Page ID"),
      section: z.string().describe("Section name, e.g. 'hero' for <!-- START:hero --> ... <!-- END:hero -->"),
      content: z.string().optional().describe("Replacement HTML for the section"),
      contentFile: z.string().optional().describe("Local file path containing the replacement HTML" + LOCAL_ONLY),
      contentUploadId: uploadIdField("the replacement HTML"),
      dryRun: z.boolean().optional().describe("Return the size change without writing. A staged upload used in a dry run stays usable."),
    },
    async (params) => {
      const { id, section, contentFile, contentUploadId, dryRun } = params;
      const content = await resolveContentInput(client, { inline: params.content, file: contentFile, uploadId: contentUploadId }, CONTENT_NAMES, { peek: dryRun });
      if (!content.ok) return formatResult(content.error);
      if (!content.value) {
        return formatResult({ ok: false, status: 0, data: { error: "Provide content, contentFile or contentUploadId" } });
      }
      const result = await client.patch(`/pages/${id}`, { section, content: content.value, ...(dryRun ? { dryRun: true } : {}) });
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
