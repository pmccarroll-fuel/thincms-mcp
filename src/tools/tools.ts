import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool, resolveContentInput, uploadIdField, LOCAL_ONLY } from "../helpers.js";

const AUTH_REQUIRED = z.enum(["none", "password", "google", "either"]);
const TOOL_STATUS = z.enum(["draft", "published", "archived"]);

export function registerToolTools(server: McpServer, client: ThinCMSClient) {
  // ─── Tool CRUD ───────────────────────────────────────────────────────────

  siteAwareTool(server, client,
    "thincms_list_tools",
    "List publishable Tools (mini-apps) with optional status/enabled filters and pagination. Tools render at /tools/:slug and can be authenticated (Google or password), store per-user JSON data, and call AI via /ai/chat and /ai/complete.",
    {
      status: TOOL_STATUS.optional().describe("Filter by status"),
      enabled: z.boolean().optional().describe("Filter to enabled tools only when true"),
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().max(100).optional().describe("Items per page (default: 50)"),
    },
    async (params) => {
      const q: Record<string, string> = {};
      if (params.status) q.status = params.status;
      if (params.enabled !== undefined) q.enabled = String(params.enabled);
      if (params.page) q.page = String(params.page);
      if (params.limit) q.limit = String(params.limit);
      return formatResult(await client.get("/tools", q));
    },
  );

  siteAwareTool(server, client,
    "thincms_get_tool",
    "Get a single Tool by ID or slug, including the full HTML payload and config.",
    {
      id: z.string().describe("Tool ID or slug"),
    },
    async (params) => formatResult(await client.get(`/tools/${encodeURIComponent(params.id)}`)),
  );

  siteAwareTool(server, client,
    "thincms_create_tool",
    "Create a new Tool. `html` is the raw HTML/JS payload that renders inside a sandboxed iframe with a `window.thinCMS` runtime injected. Set authRequired to 'password' | 'google' | 'either' to gate access; 'none' makes the tool public. Set systemPrompt to prepend a persona to /ai/chat calls. For large HTML payloads (>10KB), use htmlFile (local) or htmlUploadId (hosted; see thincms_prepare_upload).",
    {
      name: z.string().describe("Tool name (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from name if omitted)"),
      description: z.string().optional().describe("Short description shown in admin UI"),
      html: z.string().optional().describe("Raw HTML/JS payload"),
      htmlFile: z.string().optional().describe("Local file path containing the HTML payload — use instead of html for large tools" + LOCAL_ONLY),
      htmlUploadId: uploadIdField("the HTML payload"),
      authRequired: AUTH_REQUIRED.optional().describe("Auth mode (default: none)"),
      allowSignup: z.boolean().optional().describe("Whether the login screen offers self-signup (default: true)"),
      systemPrompt: z.string().optional().describe("Default system prompt prepended to ai/chat calls"),
      aiModel: z.string().optional().describe("Override site AI model for this tool (e.g. claude-sonnet-4-6)"),
      rateLimit: z.number().int().nonnegative().optional().describe("AI chat calls per end-user per hour (omit or null for unlimited)"),
      enabled: z.boolean().optional().describe("Enabled (default: true)"),
      status: TOOL_STATUS.optional().describe("Publish status (default: draft)"),
    },
    async (params) => {
      const { htmlFile, htmlUploadId, ...body } = params;
      const resolved = await resolveContentInput(client, { inline: (body as any).html, file: htmlFile, uploadId: htmlUploadId }, { inline: "html", file: "htmlFile", upload: "htmlUploadId" });
      if (!resolved.ok) return formatResult(resolved.error);
      (body as any).html = resolved.value;
      return formatResult(await client.post("/tools", body));
    },
  );

  siteAwareTool(server, client,
    "thincms_update_tool",
    "Update an existing Tool. Only supplied fields change. For large HTML payloads (>10KB), use htmlFile (local) or htmlUploadId (hosted) instead of html.",
    {
      id: z.string().describe("Tool ID or slug (required)"),
      name: z.string().optional(),
      slug: z.string().optional().describe("URL slug"),
      description: z.string().optional(),
      html: z.string().optional().describe("Raw HTML/JS payload"),
      htmlFile: z.string().optional().describe("Local file path containing the HTML payload — use instead of html for large tools" + LOCAL_ONLY),
      htmlUploadId: uploadIdField("the HTML payload"),
      authRequired: AUTH_REQUIRED.optional(),
      allowSignup: z.boolean().optional(),
      systemPrompt: z.string().optional(),
      aiModel: z.string().optional(),
      rateLimit: z.number().int().nonnegative().nullable().optional().describe("Pass null to clear the rate limit"),
      enabled: z.boolean().optional(),
      status: TOOL_STATUS.optional(),
    },
    async (params) => {
      const { id, htmlFile, htmlUploadId, ...body } = params;
      const resolved = await resolveContentInput(client, { inline: (body as any).html, file: htmlFile, uploadId: htmlUploadId }, { inline: "html", file: "htmlFile", upload: "htmlUploadId" });
      if (!resolved.ok) return formatResult(resolved.error);
      (body as any).html = resolved.value;
      return formatResult(await client.put(`/tools/${encodeURIComponent(id)}`, body));
    },
  );

  siteAwareTool(server, client,
    "thincms_delete_tool",
    "Permanently delete a Tool. Cascades to all ToolData rows, ToolAiUsage rows, and end-user sessions scoped to it.",
    {
      id: z.string().describe("Tool ID or slug"),
    },
    async (params) => formatResult(await client.delete(`/tools/${encodeURIComponent(params.id)}`)),
  );

  // ─── ToolData (JSON KV) ─────────────────────────────────────────────────

  siteAwareTool(server, client,
    "thincms_get_tool_data",
    "Read a single Tool data value. If subscriberId is provided, prefers the per-user value at that scope; otherwise reads tool-global. Falls back to tool-global if no per-user value exists.",
    {
      id: z.string().describe("Tool ID or slug"),
      key: z.string().describe("Data key"),
      subscriberId: z.string().optional().describe("End-user Subscriber ID to scope the read to a specific user"),
    },
    async (params) => {
      const q: Record<string, string> = {};
      if (params.subscriberId) q.subscriberId = params.subscriberId;
      return formatResult(await client.get(
        `/tools/${encodeURIComponent(params.id)}/data/${encodeURIComponent(params.key)}`,
        q,
      ));
    },
  );

  siteAwareTool(server, client,
    "thincms_set_tool_data",
    "Write a Tool data value. Without subscriberId, writes tool-global (visible to every user of the tool). With subscriberId, writes per-user data — the workhorse for AI agents updating a specific user's personalized dashboard, Kanban board, or state file. `value` accepts any JSON: object, array, string, number, boolean, or null.",
    {
      id: z.string().describe("Tool ID or slug"),
      key: z.string().describe("Data key"),
      value: z.any().describe("JSON value to store"),
      subscriberId: z.string().optional().describe("End-user Subscriber ID to scope the write to. Omit for tool-global."),
    },
    async (params) => {
      const q: Record<string, string> = {};
      if (params.subscriberId) q.subscriberId = params.subscriberId;
      const url = `/tools/${encodeURIComponent(params.id)}/data/${encodeURIComponent(params.key)}`
        + (Object.keys(q).length ? `?${new URLSearchParams(q).toString()}` : "");
      return formatResult(await client.put(url, { value: params.value }));
    },
  );

  siteAwareTool(server, client,
    "thincms_list_tool_data",
    "List all data keys visible to the caller — merges per-user (when subscriberId is supplied) with tool-global. Per-user values shadow global at the same key. Returns each key with its value, scope ('user' or 'global'), and updatedAt.",
    {
      id: z.string().describe("Tool ID or slug"),
      subscriberId: z.string().optional().describe("End-user Subscriber ID to view merged with tool-global"),
    },
    async (params) => {
      const q: Record<string, string> = {};
      if (params.subscriberId) q.subscriberId = params.subscriberId;
      return formatResult(await client.get(`/tools/${encodeURIComponent(params.id)}/data`, q));
    },
  );

  siteAwareTool(server, client,
    "thincms_delete_tool_data",
    "Delete a single data key. Deletes only the caller's scope — with subscriberId, the per-user value; without, the tool-global value.",
    {
      id: z.string().describe("Tool ID or slug"),
      key: z.string().describe("Data key"),
      subscriberId: z.string().optional().describe("End-user Subscriber ID"),
    },
    async (params) => {
      const q = params.subscriberId ? `?subscriberId=${encodeURIComponent(params.subscriberId)}` : "";
      return formatResult(await client.delete(
        `/tools/${encodeURIComponent(params.id)}/data/${encodeURIComponent(params.key)}${q}`,
      ));
    },
  );

  siteAwareTool(server, client,
    "thincms_list_tool_end_users",
    "List end-user Subscribers who have interacted with a Tool (have data rows or AI usage on it), sorted by most-recent activity. Returns id, email, name, emailVerified, lastLoginAt, and lastActiveOnTool.",
    {
      id: z.string().describe("Tool ID or slug"),
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().max(100).optional().describe("Items per page (default: 50)"),
    },
    async (params) => {
      const q: Record<string, string> = {};
      if (params.page) q.page = String(params.page);
      if (params.limit) q.limit = String(params.limit);
      return formatResult(await client.get(`/tools/${encodeURIComponent(params.id)}/users`, q));
    },
  );
}
