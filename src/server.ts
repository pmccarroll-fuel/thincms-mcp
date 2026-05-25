import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ThinCMSClient } from "./client.js";
import { loadConfig } from "./config.js";
import { registerAllTools } from "./tools/index.js";
import { getMcpVersion, setActiveClient } from "./helpers.js";

export function createServer(): McpServer {
  const config = loadConfig();
  const client = new ThinCMSClient(config);

  // Register the client globally so formatResult can stamp every response
  // with the active site name + wrapper version.
  setActiveClient(client);

  const server = new McpServer({
    name: "thincms-mcp",
    version: getMcpVersion(),
  });

  registerAllTools(server, client);

  return server;
}
