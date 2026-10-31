/**
 * End-to-end test for staged uploads, content hashes, the hosted file-path
 * lockdown, the live-site write guard, section patching, dry runs and
 * download links, against a running ThinCMS.
 *
 *   THINCMS_E2E_URL=http://localhost:3001 npx tsx tests/staged-upload-e2e.ts
 *
 * "Hosted" here means remote: true with an API key — the same code paths the
 * hosted server runs, without needing an OAuth token. Creates two draft pages
 * and a media item and deletes them at the end. Temporarily edits the
 * stylesheet and customHeadHtml, restoring both. Run against a scratch copy
 * of a database, never production.
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

console.log("\nSection patching (pages)");
const sectioned = [
  "<main>",
  "<!-- START:hero -->",
  "<h1>Old hero</h1>",
  "<!-- END:hero -->",
  "<!-- START:faq",
  "     Questions block: keep in sync with the FAQ collection -->",
  "<p>Old FAQ</p>",
  "<!-- END:faq -->",
  "</main>",
].join("\n");
let secPageId = "";
await test("get_page sections lists both sections, including the multi-line marker", async () => {
  const r = await call(hosted, "thincms_create_page", { title: "E2E sections", slug: `e2e-sections-${Date.now()}`, content: sectioned });
  assert(!r.isError, r.text);
  secPageId = r.data.id;
  const s2 = await call(hosted, "thincms_get_page", { id: secPageId, sections: true });
  assert(JSON.stringify(s2.data.sections.map((x: any) => x.name)) === '["hero","faq"]', s2.text);
});

await test("patch_page dryRun peeks an upload; the real patch then uses it", async () => {
  const faq = Buffer.from("<p>New FAQ ✓</p>");
  const { uploadId } = await stage(hosted, faq, "faq.html", "text/html");
  const dry = await call(hosted, "thincms_patch_page", { id: secPageId, section: "faq", contentUploadId: uploadId, dryRun: true });
  assert(!dry.isError && dry.data.dryRun === true, dry.text);
  const real = await call(hosted, "thincms_patch_page", { id: secPageId, section: "faq", contentUploadId: uploadId });
  assert(!real.isError, real.text);
  const expected = sectioned.replace("<p>Old FAQ</p>", "<p>New FAQ ✓</p>");
  const meta = await call(hosted, "thincms_get_page", { id: secPageId, metadataOnly: true });
  assert(meta.data.content.sha256 === sha256(expected), "patched content differs from expected");
});

await test("patch_page auto-extracts matching markers and rejects others", async () => {
  const ok = await call(hosted, "thincms_patch_page", { id: secPageId, section: "hero", content: "<!-- START:hero -->\n<h1>New hero</h1>\n<!-- END:hero -->" });
  assert(!ok.isError, ok.text);
  const bad = await call(hosted, "thincms_patch_page", { id: secPageId, section: "hero", content: "<!-- START:faq -->x<!-- END:faq -->" });
  assert(bad.isError && /section is "hero"/.test(bad.text), bad.text);
  const missing = await call(hosted, "thincms_patch_page", { id: secPageId, section: "nope", content: "x" });
  assert(missing.isError && /Sections found: hero, faq/.test(missing.text), missing.text);
});

console.log("\nDry runs");
await test("update_page dryRun reports the change, writes nothing, and leaves the upload usable", async () => {
  const before = (await call(hosted, "thincms_get_page", { id: secPageId, metadataOnly: true })).data.content.sha256;
  const next = Buffer.from("<main>replaced</main>");
  const { uploadId } = await stage(hosted, next, "p.html", "text/html");
  const dry = await call(hosted, "thincms_update_page", { id: secPageId, contentUploadId: uploadId, dryRun: true });
  assert(!dry.isError && dry.data.content.before.sha256 === before && dry.data.content.after.sha256 === sha256(next), dry.text);
  const after = (await call(hosted, "thincms_get_page", { id: secPageId, metadataOnly: true })).data.content.sha256;
  assert(after === before, "dry run wrote to the page");
  const real = await call(hosted, "thincms_update_page", { id: secPageId, contentUploadId: uploadId });
  assert(!real.isError && real.data._contentStats.sha256 === sha256(next), real.text);
});

await test("a dry run on a live site needs no confirmProductionWrite", async () => {
  assert(!(await call(hosted, "thincms_update_page", { id: secPageId, content: sectioned })).isError, "setup failed");
  const dry = await call(liveSite, "thincms_patch_page", { id: secPageId, section: "hero", content: "<p>x</p>", dryRun: true });
  assert(!dry.isError && dry.data.dryRun === true, dry.text);
});

console.log("\nTemplate sections");
await test("patch_css patches a multi-line-marker section; patch_template patches customHeadHtml", async () => {
  const tpl = await call(hosted, "thincms_get_template", {});
  const original = { stylesheet: tpl.data.stylesheet, customHeadHtml: tpl.data.customHeadHtml };
  try {
    const css = original.stylesheet + "\n/* START:thincms-wrapper-overrides\n   Overrides. Keep last. */\n.w{max-width:60rem}\n/* END:thincms-wrapper-overrides */\n";
    const head = (original.customHeadHtml || "") + "\n<!-- START:fonts -->\n<link rel=x>\n<!-- END:fonts -->\n";
    assert(!(await call(hosted, "thincms_update_template", { stylesheet: css, customHeadHtml: head })).isError, "setup failed");

    const listed = await call(hosted, "thincms_get_template", { sections: true });
    assert(listed.data.stylesheet.sections.some((x: any) => x.name === "thincms-wrapper-overrides"), listed.text.slice(0, 500));
    assert(listed.data.customHeadHtml.sections.some((x: any) => x.name === "fonts"), "fonts section not listed");

    const p1 = await call(hosted, "thincms_patch_css", { section: "thincms-wrapper-overrides", css: ".w{max-width:72rem}" });
    assert(!p1.isError, p1.text);
    const p2 = await call(hosted, "thincms_patch_template", { component: "customHeadHtml", section: "fonts", content: "<link rel=y>" });
    assert(!p2.isError, p2.text);

    const now = await call(hosted, "thincms_get_template", {});
    assert(now.data.stylesheet.includes("Overrides. Keep last. */\n.w{max-width:72rem}\n/* END:thincms-wrapper-overrides */"), "css patch wrong");
    assert(now.data.customHeadHtml.includes("<!-- START:fonts -->\n<link rel=y>\n<!-- END:fonts -->"), "head patch wrong");

    const frame = await call(hosted, "thincms_patch_template", { component: "pageFrame", section: "nope", content: "x", dryRun: true });
    assert(frame.isError && /Section markers not found/.test(frame.text), frame.text);
  } finally {
    await call(hosted, "thincms_update_template", { stylesheet: original.stylesheet, customHeadHtml: original.customHeadHtml ?? "" });
  }
});

await test("update_template dryRun reports per-field changes without writing", async () => {
  const meta = await call(hosted, "thincms_get_template", { metadataOnly: true });
  const dry = await call(hosted, "thincms_update_template", { customHeadHtml: "<!-- dry -->", dryRun: true });
  assert(!dry.isError && dry.data.dryRun && dry.data.customHeadHtml.after.sha256 === sha256("<!-- dry -->") && dry.data.stylesheet.unchanged, dry.text);
  const after = await call(hosted, "thincms_get_template", { metadataOnly: true });
  assert(after.data.customHeadHtml.sha256 === meta.data.customHeadHtml.sha256, "dry run wrote");
});

console.log("\nDownload links");
await test("get_page asDownload gives a single-use link to the exact HTML", async () => {
  const r = await call(hosted, "thincms_get_page", { id: pageId, asDownload: true });
  assert(!r.isError && r.data.downloads.length === 1, r.text);
  const d = r.data.downloads[0];
  const res = await fetch(d.downloadUrl);
  const body = Buffer.from(await res.arrayBuffer());
  assert(res.ok && sha256(body) === d.sha256, `download hash ${sha256(body)} vs ${d.sha256}`);
  assert((await fetch(d.downloadUrl)).status === 409, "second fetch not refused");
});

await test("get_template asDownload returns three files matching metadataOnly hashes", async () => {
  const r = await call(hosted, "thincms_get_template", { asDownload: true });
  const meta = await call(hosted, "thincms_get_template", { metadataOnly: true });
  assert(r.data.downloads.map((d: any) => d.filename).join() === "stylesheet.css,pageFrame.html,customHeadHtml.html", r.text);
  for (const d of r.data.downloads) {
    const body = Buffer.from(await (await fetch(d.downloadUrl)).arrayBuffer());
    assert(sha256(body) === meta.data[d.field].sha256, `${d.field} hash differs`);
  }
});

await test("export_subscribers_csv asDownload returns a link", async () => {
  const r = await call(hosted, "thincms_export_subscribers_csv", { asDownload: true });
  assert(!r.isError && r.data.downloads[0].filename === "subscribers.csv", r.text);
  assert((await fetch(r.data.downloads[0].downloadUrl)).ok, "download failed");
});

console.log("\nCleanup");
await test("delete test page and media", async () => {
  if (pageId) assert(!(await call(hosted, "thincms_delete_page", { id: pageId })).isError, "page delete failed");
  if (mediaId) assert(!(await call(hosted, "thincms_delete_media", { id: mediaId })).isError, "media delete failed");
  if (secPageId) assert(!(await call(hosted, "thincms_delete_page", { id: secPageId })).isError, "sections page delete failed");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
