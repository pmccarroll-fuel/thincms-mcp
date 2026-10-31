import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

const ENTITY_TYPE = z
  .enum(["page", "post", "template", "navigation", "contentBlock", "collection"])
  .describe("Content type");

export function registerVersionTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client,
    "thincms_list_versions",
    "Version history for one item, newest first. Every change to pages, posts, the template, navigation, content blocks and collections is recorded automatically (direct edits and published releases), so any earlier state can be compared and restored. Returns metadata only: who, when, source, bytes, sha256.",
    {
      entityType: ENTITY_TYPE,
      entityKey: z.string().optional().describe("The item's id. Not needed for template or navigation."),
      limit: z.number().optional().describe("Max versions (default 50)"),
    },
    async (params) => {
      const query: Record<string, string> = { entityType: params.entityType };
      if (params.entityKey) query.entityKey = params.entityKey;
      if (params.limit) query.limit = String(params.limit);
      return formatResult(await client.get("/versions", query));
    },
  );

  siteAwareTool(server, client,
    "thincms_list_deleted",
    "List deleted items of a type that can be restored, with the version id to pass to thincms_restore_version.",
    { entityType: ENTITY_TYPE },
    async (params) => formatResult(await client.get("/versions", { entityType: params.entityType, deleted: "1" })),
  );

  siteAwareTool(server, client,
    "thincms_get_version",
    "Get one version. By default returns metadata only; pass includeData: true for the full snapshot (can be large — prefer thincms_diff_version).",
    {
      id: z.string().describe("Version id"),
      includeData: z.boolean().optional().describe("Include the full snapshot (default false)"),
    },
    async (params) => {
      const result = await client.get(`/versions/${params.id}`);
      if (result.ok && !params.includeData) {
        const { data: _data, ...meta } = result.data as Record<string, unknown>;
        result.data = meta;
      }
      return formatResult(result);
    },
  );

  siteAwareTool(server, client,
    "thincms_diff_version",
    "Show what restoring a version would change: a per-field line diff from the live item (or another version) to this version. Unchanged runs are collapsed.",
    {
      id: z.string().describe("Version id"),
      against: z.string().optional().describe('"live" (default) or another version id of the same item'),
    },
    async (params) => formatResult(await client.get(`/versions/${params.id}/diff`, params.against ? { against: params.against } : undefined)),
  );

  siteAwareTool(server, client,
    "thincms_restore_version",
    "Make the live item match a version — the rollback tool. Recreates deleted items. The restore is itself recorded as a new version, so it can be undone. Check thincms_diff_version first.",
    { id: z.string().describe("Version id to restore") },
    async (params) => formatResult(await client.post(`/versions/${params.id}/restore`, {})),
  );
}
