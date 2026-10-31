/**
 * MCP-level test for release + version tools against a LOCAL ThinCMS dev
 * server (npm run dev). Creates a temporary API key via the dev admin session,
 * marks the site as production so the write guard is exercised, and cleans up.
 *
 *   npx tsx tests/releases-tools.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

const BASE = process.env.THINCMS_URL || "http://localhost:3000";
let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const login = await fetch(`${BASE}/api/dev-login`, { redirect: "manual" });
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const admin = (path: string, init: RequestInit = {}) =>
  fetch(`${BASE}/api/v1${path}`, { ...init, headers: { cookie, "Content-Type": "application/json", ...(init.headers ?? {}) } });

const siteId: string = (await (await fetch(`${BASE}/api/auth/session`, { headers: { cookie } })).json()).user.sites[0].id;
let keyId: string | undefined;
let client: Client | undefined;

try {
const keyRes = await (await admin("/api-keys", { method: "POST", body: JSON.stringify({ name: "releases-tools test" }) })).json();
const apiKey: string = keyRes.key;
keyId = keyRes.id;
check("temporary API key", !!apiKey && !!siteId, `${keyId} on ${siteId}`);

const { server } = createServer({
  baseUrl: BASE,
  apiKey,
  siteId,
  sites: [{ name: "Dev", siteId, apiKey }],
  productionSiteIds: [siteId], // exercise the production write guard
});
client = new Client({ name: "releases-test", version: "1.0.0" });
const [ct, st] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(st), client.connect(ct)]);
const call = async (name: string, args: Record<string, unknown>) => {
  const r: any = await client!.callTool({ name, arguments: args });
  const text = r.content.map((c: any) => c.text ?? "").join("\n");
  const json = text.slice(text.indexOf("\n") + 1);
  let data: any;
  try { data = JSON.parse(json); } catch { data = json; }
  return { isError: !!r.isError, text, data };
};

const tools = (await client.listTools()).tools;
const updatePage = tools.find((t) => t.name === "thincms_update_page")!;
check("update_page exposes releaseId", "releaseId" in (updatePage.inputSchema as any).properties);
check("get_page does not", !("releaseId" in (tools.find((t) => t.name === "thincms_get_page")!.inputSchema as any).properties));

const pages = await call("thincms_list_pages", { status: "published", limit: 1 });
const target = pages.data.pages[0];
const MARK = `mcp-${Date.now()}`;

  const rel = await call("thincms_create_release", { name: `MCP ${MARK}` });
  check("create_release on a production site needs no confirmation", !rel.isError && !!rel.data.id, rel.text.split("\n")[1]);
  const releaseId = rel.data.id;

  const staged = await call("thincms_update_page", { id: target.id, metaDescription: MARK, releaseId });
  check("update_page with releaseId stages without confirmation", !staged.isError && staged.text.includes('"staged": true'), staged.text.slice(0, 160));
  const live = await call("thincms_get_page", { id: target.id });
  check("live page untouched", !live.text.includes(MARK));

  const blocked = await call("thincms_update_page", { id: target.id, metaDescription: MARK });
  check("live write to production site still blocked", blocked.isError && blocked.text.includes("confirmProductionWrite"));

  const css = await call("thincms_patch_css", { section: "nonexistent-section", css: "a{}", releaseId });
  check("patch_css staging reports section errors", css.isError);

  const detail = await call("thincms_get_release", { id: releaseId });
  check("get_release lists the staged page", detail.data.items?.length === 1 && detail.data.items[0].entityType === "page");

  const diff = await call("thincms_diff_release", { id: releaseId });
  check("diff_release shows metaDescription change", diff.text.includes("metaDescription"));

  const link = await call("thincms_get_release_preview_link", { id: releaseId });
  check("preview link", typeof link.data.previewUrl === "string" && link.data.previewUrl.includes("/preview-release/"));

  const pubBlocked = await call("thincms_publish_release", { id: releaseId });
  check("publish_release needs production confirmation", pubBlocked.isError && pubBlocked.text.includes("confirmProductionWrite"));

  const discard = await call("thincms_discard_release", { id: releaseId });
  check("discard_release", !discard.isError && discard.data.status === "discarded");

  const versions = await call("thincms_list_versions", { entityType: "template" });
  check("list_versions works", !versions.isError && Array.isArray(versions.data.versions));
} finally {
  if (keyId) await admin(`/api-keys/${keyId}`, { method: "DELETE" });
  await client?.close();
}

console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
