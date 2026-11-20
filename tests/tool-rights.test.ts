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

  it("documents tools: reads need view, the rest need edit", () => {
    for (const n of ["thincms_list_document_types", "thincms_get_document_type", "thincms_get_document", "thincms_list_documents", "thincms_list_document_events"]) {
      expect(requiredLevel(n), n).toBe("view");
    }
    for (const n of ["thincms_create_document_type", "thincms_update_document_type", "thincms_create_document", "thincms_update_document", "thincms_preview_document", "thincms_send_document", "thincms_resend_document", "thincms_withdraw_document"]) {
      expect(requiredLevel(n), n).toBe("edit");
    }
    // "preview" as a write verb leaves the existing preview tools where they were.
    expect(requiredLevel("thincms_get_preview_url")).toBe("view");
    expect(requiredLevel("thincms_get_post_preview_url")).toBe("view");
    expect(requiredLevel("thincms_get_release_preview_link")).toBe("view");
    expect(requiredLevel("thincms_create_preview")).toBe("edit");
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

import { isNonLiveDocumentPath } from "../src/client.js";
describe("documents: levels and production-write exemptions", () => {
  it("type changes need manage; documents edit only sees the rest", () => {
    const g = new ToolGate();
    for (const n of ["thincms_create_document_type", "thincms_update_document_type", "thincms_create_document", "thincms_list_document_types"]) g.add(n, { enabled: true }, "documents");
    g.apply({ documents: "edit" });
    expect(g.enabledNames().sort()).toEqual(["thincms_create_document", "thincms_list_document_types"]);
    g.apply({ documents: "manage" });
    expect(g.enabledNames()).toHaveLength(4);
  });
  it("drafts, previews and types skip the production confirmation; send/resend/withdraw don't", () => {
    for (const p of ["/documents", "/documents/abc", "/documents/abc/preview", "/document-types", "/document-types/letter"]) expect(isNonLiveDocumentPath(p), p).toBe(true);
    for (const p of ["/documents/abc/send", "/documents/abc/resend", "/documents/abc/withdraw", "/pages", "/documents/abc/void"]) expect(isNonLiveDocumentPath(p), p).toBe(false);
  });
});
