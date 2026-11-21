import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ThinCMSClient } from "./client.js";
import { loadConfig, type ThinCMSConfig } from "./config.js";
import { registerAllTools } from "./tools/index.js";
import type { ToolGate } from "./tool-rights.js";
import { getMcpVersion } from "./helpers.js";

// stdio: config comes from env. Hosted: one server per user session, built
// from that user's token and permitted sites (see http.ts).
export function createServer(config: ThinCMSConfig = loadConfig()): { server: McpServer; client: ThinCMSClient; gate: ToolGate } {
  const client = new ThinCMSClient(config);

  const server = new McpServer({
    name: "thincms-mcp",
    version: getMcpVersion(),
  });

  const gate = registerAllTools(server, client);
  // List only the tools the user's rights allow on the active site (P-3).
  // Re-applied when the active site or the rights change.
  gate.onChange(() => server.sendToolListChanged());
  client.onSiteContextChange(() => gate.apply(client.getActiveRights()));
  gate.apply(client.getActiveRights());

  return { server, client, gate };
}
