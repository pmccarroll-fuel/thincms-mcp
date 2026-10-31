/**
 * End-to-end test for staged uploads, content hashes, the hosted file-path
 * lockdown and the live-site write guard, against a running ThinCMS.
 *
 *   THINCMS_E2E_URL=http://localhost:3001 npx tsx tests/staged-upload-e2e.ts
 *
 * "Hosted" here means remote: true with an API key — the same code paths the
 * hosted server runs, without needing an OAuth token. Creates a draft page
 * and a media item, and deletes both at the end. Re-pushes the existing
 * stylesheet unchanged.
 */
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { ThinCMSConfig } from "../src/config.js";

const BASE_URL = process.env.THINCMS_E2E_URL ?? "http://localhost:3000";
const API_KEY = process.env.THINCMS_API_KEY ?? "tcms_3221b8d7085f4c91919880d5f1d6b63a";
const SITE_ID = process.env.THINCMS_SITE_ID ?? "cmmd3v5bz0000it37ojv442kt";

async function connect(overrides: Partial<ThinCMSConfig> = {}) {
  const { server } = createServer({
    baseUrl: BASE_URL,
    apiKey: API_KEY,
    siteId: SITE_ID,
    sites: [{ name: "e2e", siteId: SITE_ID, apiKey: API_KEY }],
    productionSiteIds: [],
    remote: true,
    ...overrides,
  });
  const client = new Client({ name: "staged-upload-e2e", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(b), client.connect(a)]);
  return client;
}

const hosted = await connect();
const liveSite = await connect({
  sites: [{ name: "e2e-live", siteId: SITE_ID, apiKey: API_KEY, siteStatus: "live" }],
});

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ✗ ${name}: ${err.message}`);
    failed++;
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// Tool responses start with a "[site · mcp vX]" line, then JSON or text
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const res: any = await client.callTool({ name, arguments: args });
  const text: string = res.content?.[0]?.text ?? "";
  const body = text.split("\n").slice(1).join("\n");
  let data: any = body;
  try { data = JSON.parse(body); } catch { /* error text */ }
  return { isError: !!res.isError, text, data };
}

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

// prepare + PUT, the way an agent would with curl
async function stage(client: Client, bytes: Buffer, filename: string, contentType: string, declaredSha = sha256(bytes)) {
  const prep = await call(client, "thincms_prepare_upload", { filename, contentType, bytes: bytes.length, sha256: declaredSha });
  assert(!prep.isError, `prepare failed: ${prep.text}`);
  const put = await fetch(prep.data.uploadUrl, { method: "PUT", body: bytes });
  return { uploadId: prep.data.uploadId as string, put, putBody: await put.json() };
}

console.log(`Staged upload e2e against ${BASE_URL}\n`);

console.log("Hosted file-path lockdown");
for (const [tool, args] of [
  ["thincms_create_page", { title: "x", contentFile: "/etc/hostname" }],
  ["thincms_update_template", { stylesheetFile: "/etc/hostname" }],
  ["thincms_patch_css", { section: "x", cssFile: "/etc/hostname", dryRun: true }],
  ["thincms_append_css", { cssFile: "/etc/hostname", dryRun: true }],
  ["thincms_template_status", { compareStylesheetFile: "/etc/hostname" }],
  ["thincms_upload_media", { filePath: "/etc/hostname" }],
] as const) {
  await test(`${tool} refuses a server path`, async () => {
    const r = await call(hosted, tool, args);
    assert(/aren't available on the hosted server/.test(r.text), `unexpected: ${r.text}`);
    assert(!/ENOENT/.test(r.text), "leaked a filesystem error");
  });
}

console.log("\nPages");
const html = "<section><!-- START:hero -->\n" + "<p>Grooming — ✂️ naïve café</p>\n".repeat(2000) + "<!-- END:hero --></section>\n";
const htmlBuf = Buffer.from(html, "utf-8");
let pageId = "";

await test(`create_page from a ${Math.round(htmlBuf.length / 1024)} KB upload stores the exact bytes`, async () => {
  const { uploadId, put, putBody } = await stage(hosted, htmlBuf, "grooming.html", "text/html");
  assert(put.ok && putBody.sha256 === sha256(htmlBuf), `PUT failed: ${JSON.stringify(putBody)}`);
  const r = await call(hosted, "thincms_create_page", { title: "E2E staged upload", slug: `e2e-staged-${Date.now()}`, contentUploadId: uploadId });
  assert(!r.isError, r.text);
  pageId = r.data.id;
  assert(r.data._contentStats.sha256 === sha256(htmlBuf), `stored hash ${r.data._contentStats.sha256}`);

  const again = await call(hosted, "thincms_update_page", { id: pageId, contentUploadId: uploadId });
  assert(again.isError && /already been used/.test(again.text), `reuse not refused: ${again.text}`);
});

await test("get_page metadataOnly returns the hash, not the HTML", async () => {
  const r = await call(hosted, "thincms_get_page", { id: pageId, metadataOnly: true });
  assert(r.data.content.sha256 === sha256(htmlBuf) && r.text.length < 2000, r.text.slice(0, 300));
});

await test("update_page expectedSha256 refuses a stale hash and accepts the current one", async () => {
  const stale = await call(hosted, "thincms_update_page", { id: pageId, title: "nope", expectedSha256: sha256("old") });
  assert(stale.isError && /has changed since your last sync/.test(stale.text), stale.text);
  const ok = await call(hosted, "thincms_update_page", { id: pageId, title: "E2E staged upload (2)", expectedSha256: sha256(htmlBuf) });
  assert(!ok.isError, ok.text);
});

await test("a PUT whose bytes don't match the declared sha256 is rejected", async () => {
  const { put, putBody } = await stage(hosted, htmlBuf, "grooming.html", "text/html", sha256("something else"));
  assert(put.status === 400 && /sha256 mismatch/.test(putBody.error), JSON.stringify(putBody));
});

await test("passing two content sources is refused", async () => {
  const r = await call(hosted, "thincms_update_page", { id: pageId, content: "<p/>", contentUploadId: "x" });
  assert(r.isError && /Provide only one of content, contentUploadId/.test(r.text), r.text);
});

console.log("\nTemplate");
await test("update_template re-pushes the stylesheet via upload and reports the matching hash", async () => {
  const tpl = await call(hosted, "thincms_get_template", {});
  const css = Buffer.from(tpl.data.stylesheet ?? "", "utf-8");
  const { uploadId } = await stage(hosted, css, "stylesheet.css", "text/css");
  const r = await call(hosted, "thincms_update_template", { stylesheetUploadId: uploadId, expectedStylesheetSha256: sha256(css) });
  assert(!r.isError, r.text);
  assert(r.data.stylesheet.sha256 === sha256(css), `stored ${r.data.stylesheet.sha256}`);
  const meta = await call(hosted, "thincms_get_template", { metadataOnly: true });
  assert(meta.data.stylesheet.sha256 === sha256(css), "metadataOnly hash differs");
});

console.log("\nMedia");
let mediaId = "";
await test("upload_media from a 2 MB staged upload returns its sha256", async () => {
  const bin = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < bin.length; i++) bin[i] = (i * 31) & 0xff;
  const { uploadId, put } = await stage(hosted, bin, "e2e-clip.bin", "application/octet-stream");
  assert(put.ok, "PUT failed");
  const r = await call(hosted, "thincms_upload_media", { uploadId });
  assert(!r.isError, r.text);
  mediaId = r.data.id;
  assert(r.data.sha256 === sha256(bin) && r.data.size === bin.length && r.data.originalName === "e2e-clip.bin", r.text.slice(0, 400));
});

console.log("\nLive-site guard");
await test("a live site refuses writes without confirmProductionWrite, without burning the upload", async () => {
  const { uploadId } = await stage(liveSite, Buffer.from("<p>guarded</p>"), "p.html", "text/html");
  const refused = await call(liveSite, "thincms_update_page", { id: pageId, contentUploadId: uploadId });
  assert(refused.isError && /the site is live/.test(refused.text), refused.text);
  const ok = await call(liveSite, "thincms_update_page", { id: pageId, contentUploadId: uploadId, confirmProductionWrite: true });
  assert(!ok.isError && ok.data._contentStats.sha256 === sha256("<p>guarded</p>"), ok.text);
});

console.log("\nCleanup");
await test("delete test page and media", async () => {
  if (pageId) assert(!(await call(hosted, "thincms_delete_page", { id: pageId })).isError, "page delete failed");
  if (mediaId) assert(!(await call(hosted, "thincms_delete_media", { id: mediaId })).isError, "media delete failed");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
