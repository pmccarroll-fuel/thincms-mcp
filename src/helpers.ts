import { readFileSync } from "node:fs";
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

// Active client reference, set once by createServer(). Used by formatResult
// to inject the active site name on every tool response so the agent knows
// which tenant the call hit.
let _activeClient: ThinCMSClient | null = null;

export function setActiveClient(client: ThinCMSClient): void {
  _activeClient = client;
}

// Tool registry — every tool registered through registerTool() is recorded
// here so thincms_capabilities can return the live list. Lets agents detect
// when their MCP host has cached a stale tool surface (registered count
// doesn't match what they expect for the running version).
const _toolRegistry: string[] = [];
export function recordToolName(name: string): void {
  _toolRegistry.push(name);
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
  apiKey: string;
  siteName: string;
  confirmProductionWrite?: boolean;
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
  const site = _activeClient?.getActiveSite();
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
    const configured = _activeClient?.getSites().find((s) => s.siteId === targetSiteId);
    const hint = configured
      ? `Run thincms_switch_site(name="${configured.name}") then retry.`
      : `This resource belongs to siteId=${targetSiteId} (${targetSiteName}), which is not in your THINCMS_SITES config.`;
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
  "Override the active site for this single call. Pass to target a specific tenant without mutating shared active-site state — the right pattern when running concurrent agent sessions managing different tenants. Must match a siteId from your THINCMS_SITES config (use thincms_list_sites to inspect). When omitted, the call uses the active site set by thincms_switch_site."
);

const CONFIRM_PRODUCTION_WRITE_FIELD = z.boolean().optional().describe(
  "Acknowledge that this call may write to a configured production site (THINCMS_PRODUCTION_SITE_IDS env var). Required for any POST/PUT/PATCH/DELETE against a production-listed site; ignored otherwise. The error message lists which site triggered the requirement and recommends thincms_snapshot before any production write."
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
  };
  (server as any).tool(name, description, augmented, async (params: any) => {
    const { siteId, confirmProductionWrite, ...rest } = params;
    // Resolve target siteId: explicit param > active site
    const targetSiteId = siteId ?? client.getActiveSite().siteId;
    let siteName: string | undefined;
    let apiKey: string | undefined;
    if (siteId) {
      const profile = client.getSites().find((s) => s.siteId === siteId);
      if (!profile) {
        const available = client
          .getSites()
          .map((s) => `${s.name} [${s.siteId}]`)
          .join(", ");
        return formatResult({
          ok: false,
          status: 0,
          data: {
            error: `siteId "${siteId}" not in your configured THINCMS_SITES. Available: ${available}. Use thincms_list_sites to inspect, or thincms_switch_site to change the active site.`,
          },
        });
      }
      siteName = profile.name;
      apiKey = profile.apiKey;
    } else {
      const profile = client.getSites().find((s) => s.siteId === targetSiteId);
      siteName = client.getActiveSite().name;
      apiKey = profile?.apiKey;
    }
    return runWithOverride(
      { siteId: targetSiteId, apiKey: apiKey!, siteName: siteName!, confirmProductionWrite },
      () => handler(rest),
    );
  });
}

// Replace heavyweight HTML fields with size summaries so the response stays
// under the agent's token budget. Used by update_page / update_post / etc.
function fieldStats(value: string | null | undefined) {
  if (value == null) return null;
  const bytes = Buffer.byteLength(value, "utf-8");
  return { bytes, lines: value.split("\n").length };
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
