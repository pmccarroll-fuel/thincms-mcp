import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerTemplateTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_get_template",
    "Get the site's template: stylesheet (CSS), pageFrame (HTML wrapper with template tags like {{content}}, {{nav:header}}), and customHeadHtml.",
    {},
    async () => {
      const result = await client.get("/template");
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_template",
    "Update the site's template. Only provided fields are changed. The pageFrame must contain {{content}} if provided. Available template tags: {{content}}, {{nav:header}}, {{nav:footer}}, {{site:name}}, {{site:tagline}}, {{site:logo}}, {{year}}, {{search:form}}.",
    {
      stylesheet: z.string().optional().describe("CSS stylesheet for the public site"),
      pageFrame: z.string().optional().describe("HTML page frame with template tags (must include {{content}})"),
      customHeadHtml: z.string().optional().describe("Custom HTML injected into <head> (fonts, meta tags, etc.)"),
    },
    async (params) => {
      const result = await client.put("/template", params);
      return formatResult(result);
    }
  );
}
