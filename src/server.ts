import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ThinCMSClient } from "./client.js";
import { loadConfig, type ThinCMSConfig } from "./config.js";
import { registerAllTools } from "./tools/index.js";
import { getMcpVersion } from "./helpers.js";

// stdio: config comes from env. Hosted: one server per user session, built
// from that user's token and permitted sites (see http.ts).
export function createServer(config: ThinCMSConfig = loadConfig()): { server: McpServer; client: ThinCMSClient } {
  const client = new ThinCMSClient(config);

  const server = new McpServer({
    name: "thincms-mcp",
    version: getMcpVersion(),
  });

  registerAllTools(server, client);

  return { server, client };
}
