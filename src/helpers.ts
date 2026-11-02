import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiResult } from "./types.js";
import type { ThinCMSClient } from "./client.js";

// MCP wrapper version — read from package.json at startup so every response
// can stamp the running version. Lets agents detect when they're talking to
// an out-of-date wrapper that may be silently dropping unknown tool inputs.
let MCP_VERSION = "unknown";
try {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf-8"));
  MCP_VERSION = pkg.version || "unknown";
} catch {
  // Best-effort — if we can't read package.json, the stamp just shows "unknown"
}

export function getMcpVersion(): string {
  return MCP_VERSION;
}

// Client for the current tool call. The hosted server runs one McpServer per
// user session in a single process, so this can't be a module global: every
// tool handler is wrapped (see tools/index.ts) to run inside this context.
// formatResult reads it to stamp the active site name on every response.
const _clientStore = new AsyncLocalStorage<ThinCMSClient>();

export function runWithClient<T>(client: ThinCMSClient, fn: () => T): T {
  return _clientStore.run(client, fn);
}

export function getCurrentClient(): ThinCMSClient | undefined {
  return _clientStore.getStore();
}

// Tool registry — every tool registered through registerTool() is recorded
// here so thincms_capabilities can return the live list. Lets agents detect
// when their MCP host has cached a stale tool surface (registered count
// doesn't match what they expect for the running version).
// A Set, because the hosted server registers the same tools once per session.
const _toolRegistry = new Set<string>();
export function recordToolName(name: string): void {
  _toolRegistry.add(name);
}
export function getRegisteredTools(): string[] {
  return [..._toolRegistry];
}

// Per-call site override context. Set by siteAwareTool when a tool's `siteId`
// param is provided; consumed by ThinCMSClient.headers and metaPrefix below.
// Propagates through await chains via AsyncLocalStorage so individual tool
// handler bodies don't need to know about it.
export type SiteOverride = {
  siteId: string;
  apiKey?: string;
  siteName: string;
  confirmProductionWrite?: boolean;
  // Stage this call's writes into a release instead of writing live.
  releaseId?: string;
};
const _overrideStore = new AsyncLocalStorage<SiteOverride>();

export function getCurrentOverride(): SiteOverride | undefined {
  return _overrideStore.getStore();
}

export function runWithOverride<T>(override: SiteOverride, fn: () => Promise<T>): Promise<T> {
  return _overrideStore.run(override, fn);
}

function metaPrefix(): string {
  // Per-call override wins over the persistent active-site state when set.
  const override = _overrideStore.getStore();
  if (override) {
    return `[${override.siteName} [${override.siteId}] · mcp v${MCP_VERSION}]`;
  }
  const site = _clientStore.getStore()?.getActiveSite();
  const siteLabel = site?.name ? `${site.name} [${site.siteId}]` : "no active site";
  return `[${siteLabel} · mcp v${MCP_VERSION}]`;
}

// Build a one-line warning per value-reset returned by the API. Surfaces
// silent-clobber events (operator error, partial PUTs, future schema bugs)
// at the top of the tool response so the agent sees them before reading data.
function valueResetWarnings(data: any): string[] {
  if (!data || !Array.isArray(data.valueResets) || data.valueResets.length === 0) return [];
  return data.valueResets.map((r: any) => {
    const before = typeof r.before === "string" ? `"${r.before}"` : JSON.stringify(r.before);
    return `⚠ Value reset: ${r.field} ${before} → null`;
  });
}

export function formatResult(result: ApiResult) {
  const prefix = metaPrefix();
  if (result.ok) {
    const warnings = valueResetWarnings(result.data);
    const head = warnings.length > 0 ? `${prefix}\n${warnings.join("\n")}` : prefix;
    return {
      content: [{
        type: "text" as const,
        text: `${head}\n${JSON.stringify(result.data, null, 2)}`,
      }],
    };
  }
  // Cross-site mismatch: rewrite the error so the agent sees an actionable
  // next step (switch_site name) rather than a generic 400. Only fires when
  // the API returns the explicit code — older API responses fall through to
  // the default formatter unchanged.
  if (result.data?.code === "RESOURCE_ON_DIFFERENT_SITE") {
    const targetSiteId: string = result.data.siteId;
    const targetSiteName: string = result.data.siteName ?? "(unknown)";
    const configured = _clientStore.getStore()?.getSites().find((s) => s.siteId === targetSiteId);
    const hint = configured
      ? `Run thincms_switch_site(name="${configured.name}") then retry.`
      : `This resource belongs to siteId=${targetSiteId} (${targetSiteName}), which is not one of your configured/permitted sites.`;
    return {
      content: [{
        type: "text" as const,
        text: `${prefix}\nWrong active site: resource lives on "${targetSiteName}". ${hint}`,
      }],
      isError: true,
    };
  }
  const message = result.data?.error || result.data?.message || JSON.stringify(result.data);
  return {
    content: [{
      type: "text" as const,
      text: `${prefix}\nAPI Error (${result.status}): ${message}`,
    }],
    isError: true,
  };
}

// Lightweight wrapper for tools that build their own response text and want
// to keep the standard meta prefix.
export function formatText(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text: `${metaPrefix()}\n${text}` }],
    ...(isError ? { isError: true } : {}),
  };
}

export function stripContentFromList(posts: any[]): any[] {
  return posts.map(({ content, ...rest }) => rest);
}

// Augments a tool's input schema with an optional `siteId` parameter. When
// the caller passes siteId, the handler runs inside an AsyncLocalStorage
// context so the underlying ThinCMSClient and formatResult automatically
// route the call to the override site without mutating shared active-site
// state. Per-tool handler bodies need no changes — the propagation is
// transparent through await chains.
const SITE_OVERRIDE_FIELD = z.string().optional().describe(
  "Override the active site for this single call — a site ID or site name (case-insensitive). Pass to target a specific tenant without mutating shared active-site state — the right pattern when running concurrent agent sessions managing different tenants. Must be one of the sites from thincms_list_sites. When omitted, the call uses the active site set by thincms_switch_site."
);

// Content write tools that can stage into a release instead of writing live.
export const RELEASE_STAGEABLE_TOOLS = new Set([
  "thincms_create_page", "thincms_update_page", "thincms_delete_page", "thincms_patch_page",
  "thincms_create_post", "thincms_update_post", "thincms_delete_post",
  "thincms_update_template", "thincms_patch_css", "thincms_patch_template",
  "thincms_update_navigation",
  "thincms_create_content_block", "thincms_update_content_block", "thincms_delete_content_block",
  "thincms_create_collection", "thincms_update_collection", "thincms_delete_collection",
  "thincms_create_collection_item", "thincms_update_collection_item", "thincms_delete_collection_item",
  "thincms_reorder_collection_items",
  // Course content (staged only with an explicit releaseId)
  "thincms_create_module", "thincms_update_module", "thincms_delete_module",
  "thincms_create_lesson", "thincms_update_lesson", "thincms_delete_lesson",
  "thincms_create_quiz", "thincms_update_quiz", "thincms_delete_quiz",
  "thincms_add_quiz_question", "thincms_update_quiz_question", "thincms_delete_quiz_question",
  "thincms_create_workbook", "thincms_update_workbook", "thincms_delete_workbook",
]);

const RELEASE_ID_FIELD = z.string().optional().describe(
  "Optional. Stage this change into a release (from thincms_create_release) instead of publishing it live. The live site is untouched until the release is published; preview it with thincms_get_release_preview_link. Omit to write live immediately, as normal."
);

const CONFIRM_PRODUCTION_WRITE_FIELD = z.boolean().optional().describe(
  "Acknowledge that this call may write to a production site: one listed in THINCMS_PRODUCTION_SITE_IDS or, on the hosted server, any site whose status is live. Required for any write against a production site (dry runs excepted); ignored otherwise. The error message names the site and recommends thincms_snapshot before any production write."
);

export function siteAwareTool<S extends z.ZodRawShape>(
  server: McpServer,
  client: ThinCMSClient,
  name: string,
  description: string,
  schema: S,
  handler: (params: z.objectOutputType<S, z.ZodTypeAny>) => Promise<any>,
): void {
  const augmented: z.ZodRawShape = {
    ...schema,
    siteId: SITE_OVERRIDE_FIELD,
    confirmProductionWrite: CONFIRM_PRODUCTION_WRITE_FIELD,
    ...(RELEASE_STAGEABLE_TOOLS.has(name) ? { releaseId: RELEASE_ID_FIELD } : {}),
  };
  (server as any).tool(name, description, augmented, async (params: any) => {
    const stageable = RELEASE_STAGEABLE_TOOLS.has(name);
    const { siteId, confirmProductionWrite, ...rest } = params;
    // For stageable tools releaseId is routing, not a tool input; other tools
    // (e.g. thincms_stage_release_item) keep it as a normal parameter.
    const releaseId: string | undefined = stageable ? rest.releaseId : undefined;
    if (stageable) delete rest.releaseId;
    // Resolve target siteId: explicit param > active site
    const targetSiteId = siteId ?? client.getActiveSite().siteId;
    let siteName: string | undefined;
    let apiKey: string | undefined;
    let resolvedSiteId = targetSiteId;
    if (siteId) {
      const profile = client.findSite(siteId);
      if (!profile) {
        const available = client
          .getSites()
          .map((s) => `${s.name} [${s.siteId}]`)
          .join(", ");
        return formatResult({
          ok: false,
          status: 0,
          data: {
            error: `Site "${siteId}" is not one of your sites. Available: ${available || "(none)"}. Use thincms_list_sites to inspect, or thincms_switch_site to change the active site.`,
          },
        });
      }
      resolvedSiteId = profile.siteId;
      siteName = profile.name;
      apiKey = profile.apiKey;
    } else {
      const profile = client.getSites().find((s) => s.siteId === targetSiteId);
      siteName = client.getActiveSite().name;
      apiKey = profile?.apiKey;
    }
    return runWithOverride(
      { siteId: resolvedSiteId, apiKey, siteName: siteName!, confirmProductionWrite, releaseId },
      () => handler(rest),
    );
  });
}

// Size + full sha256 of a content field. The hash is over the UTF-8 bytes, so
// it matches `shasum -a 256` of a local file holding the same content.
export function contentStats(value: string) {
  return {
    bytes: Buffer.byteLength(value, "utf-8"),
    lines: value.split("\n").length,
    sha256: createHash("sha256").update(value, "utf-8").digest("hex"),
  };
}

// Replace heavyweight HTML fields with size summaries so the response stays
// under the agent's token budget. Used by update_page / update_post / etc.
function fieldStats(value: string | null | undefined) {
  if (value == null) return null;
  return contentStats(value);
}

export function summarizeContentResponse<T extends Record<string, any>>(
  obj: T,
  contentFields: Array<keyof T> = ["content", "membersContent"] as Array<keyof T>,
): Record<string, any> {
  if (!obj || typeof obj !== "object") return obj as any;
  const out: Record<string, any> = { ...obj };
  for (const f of contentFields) {
    const key = String(f);
    if (typeof out[key] === "string" && out[key].length > 0) {
      out[`_${key}Stats`] = fieldStats(out[key]);
      delete out[key];
    }
  }
  return out;
}

// Resolve one text field that can arrive three ways: inline, a local file
// (stdio only), or a staged upload ID (thincms_prepare_upload). At most one
// may be given; value is undefined when none is. Hosted mode refuses file
// paths before touching the filesystem — the paths would otherwise be read
// from the MCP server's own disk.
export type ContentInput = { inline?: string; file?: string; uploadId?: string };
export type ContentNames = { inline: string; file: string; upload: string };

export async function resolveContentInput(
  client: ThinCMSClient,
  input: ContentInput,
  names: ContentNames,
  opts: { peek?: boolean } = {},
): Promise<{ ok: true; value: string | undefined } | { ok: false; error: ApiResult }> {
  const fail = (error: string, status = 0) => ({ ok: false as const, error: { ok: false, status, data: { error } } });
  const given = [
    input.inline !== undefined && names.inline,
    input.file !== undefined && names.file,
    input.uploadId !== undefined && names.upload,
  ].filter(Boolean);
  if (given.length > 1) return fail(`Provide only one of ${given.join(", ")}`);

  if (input.file !== undefined) {
    if (client.isRemote()) {
      return fail(`File paths aren't available on the hosted server. Use thincms_prepare_upload and pass ${names.upload} instead.`);
    }
    try {
      return { ok: true, value: await readFile(input.file, "utf-8") };
    } catch (err: any) {
      return fail(`Failed to read ${names.file}: ${err.message}`);
    }
  }

  if (input.uploadId !== undefined) {
    // Uploads are single use: refuse a guarded write before consuming one.
    // A peek (dry run) neither writes nor uses the upload up.
    if (!opts.peek) {
      const guard = client.checkProductionWrite();
      if (guard) return { ok: false, error: guard };
    }
    const upload = await client.consumeUpload(input.uploadId, { peek: opts.peek });
    if (!upload.ok) return { ok: false, error: upload.result };
    try {
      // fatal: refuse non-UTF-8 rather than silently substituting characters;
      // ignoreBOM: keep a BOM so the stored hash still matches the local file.
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(upload.bytes);
      return { ok: true, value: text };
    } catch {
      return fail(`${names.upload}: the uploaded file is not valid UTF-8 text`);
    }
  }

  return { ok: true, value: input.inline };
}

// Description suffix for *File params, so hosted agents don't reach for them.
export const LOCAL_ONLY = " (local stdio server only; on the hosted server use the matching *UploadId parameter)";

export function uploadIdField(what: string) {
  return z.string().optional().describe(
    `ID of a staged upload containing ${what} — from thincms_prepare_upload after PUTting the file to its uploadUrl. Use for large content on the hosted server; the file bytes never pass through the model. Single use.`,
  );
}

// Optimistic-concurrency check for update tools: refuse the write when the
// stored field no longer hashes to what the agent last synced.
export function checkExpectedHash(
  current: string | null | undefined,
  expectedSha256: string | undefined,
  field: string,
): ApiResult | null {
  if (!expectedSha256) return null;
  const currentSha256 = contentStats(current ?? "").sha256;
  if (currentSha256 === expectedSha256.toLowerCase()) return null;
  return {
    ok: false,
    status: 409,
    data: {
      error: `${field} has changed since your last sync (stored sha256 ${currentSha256}, expected ${expectedSha256}). Nothing was written. Re-read it, merge, and retry.`,
      currentSha256,
    },
  };
}

// metadataOnly reads: replace each content field with its stats.
export function metadataOnly(obj: Record<string, any>, fields: string[]): Record<string, any> {
  const out: Record<string, any> = { ...obj };
  for (const f of fields) {
    if (typeof out[f] === "string") out[f] = contentStats(out[f]);
  }
  return out;
}

export const EXPECTED_SHA_FIELD = (field: string) => z.string().optional().describe(
  `sha256 of the ${field} you last synced. When given, the write is refused (409, with currentSha256) if the stored ${field} no longer matches — protects edits made in the admin since your last sync.`,
);

export const METADATA_ONLY_FIELD = z.boolean().optional().describe(
  "Return bytes, lines and sha256 for each content field instead of the content itself. Use to check local and live are in sync without pulling the content into context.",
);

export const AS_DOWNLOAD_FIELD = z.boolean().optional().describe(
  "Return single-use download links (valid 15 minutes, no auth header) instead of the content. Fetch with `curl -fsS -o <file> \"<downloadUrl>\"` and check with `shasum -a 256`. Use for large reads you want as a local file without pulling them into context.",
);

/**
 * Stage each file as a download link and return the links (with bytes and
 * sha256) in place of the content.
 */
export async function downloadLinks(
  client: ThinCMSClient,
  files: Array<{ field?: string; filename: string; contentType: string; content: string | Uint8Array }>,
) {
  const downloads: any[] = [];
  for (const f of files) {
    const staged = await client.stageDownload(f.content, f.filename, f.contentType);
    if (!staged.ok) return formatResult(staged);
    downloads.push({ ...(f.field ? { field: f.field } : {}), ...staged.data });
  }
  return formatResult({
    ok: true,
    status: 200,
    data: {
      downloads,
      fetch: downloads.map((d) => `curl -fsS -o ${d.filename} "${d.downloadUrl}"`).join("\n"),
    },
  });
}

// Before/after summary for a dry-run full replacement of one content field
export function dryRunField(before: string | null | undefined, after: string | undefined) {
  const b = contentStats(before ?? "");
  if (after === undefined) return { unchanged: true, current: b };
  const a = contentStats(after);
  return {
    before: b,
    after: a,
    bytesDelta: a.bytes - b.bytes,
    linesDelta: a.lines - b.lines,
    identical: a.sha256 === b.sha256,
  };
}

export const DRY_RUN_REPLACE_FIELD = z.boolean().optional().describe(
  "Report what the write would change — before/after bytes, lines and sha256 per content field — without writing. A staged upload used in a dry run stays usable for the real call.",
);
