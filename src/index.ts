import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const { server, client } = createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
// Narrow the tool list to each API key's module limits once connected.
client.loadApiKeyRights().catch(() => {});
