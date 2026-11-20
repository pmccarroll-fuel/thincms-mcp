import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ThinCMSClient } from "../client.js";
import { formatText, getMcpVersion } from "../helpers.js";
import type { ToolGate } from "../tool-rights.js";

export function registerCapabilitiesTool(server: McpServer, _client: ThinCMSClient, gate: ToolGate) {
  server.tool(
    "thincms_capabilities",
    "Inspect the running MCP wrapper: version, count of tools available to you on the active site, and the live tool list (tools your access level on this site doesn't allow are not listed). Use to detect when your MCP host has cached a stale tool surface — if the count or list doesn't match what you expect for the current wrapper version, restart your host (Claude Desktop / Claude Code / VS Code) so it re-handshakes with the wrapper.",
    {},
    async () => {
      // This session's enabled tools: depends on your rights on the active site.
      const tools = gate.enabledNames();
      const payload = {
        wrapperVersion: getMcpVersion(),
        registeredToolCount: tools.length,
        registeredTools: tools.sort(),
      };
      return formatText(JSON.stringify(payload, null, 2));
    },
  );
}
