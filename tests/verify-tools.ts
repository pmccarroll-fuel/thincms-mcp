/**
 * Quick verification: lists all registered tools and their schemas.
 * Run: THINCMS_BASE_URL=http://localhost:3000 THINCMS_API_KEY=test THINCMS_SITE_ID=test npx tsx tests/verify-tools.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";

async function main() {
  // Set dummy env vars for tool listing (no actual API calls)
  process.env.THINCMS_BASE_URL = process.env.THINCMS_BASE_URL || "http://localhost:3000";
  process.env.THINCMS_API_KEY = process.env.THINCMS_API_KEY || "tcms_test";
  process.env.THINCMS_SITE_ID = process.env.THINCMS_SITE_ID || "test_site";

  const server = createServer();
  const client = new Client({ name: "test-client", version: "1.0.0" });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  const result = await client.listTools();
  console.log(`\nTotal tools registered: ${result.tools.length}\n`);

  const groups: Record<string, string[]> = {};
  for (const tool of result.tools) {
    const prefix = tool.name.replace("thincms_", "").replace(/^(list|get|create|update|delete|bulk_create|upload|export|search)_/, "");
    const group = prefix || "other";
    if (!groups[group]) groups[group] = [];
    groups[group].push(tool.name);
  }

  for (const tool of result.tools) {
    const paramCount = tool.inputSchema?.properties ? Object.keys(tool.inputSchema.properties).length : 0;
    console.log(`  ${tool.name} (${paramCount} params)`);
  }

  await client.close();
  await server.close();
}

main().catch(console.error);
