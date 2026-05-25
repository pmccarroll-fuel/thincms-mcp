import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ThinCMSClient } from "../client.js";
import { formatText, getMcpVersion, getRegisteredTools } from "../helpers.js";

export function registerCapabilitiesTool(server: McpServer, _client: ThinCMSClient) {
  server.tool(
    "thincms_capabilities",
    "Inspect the running MCP wrapper: version, count of registered tools, and the live tool list. Use to detect when your MCP host has cached a stale tool surface — if the count or list doesn't match what you expect for the current wrapper version, restart your host (Claude Desktop / Claude Code / VS Code) so it re-handshakes with the wrapper.",
    {},
    async () => {
      const tools = getRegisteredTools();
      const payload = {
        wrapperVersion: getMcpVersion(),
        registeredToolCount: tools.length,
        registeredTools: tools.sort(),
      };
      return formatText(JSON.stringify(payload, null, 2));
    },
  );
}
