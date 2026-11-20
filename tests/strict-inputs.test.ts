import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "../src/tools/index.js";
import type { ThinCMSClient } from "../src/client.js";

// CR 17: unknown tool parameters used to be stripped silently (e.g. `content`
// on thincms_update_lesson returned success and stored nothing).
describe("strict tool inputs", () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerAllTools(server, {} as unknown as ThinCMSClient);
  const tools = (server as any)._registeredTools as Record<string, { inputSchema?: any }>;

  it("rejects an unknown parameter and names it", () => {
    const r = tools["thincms_update_lesson"].inputSchema.safeParse({ id: "l1", content: "<p>x</p>" });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error.issues)).toContain("content");
  });

  it("accepts known parameters, including the shared siteId and releaseId", () => {
    const r = tools["thincms_update_lesson"].inputSchema.safeParse({ id: "l1", contentAfter: "<p>x</p>", siteId: "s", releaseId: "r", requiredForCompletion: false });
    expect(r.success).toBe(true);
  });

  it("applies to every tool, including ones without parameters", () => {
    for (const [name, t] of Object.entries(tools)) {
      if (!t.inputSchema) continue;
      expect(t.inputSchema.safeParse({ __nope: 1 }).success, name).toBe(false);
    }
    expect(tools["thincms_list_sites"].inputSchema.safeParse({}).success).toBe(true);
  });

  it("registers the section tools", () => {
    for (const n of ["thincms_create_section", "thincms_list_sections", "thincms_update_section", "thincms_delete_section", "thincms_reorder_sections"]) {
      expect(tools[n], n).toBeDefined();
    }
  });

  it("registers the documents tools with strict recipient objects", () => {
    for (const n of [
      "thincms_list_document_types", "thincms_get_document_type", "thincms_create_document_type", "thincms_update_document_type",
      "thincms_create_document", "thincms_update_document", "thincms_preview_document", "thincms_send_document",
      "thincms_get_document", "thincms_list_documents", "thincms_list_document_events", "thincms_resend_document", "thincms_withdraw_document",
    ]) {
      expect(tools[n], n).toBeDefined();
    }
    const create = tools["thincms_create_document"].inputSchema;
    const base = { type: "engagement", title: "Letter", html: "<!doctype html><html><body>x</body></html>", confirmProductionWrite: true };
    expect(create.safeParse({ ...base, recipients: [{ name: "Ann", email: "ann@example.com" }, { name: "Bo", email: "bo@example.com", role: "cc" }] }).success).toBe(true);
    expect(create.safeParse({ ...base, recipients: [{ name: "Ann", email: "ann@example.com", phone: "1" }] }).success).toBe(false);
    expect(create.safeParse({ ...base, recipients: [] }).success).toBe(false);
    expect(create.safeParse({ ...base, recipients: [{ name: "Ann", email: "ann@example.com" }], authMethod: "sms" }).success).toBe(false);
    expect(tools["thincms_void_document"]).toBeUndefined();
  });
});
