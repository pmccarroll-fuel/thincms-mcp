import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildLessonBody } from "../src/tools/lessons.js";
import type { ThinCMSClient } from "../src/client.js";

const client = { isRemote: () => false, checkProductionWrite: () => null } as unknown as ThinCMSClient;

describe("buildLessonBody (CR 1: lesson content was dropped)", () => {
  it("maps contentBefore / contentAfter / video to the REST field names", async () => {
    const r = await buildLessonBody(client, {
      moduleId: "m1",
      title: "Intro",
      contentBefore: "<p>before</p>",
      contentAfter: "<p>after</p>",
      videoEmbed: "https://player.vimeo.com/video/1",
      videoPlatform: "vimeo",
      duration: 600,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body).toEqual({
        moduleId: "m1",
        title: "Intro",
        contentBefore: "<p>before</p>",
        description: "<p>after</p>",
        videoEmbed: "https://player.vimeo.com/video/1",
        videoPlatform: "vimeo",
        duration: 600,
      });
      expect(r.body).not.toHaveProperty("content");
      expect(r.body).not.toHaveProperty("videoUrl");
    }
  });

  it("reads contentAfterFile in stdio mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lb-"));
    await writeFile(join(dir, "after.html"), "<h2>Section 3</h2>");
    const r = await buildLessonBody(client, { contentAfterFile: join(dir, "after.html") });
    expect(r.ok && r.body).toEqual({ description: "<h2>Section 3</h2>" });
  });

  it("omits content fields that were not given (partial update)", async () => {
    const r = await buildLessonBody(client, { title: "Renamed" });
    expect(r.ok && r.body).toEqual({ title: "Renamed" });
  });

  it("refuses two sources for the same field", async () => {
    const r = await buildLessonBody(client, { contentAfter: "<p>x</p>", contentAfterFile: "/tmp/x.html" });
    expect(r.ok).toBe(false);
  });
});
