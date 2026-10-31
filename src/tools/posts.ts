import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, stripContentFromList, summarizeContentResponse, siteAwareTool, resolveContentInput, uploadIdField, LOCAL_ONLY, checkExpectedHash, metadataOnly, EXPECTED_SHA_FIELD, METADATA_ONLY_FIELD, AS_DOWNLOAD_FIELD, downloadLinks } from "../helpers.js";
import { scheduledForSchema } from "../validation.js";

export function registerPostTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_list_posts",
    "List blog posts with optional filters. Returns posts without content by default (use includeContent=true for full HTML). Supports pagination.",
    {
      status: z.enum(["draft", "published", "archived"]).optional().describe("Filter by status"),
      category: z.string().optional().describe("Filter by category slug"),
      tag: z.string().optional().describe("Filter by tag name or slug"),
      authorId: z.string().optional().describe("Filter by author ID"),
      featured: z.boolean().optional().describe("Filter featured posts only"),
      series: z.string().optional().describe("Filter by series name"),
      publishedFrom: z.string().optional().describe("ISO date: posts published after this date"),
      publishedTo: z.string().optional().describe("ISO date: posts published before this date"),
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().max(100).optional().describe("Items per page (default: 20)"),
      includeContent: z.boolean().optional().describe("Include full HTML content in results (default: false)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.status) queryParams.status = params.status;
      if (params.category) queryParams.category = params.category;
      if (params.tag) queryParams.tag = params.tag;
      if (params.authorId) queryParams.authorId = params.authorId;
      if (params.featured !== undefined) queryParams.featured = String(params.featured);
      if (params.series) queryParams.series = params.series;
      if (params.publishedFrom) queryParams.publishedFrom = params.publishedFrom;
      if (params.publishedTo) queryParams.publishedTo = params.publishedTo;
      if (params.page) queryParams.page = String(params.page);
      if (params.limit) queryParams.limit = String(params.limit);

      const result = await client.get("/posts", queryParams);
      if (result.ok && result.data?.posts && !params.includeContent) {
        result.data.posts = stripContentFromList(result.data.posts);
      }
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_post",
    "Get a single blog post by ID, including full HTML content, author, categories, and tags. Pass metadataOnly=true to get bytes/sha256 of content and membersContent instead of the HTML. Pass asDownload=true for single-use download links to the HTML (content, and membersContent when set).",
    {
      id: z.string().describe("Post ID"),
      metadataOnly: METADATA_ONLY_FIELD,
      asDownload: AS_DOWNLOAD_FIELD,
    },
    async (params) => {
      const result = await client.get(`/posts/${params.id}`);
      if (result.ok && params.asDownload) {
        const slug = result.data.slug || params.id;
        const files = [{ field: "content", filename: `${slug}.html`, contentType: "text/html", content: result.data.content ?? "" }];
        if (result.data.membersContent) {
          files.push({ field: "membersContent", filename: `${slug}.members.html`, contentType: "text/html", content: result.data.membersContent });
        }
        return downloadLinks(client, files);
      }
      if (result.ok && params.metadataOnly) result.data = metadataOnly(result.data, ["content", "membersContent"]);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_create_post",
    'Create a blog post. Content should be raw HTML. Tags are auto-created if they don\'t exist. For large content (>10KB), use contentFile (local) or contentUploadId (hosted; see thincms_prepare_upload) instead of content. Posts with status="published" and a publishedAt in the past appear on the public site immediately; a future publishedAt is auto-scheduling — they appear when the timestamp passes (no worker required, the public site filters by date). Posts with status="draft" never appear publicly regardless of dates. Use scheduledFor="immediate" to publish now, or scheduledFor=<ISO timestamp at least 60 min in the future> to schedule.',
    {
      title: z.string().describe("Post title (required)"),
      content: z.string().optional().describe("HTML content of the post"),
      contentFile: z.string().optional().describe("Local file path containing HTML content — use this instead of content for large posts (>10KB). The file is read and sent as content." + LOCAL_ONLY),
      contentUploadId: uploadIdField("the HTML content"),
      excerpt: z.string().optional().describe("Short summary/excerpt"),
      slug: z.string().optional().describe("URL slug (auto-generated from title if omitted)"),
      authorId: z.string().optional().describe("Author ID"),
      status: z.enum(["draft", "published", "archived"]).optional().describe("Post status (default: draft)"),
      scheduledFor: scheduledForSchema.optional().describe(
        'When the post should become public. Pass "immediate" to publish now, or an ISO 8601 timestamp at least 60 minutes in the future to schedule. Required at status="published" — Phase 3 will reject omission. Posts with status="draft" ignore this field.'
      ),
      publishedAt: z.string().optional().describe("DEPRECATED — use scheduledFor. ISO date for publication date."),
      scheduledAt: z.string().optional().describe("DEPRECATED — use scheduledFor. Legacy field, no longer affects visibility."),
      featured: z.boolean().optional().describe("Mark as featured post"),
      pinnedUntil: z.string().optional().describe("ISO date: pin post until this date"),
      series: z.string().optional().describe("Series name for multi-part content"),
      seriesOrder: z.number().int().optional().describe("Order within series"),
      categoryIds: z.array(z.string()).optional().describe("Array of category IDs"),
      tags: z.array(z.string()).optional().describe("Array of tag names (auto-created if new)"),
      metaTitle: z.string().optional().describe("SEO meta title"),
      metaDescription: z.string().optional().describe("SEO meta description"),
      ogImageUrl: z.string().optional().describe("Open Graph image URL"),
      canonicalUrl: z.string().optional().describe("Canonical URL"),
      noIndex: z.boolean().optional().describe("Exclude this post from search engine indexing (default: false)"),
      jsonLd: z.string().optional().describe("Custom JSON-LD (Schema.org) injected verbatim into the post <head>. Pass valid JSON as a string. Use for HowTo, Recipe, Event, etc. (Article + BreadcrumbList are auto-emitted.) Set to empty string to clear."),
      gatedFormSlug: z.string().optional().describe("Form slug to gate this post behind. Visitors must submit the form to see full content. Set to empty string to remove gating."),
      gatePreview: z.string().optional().describe("Custom HTML teaser shown before the gate. If omitted, the excerpt or first 2 paragraphs are used."),
      membersContent: z.string().optional().describe("HTML content visible only to authenticated members/subscribers. Shown after the main content for logged-in members."),
    },
    async (params) => {
      const { contentFile, contentUploadId, ...body } = params;
      const resolved = await resolveContentInput(client, { inline: (body as any).content, file: contentFile, uploadId: contentUploadId }, { inline: "content", file: "contentFile", upload: "contentUploadId" });
      if (!resolved.ok) return formatResult(resolved.error);
      (body as any).content = resolved.value;
      const result = await client.post("/posts", body);
      if (result.ok) result.data = summarizeContentResponse(result.data);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_post",
    "Update an existing blog post. Only provided fields are changed (partial update). Content should be raw HTML. For large content (>10KB), use contentFile (local) or contentUploadId (hosted; see thincms_prepare_upload) instead of content. Changing slug auto-creates a 301 redirect from the old URL.",
    {
      id: z.string().describe("Post ID (required)"),
      title: z.string().optional().describe("Post title"),
      content: z.string().optional().describe("HTML content"),
      contentFile: z.string().optional().describe("Local file path containing HTML content — use this instead of content for large posts (>10KB)." + LOCAL_ONLY),
      contentUploadId: uploadIdField("the HTML content"),
      expectedSha256: EXPECTED_SHA_FIELD("content"),
      excerpt: z.string().optional().describe("Short summary/excerpt"),
      slug: z.string().optional().describe("URL slug (changing slug auto-creates a 301 redirect)"),
      authorId: z.string().optional().describe("Author ID"),
      status: z.enum(["draft", "published", "archived"]).optional().describe("Post status"),
      scheduledFor: scheduledForSchema.optional().describe(
        'Override visibility timing. "immediate" or an ISO 8601 timestamp at least 60 minutes in the future.'
      ),
      publishedAt: z.string().optional().describe("DEPRECATED — use scheduledFor. ISO date for publication date."),
      scheduledAt: z.string().optional().describe("DEPRECATED — use scheduledFor. Legacy field."),
      featured: z.boolean().optional().describe("Mark as featured"),
      pinnedUntil: z.string().optional().describe("ISO date: pin until this date"),
      series: z.string().optional().describe("Series name"),
      seriesOrder: z.number().int().optional().describe("Order within series"),
      categoryIds: z.array(z.string()).optional().describe("Array of category IDs (full replacement)"),
      tags: z.array(z.string()).optional().describe("Array of tag names (full replacement)"),
      metaTitle: z.string().optional().describe("SEO meta title"),
      metaDescription: z.string().optional().describe("SEO meta description"),
      ogImageUrl: z.string().optional().describe("Open Graph image URL"),
      canonicalUrl: z.string().optional().describe("Canonical URL"),
      noIndex: z.boolean().optional().describe("Exclude from search engine indexing"),
      jsonLd: z.string().optional().describe("Custom JSON-LD (Schema.org) injected verbatim into the post <head>. Pass valid JSON as a string. Set to empty string to clear."),
      gatedFormSlug: z.string().optional().describe("Form slug to gate this post behind. Set to empty string to remove gating."),
      gatePreview: z.string().optional().describe("Custom HTML teaser shown before the gate."),
      membersContent: z.string().optional().describe("HTML content visible only to authenticated members/subscribers."),
    },
    async (params) => {
      const { id, contentFile, contentUploadId, expectedSha256, ...body } = params;
      if (expectedSha256) {
        const current = await client.get(`/posts/${id}`);
        if (!current.ok) return formatResult(current);
        const conflict = checkExpectedHash(current.data?.content, expectedSha256, "content");
        if (conflict) return formatResult(conflict);
      }
      const resolved = await resolveContentInput(client, { inline: (body as any).content, file: contentFile, uploadId: contentUploadId }, { inline: "content", file: "contentFile", upload: "contentUploadId" });
      if (!resolved.ok) return formatResult(resolved.error);
      (body as any).content = resolved.value;
      const result = await client.put(`/posts/${id}`, body);
      if (result.ok) result.data = summarizeContentResponse(result.data);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_post",
    "Permanently delete a blog post by ID.",
    {
      id: z.string().describe("Post ID"),
    },
    async (params) => {
      const result = await client.delete(`/posts/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_post_preview_url",
    "Get a signed preview URL for a blog post. Works for any status (draft, scheduled, future-dated, published). The URL is valid for 72 hours and requires no authentication to view. Use this after creating or updating a post to verify how it looks on the live site.",
    {
      id: z.string().describe("Post ID"),
    },
    async (params) => {
      const result = await client.get(`/posts/${params.id}/preview-url`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_bulk_create_posts",
    "Create up to 100 blog posts in a single request. Each post follows the same schema as thincms_create_post. Validation errors are reported per-item without failing the batch.",
    {
      posts: z.array(z.object({
        title: z.string().describe("Post title (required)"),
        content: z.string().optional(),
        excerpt: z.string().optional(),
        slug: z.string().optional(),
        authorId: z.string().optional(),
        status: z.enum(["draft", "published", "archived"]).optional(),
        scheduledFor: scheduledForSchema.optional().describe(
          'When the post should become public. "immediate" or ISO 8601 timestamp at least 60 minutes in the future.'
        ),
        publishedAt: z.string().optional().describe("DEPRECATED — use scheduledFor."),
        featured: z.boolean().optional(),
        categoryIds: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        metaTitle: z.string().optional(),
        metaDescription: z.string().optional(),
        ogImageUrl: z.string().optional(),
        gatedFormSlug: z.string().optional(),
      })).min(1).max(100).describe("Array of post objects to create"),
    },
    async (params) => {
      const result = await client.post("/posts/bulk", { posts: params.posts });
      return formatResult(result);
    }
  );
}
