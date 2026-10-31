/**
 * Live integration test against a running ThinCMS instance.
 * Tests core MCP tools end-to-end: list, create, update, delete.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

// Configure for local ThinCMS
process.env.THINCMS_BASE_URL = "http://localhost:3000";
process.env.THINCMS_API_KEY = "tcms_3221b8d7085f4c91919880d5f1d6b63a";
process.env.THINCMS_SITE_ID = "cmmd3v5bz0000it37ojv442kt";

const { server } = createServer();
const client = new Client({ name: "integration-test", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([
  server.connect(serverTransport),
  client.connect(clientTransport),
]);

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

function parseResult(result: any): any {
  const text = result.content?.[0]?.text;
  if (!text) throw new Error("No content in result");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertOk(result: any, context: string) {
  if (result.isError) {
    throw new Error(`${context}: ${result.content?.[0]?.text}`);
  }
}

console.log("\n=== ThinCMS MCP Integration Tests ===\n");

// -- Settings (read-only) --
console.log("Settings:");
await test("get settings", async () => {
  const result = await client.callTool({ name: "thincms_get_settings", arguments: {} });
  assertOk(result, "get settings");
  const data = parseResult(result);
  if (!data.settings?.name) throw new Error("No site name in settings");
  console.log(`    Site: ${data.settings.name}`);
});

// -- Template --
console.log("\nTemplate:");
await test("get template", async () => {
  const result = await client.callTool({ name: "thincms_get_template", arguments: {} });
  assertOk(result, "get template");
  const data = parseResult(result);
  if (typeof data.stylesheet !== "string") throw new Error("No stylesheet");
});

// -- Categories --
console.log("\nCategories:");
let testCategoryId: string;
await test("list categories", async () => {
  const result = await client.callTool({ name: "thincms_list_categories", arguments: {} });
  assertOk(result, "list categories");
});

await test("create category", async () => {
  const result = await client.callTool({
    name: "thincms_create_category",
    arguments: { name: "MCP Test Category", description: "Created by integration test" },
  });
  assertOk(result, "create category");
  const data = parseResult(result);
  testCategoryId = data.id;
  if (!testCategoryId) throw new Error("No category ID returned");
});

await test("update category", async () => {
  const result = await client.callTool({
    name: "thincms_update_category",
    arguments: { id: testCategoryId, description: "Updated by integration test" },
  });
  assertOk(result, "update category");
});

// -- Authors --
console.log("\nAuthors:");
let testAuthorId: string;
await test("list authors", async () => {
  const result = await client.callTool({ name: "thincms_list_authors", arguments: {} });
  assertOk(result, "list authors");
});

await test("create author", async () => {
  const result = await client.callTool({
    name: "thincms_create_author",
    arguments: { name: "MCP Test Author", bio: "Created by integration test" },
  });
  assertOk(result, "create author");
  const data = parseResult(result);
  testAuthorId = data.id;
  if (!testAuthorId) throw new Error("No author ID returned");
});

// -- Tags --
console.log("\nTags:");
await test("list tags", async () => {
  const result = await client.callTool({ name: "thincms_list_tags", arguments: {} });
  assertOk(result, "list tags");
});

await test("create tag", async () => {
  const result = await client.callTool({
    name: "thincms_create_tag",
    arguments: { name: "mcp-test-tag" },
  });
  assertOk(result, "create tag");
});

// -- Posts --
console.log("\nPosts:");
let testPostId: string;
await test("list posts", async () => {
  const result = await client.callTool({ name: "thincms_list_posts", arguments: {} });
  assertOk(result, "list posts");
  const data = parseResult(result);
  console.log(`    Found ${data.posts?.length || 0} posts`);
});

await test("create post", async () => {
  const result = await client.callTool({
    name: "thincms_create_post",
    arguments: {
      title: "MCP Integration Test Post",
      content: "<p>This post was created by the ThinCMS MCP server integration test.</p>",
      status: "draft",
      authorId: testAuthorId,
      categoryIds: [testCategoryId],
      tags: ["mcp-test-tag", "integration-test"],
    },
  });
  assertOk(result, "create post");
  const data = parseResult(result);
  testPostId = data.id;
  if (!testPostId) throw new Error("No post ID returned");
  console.log(`    Created post: ${data.slug}`);
});

await test("get post", async () => {
  const result = await client.callTool({
    name: "thincms_get_post",
    arguments: { id: testPostId },
  });
  assertOk(result, "get post");
  const data = parseResult(result);
  if (data.title !== "MCP Integration Test Post") throw new Error("Title mismatch");
});

await test("update post", async () => {
  const result = await client.callTool({
    name: "thincms_update_post",
    arguments: {
      id: testPostId,
      content: "<p>Updated by MCP integration test.</p>",
      excerpt: "Test excerpt",
    },
  });
  assertOk(result, "update post");
});

// -- Pages --
console.log("\nPages:");
let testPageId: string;
await test("list pages", async () => {
  const result = await client.callTool({ name: "thincms_list_pages", arguments: {} });
  assertOk(result, "list pages");
  const data = parseResult(result);
  console.log(`    Found ${data.pages?.length || 0} pages`);
});

await test("create page", async () => {
  const result = await client.callTool({
    name: "thincms_create_page",
    arguments: {
      title: "MCP Test Page",
      content: "<h1>MCP Test</h1><p>Created by integration test.</p>",
      status: "draft",
      renderMode: "wrapped",
    },
  });
  assertOk(result, "create page");
  const data = parseResult(result);
  testPageId = data.id;
  if (!testPageId) throw new Error("No page ID returned");
});

await test("update page", async () => {
  const result = await client.callTool({
    name: "thincms_update_page",
    arguments: { id: testPageId, metaDescription: "MCP test page" },
  });
  assertOk(result, "update page");
});

// -- Navigation --
console.log("\nNavigation:");
await test("get navigation", async () => {
  const result = await client.callTool({ name: "thincms_get_navigation", arguments: {} });
  assertOk(result, "get navigation");
});

// -- Scripts --
console.log("\nScripts:");
await test("list scripts", async () => {
  const result = await client.callTool({ name: "thincms_list_scripts", arguments: {} });
  assertOk(result, "list scripts");
});

// -- Forms --
console.log("\nForms:");
await test("list forms", async () => {
  const result = await client.callTool({ name: "thincms_list_forms", arguments: {} });
  assertOk(result, "list forms");
});

// -- Search --
console.log("\nSearch:");
await test("search", async () => {
  const result = await client.callTool({
    name: "thincms_search",
    arguments: { q: "test" },
  });
  assertOk(result, "search");
});

// -- Preview --
console.log("\nPreview:");
await test("create preview", async () => {
  const result = await client.callTool({
    name: "thincms_create_preview",
    arguments: { stylesheet: "body { color: red; }" },
  });
  assertOk(result, "create preview");
  const data = parseResult(result);
  if (!data.token) throw new Error("No preview token returned");
  console.log(`    Preview URL: ${data.previewUrl}`);
});

// -- Cleanup: delete test data --
console.log("\nCleanup:");
await test("delete post", async () => {
  const result = await client.callTool({
    name: "thincms_delete_post",
    arguments: { id: testPostId },
  });
  assertOk(result, "delete post");
});

await test("delete page", async () => {
  const result = await client.callTool({
    name: "thincms_delete_page",
    arguments: { id: testPageId },
  });
  assertOk(result, "delete page");
});

await test("delete category", async () => {
  const result = await client.callTool({
    name: "thincms_delete_category",
    arguments: { id: testCategoryId },
  });
  assertOk(result, "delete category");
});

await test("delete author", async () => {
  const result = await client.callTool({
    name: "thincms_delete_author",
    arguments: { id: testAuthorId },
  });
  assertOk(result, "delete author");
});

// -- Summary --
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

await client.close();
await server.close();

process.exit(failed > 0 ? 1 : 0);
