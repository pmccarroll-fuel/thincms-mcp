import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import {
  formatResult, formatText, siteAwareTool, resolveContentInput, contentStats, checkExpectedHash,
  metadataOnly, uploadIdField, LOCAL_ONLY, EXPECTED_SHA_FIELD, METADATA_ONLY_FIELD,
  AS_DOWNLOAD_FIELD, downloadLinks, dryRunField, DRY_RUN_REPLACE_FIELD,
} from "../helpers.js";

const DOWNLOAD_FILES = {
  stylesheet: { filename: "stylesheet.css", contentType: "text/css" },
  pageFrame: { filename: "pageFrame.html", contentType: "text/html" },
  customHeadHtml: { filename: "customHeadHtml.html", contentType: "text/html" },
} as const;

const TEMPLATE_FIELDS = ["stylesheet", "pageFrame", "customHeadHtml"] as const;
const CSS_NAMES = { inline: "css", file: "cssFile", upload: "cssUploadId" };

export function registerTemplateTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client,
    "thincms_get_template",
    "Get the site's template: stylesheet (CSS), pageFrame (HTML wrapper with template tags like {{content}}, {{nav:header}}), and customHeadHtml. Options: metadataOnly=true returns bytes/sha256 per field instead of the content; asDownload=true returns single-use download links (stylesheet.css, pageFrame.html, customHeadHtml.html); sections=true lists the named START:/END: sections in each field with their sizes.",
    {
      metadataOnly: METADATA_ONLY_FIELD,
      asDownload: AS_DOWNLOAD_FIELD,
      sections: z.boolean().optional().describe("List the named sections in each template field (for thincms_patch_css / thincms_patch_template) instead of returning the content."),
    },
    async (params) => {
      if (params.sections) {
        const out: Record<string, any> = {};
        for (const component of TEMPLATE_FIELDS) {
          const res = await client.get("/template/sections", { component });
          if (!res.ok) return formatResult(res);
          const { component: _c, ...rest } = res.data;
          out[component] = rest;
        }
        return formatResult({ ok: true, status: 200, data: out });
      }
      const result = await client.get("/template");
      if (!result.ok) return formatResult(result);
      if (params.asDownload) {
        return downloadLinks(client, TEMPLATE_FIELDS.map((field) => ({
          field,
          ...DOWNLOAD_FILES[field],
          content: result.data[field] ?? "",
        })));
      }
      if (params.metadataOnly) result.data = metadataOnly(result.data, [...TEMPLATE_FIELDS]);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_update_template",
    "Update the site's template. Only provided fields are changed. The pageFrame must contain {{content}} if provided. For large files (>10KB), use the *File variants (local stdio server) or *UploadId variants (hosted server; see thincms_prepare_upload) instead of inlining content. The response gives bytes and sha256 per stored field — compare with `shasum -a 256` of your local files. Available template tags: {{content}}, {{nav:header}}, {{nav:footer}}, {{site:name}}, {{site:tagline}}, {{site:logo}}, {{year}}, {{search:form}}.",
    {
      stylesheet: z.string().optional().describe("CSS stylesheet for the public site"),
      stylesheetFile: z.string().optional().describe("Local file path containing the CSS stylesheet. Use instead of stylesheet for large files (>10KB)." + LOCAL_ONLY),
      stylesheetUploadId: uploadIdField("the CSS stylesheet"),
      expectedStylesheetSha256: EXPECTED_SHA_FIELD("stylesheet"),
      pageFrame: z.string().optional().describe("HTML page frame with template tags (must include {{content}})"),
      pageFrameFile: z.string().optional().describe("Local file path containing the page frame HTML. Use instead of pageFrame for large files." + LOCAL_ONLY),
      pageFrameUploadId: uploadIdField("the page frame HTML"),
      expectedPageFrameSha256: EXPECTED_SHA_FIELD("pageFrame"),
      customHeadHtml: z.string().optional().describe("Custom HTML injected into <head> (fonts, meta tags, etc.)"),
      customHeadHtmlFile: z.string().optional().describe("Local file path containing custom head HTML. Use instead of customHeadHtml for large files." + LOCAL_ONLY),
      customHeadHtmlUploadId: uploadIdField("the custom head HTML"),
      expectedCustomHeadHtmlSha256: EXPECTED_SHA_FIELD("customHeadHtml"),
      dryRun: DRY_RUN_REPLACE_FIELD,
    },
    async (params) => {
      const p = params as Record<string, any>;
      const dryRun = p.dryRun === true;
      const expected = TEMPLATE_FIELDS.map((f) => [f, p[`expected${f[0].toUpperCase()}${f.slice(1)}Sha256`]] as const);
      let current: Record<string, string> | undefined;
      if (dryRun || expected.some(([, sha]) => sha)) {
        const res = await client.get("/template");
        if (!res.ok) return formatResult(res);
        current = res.data;
        for (const [field, sha] of expected) {
          const conflict = checkExpectedHash(current?.[field], sha, field);
          if (conflict) return formatResult(conflict);
        }
      }

      const body: Record<string, string> = {};
      for (const field of TEMPLATE_FIELDS) {
        const resolved = await resolveContentInput(
          client,
          { inline: p[field], file: p[`${field}File`], uploadId: p[`${field}UploadId`] },
          { inline: field, file: `${field}File`, upload: `${field}UploadId` },
          { peek: dryRun },
        );
        if (!resolved.ok) return formatResult(resolved.error);
        if (resolved.value !== undefined) body[field] = resolved.value;
      }

      if (dryRun) {
        if (body.pageFrame !== undefined && !body.pageFrame.includes("{{content}}")) {
          return formatResult({ ok: false, status: 400, data: { error: "pageFrame must contain {{content}}" } });
        }
        const fields: Record<string, any> = {};
        for (const field of TEMPLATE_FIELDS) fields[field] = dryRunField(current?.[field], body[field]);
        return formatText(JSON.stringify({ dryRun: true, fieldsUpdated: Object.keys(body), ...fields }, null, 2));
      }

      const result = await client.put("/template", body);
      if (!result.ok) return formatResult(result);
      // Server echoes the full template back (potentially many KB). Return a
      // summary instead — agents that need the full content can call
      // thincms_get_template or thincms_template_status separately.
      const data = result.data as Record<string, string>;
      const summary = {
        success: true,
        fieldsUpdated: Object.keys(body),
        stylesheet: contentStats(data.stylesheet || ""),
        pageFrame: contentStats(data.pageFrame || ""),
        customHeadHtml: contentStats(data.customHeadHtml || ""),
      };
      return formatText(JSON.stringify(summary, null, 2));
    }
  );

  siteAwareTool(server, client,
    "thincms_template_status",
    "Get the current template's stats (sha256, byte size, line count) for each field. Optionally compare against local files to verify a push landed correctly (local stdio server only — on the hosted server, compare the returned sha256 with `shasum -a 256` of your local files). Returns match/mismatch with size and line differences.",
    {
      compareStylesheetFile: z.string().optional().describe("Local CSS file to compare against the server's stylesheet" + LOCAL_ONLY),
      comparePageFrameFile: z.string().optional().describe("Local file to compare against the server's page frame" + LOCAL_ONLY),
      compareCustomHeadHtmlFile: z.string().optional().describe("Local file to compare against the server's custom head HTML" + LOCAL_ONLY),
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
        const serverStats = contentStats(serverContent);
        const entry: any = { server: serverStats };

        if (compareFile) {
          const local = await resolveContentInput(
            client,
            { file: compareFile },
            { inline: field, file: `compare${field[0].toUpperCase()}${field.slice(1)}File`, upload: "metadataOnly on thincms_get_template" },
          );
          if (!local.ok) {
            entry.local = { error: local.error.data.error };
            entry.match = false;
          } else {
            const localContent = local.value ?? "";
            const localStats = contentStats(localContent);
            entry.local = localStats;
            entry.match = serverContent === localContent;
            if (!entry.match) {
              entry.diff = {
                bytesDelta: serverStats.bytes - localStats.bytes,
                linesDelta: serverStats.lines - localStats.lines,
              };
            }
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

  siteAwareTool(server, client,
    "thincms_append_css",
    "Append CSS to the end of the site's existing stylesheet without replacing it. Useful for adding new rules without re-sending the entire stylesheet.",
    {
      css: z.string().optional().describe("CSS to append"),
      cssFile: z.string().optional().describe("Local file path containing CSS to append. Use instead of css for large additions." + LOCAL_ONLY),
      cssUploadId: uploadIdField("the CSS to append"),
      dryRun: z.boolean().optional().describe("When true, return the size delta the change would produce without writing. Use to sanity-check large appends before committing."),
    },
    async (params) => {
      const resolved = await resolveContentInput(client, { inline: params.css, file: params.cssFile, uploadId: params.cssUploadId }, CSS_NAMES, { peek: params.dryRun });
      if (!resolved.ok) return formatResult(resolved.error);
      const css = resolved.value;
      if (!css) {
        return formatResult({ ok: false, status: 0, data: { error: "Provide css, cssFile or cssUploadId" } });
      }
      const result = await client.patch("/template", { mode: "append", css, ...(params.dryRun ? { dryRun: true } : {}) });
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_patch_css",
    "Replace a named section of the stylesheet between comment markers. The stylesheet must contain /* START:<section> */ and /* END:<section> */ markers (the START comment may carry more text and span several lines). Only the content between these markers is replaced. List sections with thincms_get_template(sections=true). For the pageFrame or customHeadHtml use thincms_patch_template.\n\nIMPORTANT — what to send: pass ONLY the body to insert between the markers, not a full stylesheet. If your input contains its own START:<section> and END:<section> markers matching the same section name, the API will auto-extract the body for you. If it contains markers for a DIFFERENT section, the call is rejected to prevent silent doubling. Use dryRun=true on large patches to verify the size delta before committing.",
    {
      section: z.string().describe("Section name matching comment markers in the stylesheet (e.g., 'hero' matches /* START:hero */ ... /* END:hero */)"),
      css: z.string().optional().describe("Replacement CSS for the section. Send only the body content (not a full stylesheet)."),
      cssFile: z.string().optional().describe("Local file path containing replacement CSS. The file may contain matching START:/END: markers for the named section — if present, the body between them is auto-extracted. If the file contains markers for a different section, the call is rejected." + LOCAL_ONLY),
      cssUploadId: uploadIdField("the replacement CSS (same marker rules as cssFile)"),
      dryRun: z.boolean().optional().describe("When true, return the size delta the change would produce without writing. Strongly recommended before any large patch."),
    },
    async (params) => {
      const resolved = await resolveContentInput(client, { inline: params.css, file: params.cssFile, uploadId: params.cssUploadId }, CSS_NAMES, { peek: params.dryRun });
      if (!resolved.ok) return formatResult(resolved.error);
      const css = resolved.value;
      if (!css) {
        return formatResult({ ok: false, status: 0, data: { error: "Provide css, cssFile or cssUploadId" } });
      }
      const result = await client.patch("/template", { mode: "patch", section: params.section, css, ...(params.dryRun ? { dryRun: true } : {}) });
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_patch_template",
    "Replace one named section of a template field without resending the whole field: the pageFrame or customHeadHtml (HTML, <!-- START:<section> --> ... <!-- END:<section> --> comments) or the stylesheet (CSS, /* START:<section> */ ... /* END:<section> */). The START comment may carry more text and span lines; the comments are kept.\n\nSend ONLY the section body. Matching markers in your input are auto-extracted; markers for a different section are rejected. A patched pageFrame must still contain {{content}}. List sections with thincms_get_template(sections=true); use dryRun=true to check the size change first.",
    {
      component: z.enum(["pageFrame", "customHeadHtml", "stylesheet"]).describe("Template field to patch"),
      section: z.string().describe("Section name, e.g. 'header' for <!-- START:header --> ... <!-- END:header -->"),
      content: z.string().optional().describe("Replacement body for the section"),
      contentFile: z.string().optional().describe("Local file path containing the replacement body" + LOCAL_ONLY),
      contentUploadId: uploadIdField("the replacement body"),
      dryRun: z.boolean().optional().describe("Return the size change without writing. A staged upload used in a dry run stays usable."),
    },
    async (params) => {
      const resolved = await resolveContentInput(
        client,
        { inline: params.content, file: params.contentFile, uploadId: params.contentUploadId },
        { inline: "content", file: "contentFile", upload: "contentUploadId" },
        { peek: params.dryRun },
      );
      if (!resolved.ok) return formatResult(resolved.error);
      if (!resolved.value) {
        return formatResult({ ok: false, status: 0, data: { error: "Provide content, contentFile or contentUploadId" } });
      }
      const result = await client.patch("/template", {
        mode: "patch",
        component: params.component,
        section: params.section,
        content: resolved.value,
        ...(params.dryRun ? { dryRun: true } : {}),
      });
      return formatResult(result);
    }
  );
}
