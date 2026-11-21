import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerReleaseTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client,
    "thincms_create_release",
    "Create a release: a named bundle of proposed changes that stays private until published. Stage changes into it by passing its id as releaseId to the normal write tools (update_page, create_page, update_template, patch_css, update_navigation, content block and collection tools), or with thincms_stage_release_item. Releases are optional — without releaseId, writes go live as usual.",
    {
      name: z.string().describe('Short name, e.g. "Grooming page refresh"'),
      description: z.string().optional().describe("What the release changes and why"),
    },
    async (params) => formatResult(await client.post("/releases", params)),
  );

  siteAwareTool(server, client,
    "thincms_list_releases",
    "List releases with status (draft, scheduled, published, discarded), item count and schedule.",
    { status: z.enum(["draft", "scheduled", "published", "discarded"]).optional() },
    async (params) => formatResult(await client.get("/releases", params.status ? { status: params.status } : undefined)),
  );

  siteAwareTool(server, client,
    "thincms_get_release",
    "Get a release with its staged items. Each item shows conflict: true if the live item changed after it was staged.",
    { id: z.string().describe("Release id") },
    async (params) => formatResult(await client.get(`/releases/${params.id}`)),
  );

  siteAwareTool(server, client,
    "thincms_diff_release",
    "Per-field line diff of every staged item against the live site.",
    { id: z.string().describe("Release id") },
    async (params) => formatResult(await client.get(`/releases/${params.id}/diff`)),
  );

  siteAwareTool(server, client,
    "thincms_stage_release_item",
    "Stage a change directly into a release (low-level; the normal write tools with releaseId are usually easier). data may be partial — it is merged over the item's staged or live state and validated like a live write. For collections, data.items is the full item list. Course content: courseModule (courseId, title, description, content, sortOrder), lesson (moduleId, slug, title, contentBefore, description = content after the video, videoEmbed, videoPlatform, …), quiz (… plus questions: [{ questionText, options: string[2-5], correctIndex, explanation }] — the full list), workbook (… plus fields: the full field array). A new lesson/quiz/workbook may use a staged module's \"new:…\" key as moduleId. Learners keep seeing the live course until the release is published; preview it in the admin course preview (release picker).",
    {
      releaseId: z.string().describe("Release id"),
      entityType: z.enum(["page", "post", "template", "navigation", "contentBlock", "collection", "courseModule", "lesson", "quiz", "workbook"]),
      entityKey: z.string().optional().describe('Live item id, or a staged "new:…" key. Omit to create a new item. Not needed for template/navigation.'),
      action: z.enum(["create", "update", "delete"]).optional().describe("Default: update when entityKey is given, otherwise create"),
      data: z.record(z.any()).optional().describe("Fields to set (omit for delete)"),
      rebase: z.boolean().optional().describe("Re-base this item on the current live version: data is merged over live (not the previously staged state) and the changed-since-staging warning is cleared. Use after a publish stops because the live item changed — pass the full rebuilt content."),
    },
    async ({ releaseId, ...item }) => formatResult(await client.put(`/releases/${releaseId}/items`, item)),
  );

  siteAwareTool(server, client,
    "thincms_unstage_release_item",
    "Remove one item from a release.",
    {
      releaseId: z.string().describe("Release id"),
      entityType: z.enum(["page", "post", "template", "navigation", "contentBlock", "collection", "courseModule", "lesson", "quiz", "workbook"]),
      entityKey: z.string().optional().describe("Item key as shown by thincms_get_release (not needed for template/navigation)"),
    },
    async (params) => {
      const q = new URLSearchParams({ entityType: params.entityType, ...(params.entityKey ? { entityKey: params.entityKey } : {}) });
      return formatResult(await client.delete(`/releases/${params.releaseId}/items?${q}`));
    },
  );

  siteAwareTool(server, client,
    "thincms_get_release_preview_link",
    "Create a private preview link for a release. Anyone with the link sees the whole site with the release applied (marked noindex, with a preview banner) — share it for review. Creating a new link revokes the previous one. Links end when the release is published or discarded.",
    { id: z.string().describe("Release id") },
    async (params) => formatResult(await client.post(`/releases/${params.id}/preview-link`, {})),
  );

  siteAwareTool(server, client,
    "thincms_revoke_release_preview_link",
    "Revoke a release's preview link without creating a new one.",
    { id: z.string().describe("Release id") },
    async (params) => formatResult(await client.delete(`/releases/${params.id}/preview-link`)),
  );

  siteAwareTool(server, client,
    "thincms_publish_release",
    "Publish a release now: every staged item goes live together, and each change is recorded in version history. First publish wins: if any staged item changed on the live site after it was staged (another release published, or a direct edit), NOTHING is published and the call fails with 409. The error names each item and when and how it changed (conflicts[].message, e.g. 'Home was changed by release \"In the media\" on 10 Nov 2026'). The usual fix is to re-stage the item from the current live version (download live, reapply only this release's change, stage it with rebase: true via thincms_stage_release_item, or unstage and stage again), then publish. Only if the user confirms they want this release's version to replace the live one, retry with overrideChanged: true. On any other failure the publish is rolled back.",
    {
      id: z.string().describe("Release id"),
      overrideChanged: z.boolean().optional().describe("Publish even though items changed live since staging; the staged versions replace the live ones. Only with the user's confirmation."),
      force: z.boolean().optional().describe("Deprecated alias of overrideChanged"),
    },
    async (params) => formatResult(await client.post(`/releases/${params.id}/publish`, { overrideChanged: params.overrideChanged === true || params.force === true })),
  );

  siteAwareTool(server, client,
    "thincms_schedule_release",
    "Schedule a release to publish automatically (checked every 5 minutes). A scheduled publish never overrides: if any staged item (any type, including the template and navigation) changed on the live site since it was staged, nothing is published, the release returns to draft with lastError naming the changed items, and its creator is emailed (when the release has a creator user and email is configured). Pass publishAt: null to unschedule.",
    {
      id: z.string().describe("Release id"),
      publishAt: z.string().nullable().describe("ISO 8601 with timezone, e.g. 2026-11-03T20:00:00+13:00; null to unschedule"),
    },
    async (params) => formatResult(await client.post(`/releases/${params.id}/schedule`, { publishAt: params.publishAt })),
  );

  siteAwareTool(server, client,
    "thincms_discard_release",
    "Discard a release. Nothing goes live and its preview link stops working.",
    { id: z.string().describe("Release id") },
    async (params) => formatResult(await client.post(`/releases/${params.id}/discard`, {})),
  );
}
