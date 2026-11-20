import { describe, it, expect } from "vitest";
import { requiredLevel, allows, ToolGate } from "../src/tool-rights.js";
import { createServer } from "../src/server.js";

describe("requiredLevel", () => {
  it("reads need view, writes need edit", () => {
    expect(requiredLevel("thincms_list_posts")).toBe("view");
    expect(requiredLevel("thincms_get_release_schedule")).toBe("view");
    expect(requiredLevel("thincms_create_post")).toBe("edit");
    expect(requiredLevel("thincms_chat_update_handover")).toBe("edit");
    expect(requiredLevel("thincms_analytics_annotations_create")).toBe("edit");
    expect(requiredLevel("thincms_go_live")).toBe("edit");
    expect(requiredLevel("thincms_list_deleted")).toBe("view");
    expect(requiredLevel("thincms_get_settings")).toBe("view");
  });
});

describe("allows", () => {
  it("needs the module at the level; null module and missing rights always pass", () => {
    expect(allows({ content: "view" }, "content", "view")).toBe(true);
    expect(allows({ content: "view" }, "content", "edit")).toBe(false);
    expect(allows({ content: "edit" }, "documents", "view")).toBe(false);
    expect(allows({}, null, "edit")).toBe(true);
    expect(allows(undefined, "documents", "edit")).toBe(true);
  });
});

describe("session tool list (P-3)", () => {
  function hosted(rights: Record<string, string>) {
    return createServer({
      baseUrl: "http://127.0.0.1:1",
      siteId: "s1",
      sites: [{ name: "One", siteId: "s1", rights: rights as any }, { name: "Two", siteId: "s2", rights: { content: "edit" } as any }],
      bearerToken: "x",
      remote: true,
      ownerId: "u",
      productionSiteIds: [],
    });
  }

  it("hides tools for modules with none and writes for view-only", () => {
    const { gate } = hosted({ content: "view", marketing: "none" });
    const names = gate.enabledNames();
    expect(names).toContain("thincms_list_posts");
    expect(names).not.toContain("thincms_create_post");
    expect(names.some((n) => n.includes("campaign"))).toBe(false);
    expect(names).toContain("thincms_switch_site");
    expect(names).toContain("thincms_capabilities");
    expect(names).not.toContain("thincms_go_live");
  });

  it("re-gates when the active site changes", () => {
    const { gate, client } = hosted({ content: "view" });
    expect(gate.enabledNames()).not.toContain("thincms_create_post");
    client.switchSite("Two");
    expect(gate.enabledNames()).toContain("thincms_create_post");
  });

  it("local API-key mode (no rights) lists everything", () => {
    const { gate } = createServer({
      baseUrl: "http://127.0.0.1:1", apiKey: "k", siteId: "s1",
      sites: [{ name: "One", siteId: "s1", apiKey: "k" }], productionSiteIds: [],
    });
    expect(gate.enabledNames()).toContain("thincms_create_post");
  });

  it("refuses a call aimed at another site the user has fewer rights on", () => {
    const g = new ToolGate();
    g.add("thincms_create_post", { enabled: true }, "content");
    expect(g.check("thincms_create_post", { content: "view" })).toEqual({ ok: false, module: "content", level: "edit" });
    expect(g.check("thincms_create_post", { content: "edit" })).toEqual({ ok: true });
  });
});
