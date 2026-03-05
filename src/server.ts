import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ThinCMSClient } from "./client.js";
import { loadConfig } from "./config.js";
import { registerAllTools } from "./tools/index.js";

export function createServer(): McpServer {
  const config = loadConfig();
  const client = new ThinCMSClient(config);

  const server = new McpServer({
    name: "thincms-mcp",
    version: "1.0.0",
  });

  registerAllTools(server, client);

  return server;
}
