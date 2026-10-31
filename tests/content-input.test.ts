import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveContentInput, checkExpectedHash, contentStats } from "../src/helpers.js";
import type { ThinCMSClient } from "../src/client.js";

const NAMES = { inline: "content", file: "contentFile", upload: "contentUploadId" };

function fakeClient(opts: { remote: boolean; upload?: Uint8Array; guard?: any }) {
  const consumeUpload = vi.fn(async () =>
    opts.upload
      ? { ok: true as const, bytes: opts.upload.buffer as ArrayBuffer, filename: "f", contentType: "text/html", sha256: "" }
      : { ok: false as const, result: { ok: false, status: 409, data: { error: "Upload has already been used" } } },
  );
  const client = {
    isRemote: () => opts.remote,
    checkProductionWrite: () => opts.guard ?? null,
    consumeUpload,
  } as unknown as ThinCMSClient;
  return { client, consumeUpload };
}

describe("resolveContentInput", () => {
  it("refuses file paths on the hosted server without reading them", async () => {
    const { client } = fakeClient({ remote: true });
    const r = await resolveContentInput(client, { file: "/etc/hostname" }, NAMES);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.data.error).toMatch(/aren't available on the hosted server.*contentUploadId/);
      expect(r.error.data.error).not.toMatch(/ENOENT/);
    }
  });

  it("reads local files in stdio mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ci-"));
    await writeFile(join(dir, "p.html"), "<p>hi</p>");
    const { client } = fakeClient({ remote: false });
    expect(await resolveContentInput(client, { file: join(dir, "p.html") }, NAMES)).toEqual({ ok: true, value: "<p>hi</p>" });
  });

  it("rejects more than one source", async () => {
    const { client } = fakeClient({ remote: false });
    const r = await resolveContentInput(client, { inline: "x", uploadId: "u1" }, NAMES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.data.error).toBe("Provide only one of content, contentUploadId");
  });

  it("passes inline content and absence straight through", async () => {
    const { client } = fakeClient({ remote: true });
    expect(await resolveContentInput(client, { inline: "" }, NAMES)).toEqual({ ok: true, value: "" });
    expect(await resolveContentInput(client, {}, NAMES)).toEqual({ ok: true, value: undefined });
  });

  it("decodes uploads as UTF-8, keeping a BOM so hashes still match the file", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("body{}")]);
    const { client } = fakeClient({ remote: true, upload: bytes });
    const r = await resolveContentInput(client, { uploadId: "u1" }, NAMES);
    expect(r.ok && contentStats(r.value!).sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("rejects uploads that aren't valid UTF-8", async () => {
    const { client } = fakeClient({ remote: true, upload: new Uint8Array([0xff, 0xfe, 0x00]) });
    const r = await resolveContentInput(client, { uploadId: "u1" }, NAMES);
    expect(r.ok).toBe(false);
  });

  it("checks the production guard before consuming a single-use upload", async () => {
    const guard = { ok: false, status: 403, data: { error: "Refusing to write to production site" } };
    const { client, consumeUpload } = fakeClient({ remote: true, upload: new Uint8Array([1]), guard });
    const r = await resolveContentInput(client, { uploadId: "u1" }, NAMES);
    expect(r).toEqual({ ok: false, error: guard });
    expect(consumeUpload).not.toHaveBeenCalled();
  });

  it("surfaces API errors from consuming an upload", async () => {
    const { client } = fakeClient({ remote: true });
    const r = await resolveContentInput(client, { uploadId: "u1" }, NAMES);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.status).toBe(409);
  });
});

describe("checkExpectedHash", () => {
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");

  it("allows the write when the stored content still matches", () => {
    expect(checkExpectedHash("abc", sha("abc"), "content")).toBeNull();
    expect(checkExpectedHash("abc", sha("abc").toUpperCase(), "content")).toBeNull();
    expect(checkExpectedHash("abc", undefined, "content")).toBeNull();
  });

  it("refuses with the current hash when the content changed", () => {
    const r = checkExpectedHash("edited in admin", sha("abc"), "stylesheet");
    expect(r?.status).toBe(409);
    expect(r?.data.currentSha256).toBe(sha("edited in admin"));
  });
});
