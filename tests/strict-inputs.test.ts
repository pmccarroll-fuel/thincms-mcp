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
});
