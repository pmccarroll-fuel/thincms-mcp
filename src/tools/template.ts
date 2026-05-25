import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

function stats(str: string) {
  const bytes = Buffer.byteLength(str, "utf-8");
  const lines = str.split("\n").length;
  const hash = createHash("sha256").update(str).digest("hex").slice(0, 16);
  return { bytes, lines, hash };
}

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
    "Update the site's template. Only provided fields are changed. The pageFrame must contain {{content}} if provided. For large files (>10KB), use the File variants instead of inlining content. Available template tags: {{content}}, {{nav:header}}, {{nav:footer}}, {{site:name}}, {{site:tagline}}, {{site:logo}}, {{year}}, {{search:form}}.",
    {
      stylesheet: z.string().optional().describe("CSS stylesheet for the public site"),
      stylesheetFile: z.string().optional().describe("Local file path containing the CSS stylesheet. Use instead of stylesheet for large files (>10KB)."),
      pageFrame: z.string().optional().describe("HTML page frame with template tags (must include {{content}})"),
      pageFrameFile: z.string().optional().describe("Local file path containing the page frame HTML. Use instead of pageFrame for large files."),
      customHeadHtml: z.string().optional().describe("Custom HTML injected into <head> (fonts, meta tags, etc.)"),
      customHeadHtmlFile: z.string().optional().describe("Local file path containing custom head HTML. Use instead of customHeadHtml for large files."),
    },
    async (params) => {
      const { stylesheetFile, pageFrameFile, customHeadHtmlFile, ...body } = params;
      const fileMap: [string | undefined, string][] = [
        [stylesheetFile, "stylesheet"],
        [pageFrameFile, "pageFrame"],
        [customHeadHtmlFile, "customHeadHtml"],
      ];
      for (const [filePath, field] of fileMap) {
        if (filePath) {
          try {
            (body as any)[field] = await readFile(filePath, "utf-8");
          } catch (err: any) {
            return formatResult({ ok: false, status: 0, data: { error: `Failed to read ${field} file: ${err.message}` } });
          }
        }
      }
      const result = await client.put("/template", body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_template_status",
    "Get the current template's stats (hash, byte size, line count) for each field. Optionally compare against local files to verify a push landed correctly. Returns match/mismatch with size and line differences.",
    {
      compareStylesheetFile: z.string().optional().describe("Local CSS file to compare against the server's stylesheet"),
      comparePageFrameFile: z.string().optional().describe("Local file to compare against the server's page frame"),
      compareCustomHeadHtmlFile: z.string().optional().describe("Local file to compare against the server's custom head HTML"),
    },
    async (params) => {
      const result = await client.get("/template");
      if (!result.ok) return formatResult(result);

      const data = result.data as Record<string, string>;
      const output: Record<string, any> = {};

      const fields: [string, string | undefined][] = [
        ["stylesheet", params.compareStylesheetFile],
        ["pageFrame", params.comparePageFrameFile],
        ["customHeadHtml", params.compareCustomHeadHtmlFile],
      ];

      for (const [field, compareFile] of fields) {
        const serverContent = data[field] || "";
        const serverStats = stats(serverContent);
        const entry: any = { server: serverStats };

        if (compareFile) {
          try {
            const localContent = await readFile(compareFile, "utf-8");
            const localStats = stats(localContent);
            entry.local = localStats;
            entry.match = serverContent === localContent;
            if (!entry.match) {
              entry.diff = {
                bytesDelta: serverStats.bytes - localStats.bytes,
                linesDelta: serverStats.lines - localStats.lines,
              };
            }
          } catch (err: any) {
            entry.local = { error: `Failed to read file: ${err.message}` };
            entry.match = false;
          }
        }

        output[field] = entry;
      }

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(output, null, 2),
        }],
      };
    }
  );

  server.tool(
    "thincms_append_css",
    "Append CSS to the end of the site's existing stylesheet without replacing it. Useful for adding new rules without re-sending the entire stylesheet.",
    {
      css: z.string().optional().describe("CSS to append"),
      cssFile: z.string().optional().describe("Local file path containing CSS to append. Use instead of css for large additions."),
    },
    async (params) => {
      let css = params.css;
      if (params.cssFile) {
        try {
          css = await readFile(params.cssFile, "utf-8");
        } catch (err: any) {
          return formatResult({ ok: false, status: 0, data: { error: `Failed to read CSS file: ${err.message}` } });
        }
      }
      if (!css) {
        return formatResult({ ok: false, status: 0, data: { error: "Provide css or cssFile" } });
      }
      const result = await client.patch("/template", { mode: "append", css });
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_patch_css",
    "Replace a named section of the stylesheet between comment markers. The stylesheet must contain /* START:<section> */ and /* END:<section> */ markers. Only the content between these markers is replaced.",
    {
      section: z.string().describe("Section name matching comment markers in the stylesheet (e.g., 'hero' matches /* START:hero */ ... /* END:hero */)"),
      css: z.string().optional().describe("Replacement CSS for the section"),
      cssFile: z.string().optional().describe("Local file path containing replacement CSS. Use instead of css for large blocks."),
    },
    async (params) => {
      let css = params.css;
      if (params.cssFile) {
        try {
          css = await readFile(params.cssFile, "utf-8");
        } catch (err: any) {
          return formatResult({ ok: false, status: 0, data: { error: `Failed to read CSS file: ${err.message}` } });
        }
      }
      if (!css) {
        return formatResult({ ok: false, status: 0, data: { error: "Provide css or cssFile" } });
      }
      const result = await client.patch("/template", { mode: "patch", section: params.section, css });
      return formatResult(result);
    }
  );
}
