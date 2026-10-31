import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerUploadTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client,
    "thincms_prepare_upload",
    "Prepare a staged upload so a large file reaches ThinCMS without its bytes passing through the model — the way to push big pages, stylesheets, templates and media on the hosted server.\n\n" +
    "1. Call this with the file's name, content type, size and sha256 (`wc -c < file`, `shasum -a 256 file`).\n" +
    "2. From your shell: curl -fsS -X PUT --data-binary @<file> \"<uploadUrl>\" — returns {uploadId, bytes, sha256}.\n" +
    "3. Pass uploadId to the write tool's *UploadId parameter (contentUploadId, stylesheetUploadId, pageFrameUploadId, customHeadHtmlUploadId, cssUploadId, htmlContentUploadId, htmlUploadId, fieldsUploadId) or to upload_media / upload_lesson_attachment as uploadId.\n\n" +
    "The uploadUrl needs no auth header, works once, and expires after 15 minutes; each upload can be used by one write. Limits: 5 MB for text types, 25 MB otherwise. If you declare sha256 or bytes, a PUT that doesn't match is rejected. Text uploads must be UTF-8.",
    {
      filename: z.string().describe("File name, e.g. stylesheet.css (used as the media filename for uploads to the library)"),
      contentType: z.string().describe("MIME type, e.g. text/css, text/html, application/json, image/jpeg, video/mp4"),
      bytes: z.number().int().nonnegative().optional().describe("Exact file size in bytes. Recommended: the PUT must match."),
      sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).optional().describe("Hex sha256 of the file. Recommended: the PUT is rejected if the received bytes hash differently."),
    },
    async (params) => {
      const result = await client.prepareUpload(params);
      if (result.ok) {
        result.data = {
          ...result.data,
          next: `curl -fsS -X PUT --data-binary @${params.filename} "${result.data.uploadUrl}"`,
        };
      }
      return formatResult(result);
    }
  );
}
