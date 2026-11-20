import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, formatText, siteAwareTool } from "../helpers.js";

// Read-only user tools (P-8). Changing users or rights stays in the admin
// panel: the REST API refuses user changes from API keys and MCP tokens.
export function registerUserTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client,
    "thincms_list_users",
    "List the people with access to this site: email, name, role, MCP access, whether their access is customised, and their effective rights per area (content, marketing, courses, tools, reviews, chat, analytics, documents, administration: none/view/edit/manage) in the admin panel and through MCP. Also lists pending invitations. Read-only: change users and rights in Admin > Users.",
    {},
    async () => formatResult(await client.get("/users")),
  );

  siteAwareTool(server, client,
    "thincms_get_user_rights",
    "Show one person's access to this site by area, in the admin panel and through MCP, including the Documents permissions (void a signature, bulk export). Find them by email. Read-only.",
    {
      email: z.string().describe("The person's email address (case-insensitive)"),
    },
    async ({ email }) => {
      const result = await client.get("/users");
      if (!result.ok) return formatResult(result);
      const needle = email.trim().toLowerCase();
      const user = (result.data?.users || []).find((u: any) => String(u.email).toLowerCase() === needle);
      if (!user) {
        const invited = (result.data?.invitations || []).some((i: any) => String(i.email).toLowerCase() === needle);
        return formatText(
          invited
            ? `${email} has a pending invitation but hasn't signed in yet, so has no rights on this site.`
            : `${email} has no access to this site.`,
        );
      }
      const { email: e, name, role, mcpEnabled, mcpRole, moduleRights, mcpModuleRights, rights, mcpRights } = user;
      return formatResult({
        ok: true,
        status: 200,
        data: {
          email: e, name, role,
          customised: !!(moduleRights || mcpModuleRights),
          adminPanel: rights,
          mcp: mcpEnabled ? { level: mcpRole || "editor", rights: mcpRights } : "off",
        },
      });
    },
  );
}
