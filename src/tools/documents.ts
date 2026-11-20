import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

// Documents module (Level 1, M1): send a document to one person, who opens it
// through a private link after confirming who they are. Signing, voiding and
// the signed copy arrive in later milestones.

const HTML_RULES =
  "A full standalone HTML page (<!doctype html><html><head>…</head><body>…</body></html>), not a fragment: the site template is NOT applied. " +
  "Put all CSS in inline <style> blocks or style attributes and use system fonts. " +
  "Images must be in this site's Media library (src=\"/media/…\", or the site's own domain + /media/…; upload with thincms_upload_media first) or be data: URIs; they are embedded into the document when it is sent. " +
  "Nothing may load from the network: no external stylesheets (<link rel=stylesheet>), @import, scripts with src, web fonts, remote images, iframes, <base> or meta refresh. " +
  "Links (<a href>) to other sites are fine; they open in a new tab. " +
  "Problems are not checked here: thincms_preview_document and thincms_send_document report them (422 with a problems list). " +
  "Max 15 MB. <thincms-signature> is reserved for signing in a later release.";

const AUTH_METHOD = z.enum(["code", "google", "link"]);

const AUTH_METHOD_TEXT =
  "How recipients confirm who they are before the document opens: code (a six-digit code emailed to them; the default), google (sign in with the Google account for their email), or link (the link alone opens it). " +
  "link is only allowed when the document type itself is set to link, and never on a sensitive type.";

const RECIPIENT = z.object({
  name: z.string().describe("Recipient's name, shown in the email and on the document page"),
  email: z.string().describe("Recipient's email address; the link and any sign-in code go here"),
  role: z.enum(["signer", "cc"]).optional().describe('Default "signer". Exactly one recipient must be the signer; any others must be "cc" (they get their own link to view it).'),
  allowEmails: z.array(z.string()).optional().describe("Other email addresses this recipient may confirm with (e.g. a work and a personal Gmail for Google sign-in). The link is still sent only to email."),
}).strict();

const RECIPIENTS = z.array(RECIPIENT).min(1).describe(
  "Who receives the document. Level 1 allows exactly one signer, plus optional cc recipients. Each email may appear once.",
);

const TYPE_FIELDS = {
  description: z.string().optional().describe("What this type is for (admin-only)"),
  authMethod: AUTH_METHOD.optional().describe(AUTH_METHOD_TEXT + " This is the type's default; a document may switch between code and google but can only use link if the type is link."),
  sensitive: z.boolean().optional().describe("true if documents of this type contain sensitive personal data (health, finances, ID). A sensitive type can never use link-only access. Default false."),
  requiresSignature: z.boolean().optional().describe("Whether documents of this type will ask for a signature. Signing arrives in a later release; Level 1 documents are view-only either way. Default true."),
  expiryDays: z.number().int().min(1).max(365).optional().describe("Days a sent document's links stay open when the document has no expiresAt. Default 30."),
  retentionSignedDays: z.number().int().min(0).max(3650).optional().describe("Days to keep signed documents (default 90). Retention is applied in a later release."),
  retentionUnsignedDays: z.number().int().min(0).max(3650).optional().describe("Days to keep unsigned documents (default 30). Retention is applied in a later release."),
  consentText: z.string().optional().describe("Consent wording shown to the recipient (max 2000 characters)"),
};

export function registerDocumentTools(server: McpServer, client: ThinCMSClient) {
  // ── Types ──

  siteAwareTool(server, client,
    "thincms_list_document_types",
    "List this site's document types (e.g. Engagement letter, Privacy notice). Each type sets the default recipient sign-in method, whether it holds sensitive data, how long links stay open, and retention. Every document belongs to a type: create one with thincms_create_document_type if none fits.",
    {},
    async () => formatResult(await client.get("/document-types")),
  );

  siteAwareTool(server, client,
    "thincms_get_document_type",
    "Get one document type by id or slug.",
    { idOrSlug: z.string().describe("Document type id or slug") },
    async ({ idOrSlug }) => formatResult(await client.get(`/document-types/${encodeURIComponent(idOrSlug)}`)),
  );

  siteAwareTool(server, client,
    "thincms_create_document_type",
    "Create a document type. Do this once per kind of document, then reuse it for every document of that kind. Needs manage access to Documents (the API answers 403 otherwise). A slug that already exists returns 409.",
    {
      name: z.string().describe('Type name, e.g. "Engagement letter"'),
      slug: z.string().optional().describe("Lowercase letters, numbers and hyphens; generated from name when omitted. Used as the type reference in thincms_create_document."),
      ...TYPE_FIELDS,
    },
    async (params) => formatResult(await client.post("/document-types", params)),
  );

  siteAwareTool(server, client,
    "thincms_update_document_type",
    "Change a document type (send only the fields to change). Affects documents created afterwards; a stricter sign-in rule is also re-checked when an existing draft is sent. Needs manage access to Documents.",
    {
      idOrSlug: z.string().describe("Document type id or current slug"),
      name: z.string().optional(),
      slug: z.string().optional().describe("New slug (409 if taken)"),
      ...TYPE_FIELDS,
    },
    async ({ idOrSlug, ...body }) => formatResult(await client.put(`/document-types/${encodeURIComponent(idOrSlug)}`, body)),
  );

  // ── Documents ──

  siteAwareTool(server, client,
    "thincms_create_document",
    "Create a document as a draft. Nothing is sent. Workflow: create → thincms_preview_document → give the preview link to a person and wait for their approval → thincms_send_document. " +
      "To change a document that has already been sent, create a new one with replacesDocumentId (sent documents can't be edited); when the new one is sent, the old link shows \"replaced\". " +
      "Returns { document } with its id, status \"draft\" and recipients. 400 explains any invalid field.",
    {
      type: z.string().describe("Document type id or slug (thincms_list_document_types)"),
      title: z.string().describe("Title shown in the email subject and at the top of the document page (max 200 characters)"),
      html: z.string().describe(HTML_RULES),
      recipients: RECIPIENTS,
      authMethod: AUTH_METHOD.optional().describe(AUTH_METHOD_TEXT + " Omit to use the type's setting."),
      expiresAt: z.string().optional().describe("ISO 8601 with timezone, at least an hour away. Links stop working then. Omit to use the type's expiryDays, counted from sending."),
      message: z.string().optional().describe("A short personal note included in the invitation email (max 2000 characters)"),
      replacesDocumentId: z.string().optional().describe("Id of a sent, unsigned document this one replaces. The old one is withdrawn (link shows \"replaced\") when this one is sent."),
    },
    async (params) => formatResult(await client.post("/documents", params)),
  );

  siteAwareTool(server, client,
    "thincms_update_document",
    "Edit a DRAFT document; send only the fields to change. Sent documents can't be edited (409): create a new document with replacesDocumentId instead. recipients, when given, replaces the whole list. After changing the html, preview again before sending.",
    {
      id: z.string().describe("Document id"),
      title: z.string().optional(),
      html: z.string().optional().describe("The full replacement page. " + HTML_RULES),
      recipients: RECIPIENTS.optional(),
      authMethod: AUTH_METHOD.optional().describe(AUTH_METHOD_TEXT),
      expiresAt: z.string().nullable().optional().describe("ISO 8601 with timezone, at least an hour away; null to use the type's expiryDays"),
      message: z.string().nullable().optional().describe("Note in the invitation email; null or \"\" to remove"),
    },
    async ({ id, ...body }) => formatResult(await client.put(`/documents/${encodeURIComponent(id)}`, body)),
  );

  siteAwareTool(server, client,
    "thincms_preview_document",
    "Get a private preview link showing exactly what the recipient will see, valid for 2 hours. Give the link to the person who must approve the document, and send only after they approve it. " +
      "For a draft this also checks the html: if anything would stop it being sent, the call fails with 422 and a problems list (e.g. a remote image or stylesheet); fix them with thincms_update_document and preview again. " +
      "A new preview link replaces the previous one. Returns { url, expiresAt }.",
    { id: z.string().describe("Document id") },
    async ({ id }) => formatResult(await client.post(`/documents/${encodeURIComponent(id)}/preview`, {})),
  );

  siteAwareTool(server, client,
    "thincms_send_document",
    "Send a draft document to its recipients. Only call this after a person has approved the preview (thincms_preview_document). " +
      "Sending freezes the html (images from Media are embedded; it can never change afterwards), emails each recipient their private link, and starts the expiry clock. " +
      "On a live site this needs confirmProductionWrite: true (creating drafts, previews and types doesn't, as they reach no one). " +
      "Returns { document, links: [{ recipientId, name, email, role, url, emailSent }] }. Each link is returned only this once (only a hash is stored): if emailSent is false, the email failed, so give that person the url another way or use thincms_resend_document. " +
      "Errors: 409 if it isn't a draft (a document is sent once; use resend for a fresh link), 422 with problems if the html can't be frozen, 400 if the type's sign-in rules no longer allow the document's authMethod.",
    { id: z.string().describe("Document id") },
    async ({ id }) => formatResult(await client.post(`/documents/${encodeURIComponent(id)}/send`, {})),
  );

  siteAwareTool(server, client,
    "thincms_get_document",
    "Get one document: status (draft, sent, viewed, signed, declined, expired, withdrawn, voided), type, sign-in method, expiry, body hash once sent, replaces/replacedBy, and each recipient's status, viewedAt and the email they confirmed with. Links are never returned here.",
    {
      id: z.string().describe("Document id"),
      includeBody: z.boolean().optional().describe("Also return html: the draft for a draft, or the frozen body (images embedded) once sent. Can be large."),
    },
    async ({ id, includeBody }) => formatResult(await client.get(`/documents/${encodeURIComponent(id)}`, includeBody ? { includeBody: "1" } : undefined)),
  );

  siteAwareTool(server, client,
    "thincms_list_documents",
    "List documents, newest first, with recipients and status. Also returns pagination and awaitingSignature (documents sent or viewed but not finished).",
    {
      status: z.string().optional().describe("Filter by status; comma-separate several, e.g. \"sent,viewed\". Values: draft, sent, viewed, signed, declined, expired, withdrawn, voided"),
      type: z.string().optional().describe("Filter by document type id or slug"),
      page: z.number().int().min(1).optional().describe("Page number (default 1)"),
      limit: z.number().int().min(1).max(200).optional().describe("Per page (default 50, max 200)"),
    },
    async (params) => {
      const q: Record<string, string> = {};
      if (params.status) q.status = params.status;
      if (params.type) q.type = params.type;
      if (params.page) q.page = String(params.page);
      if (params.limit) q.limit = String(params.limit);
      return formatResult(await client.get("/documents", Object.keys(q).length ? q : undefined));
    },
  );

  siteAwareTool(server, client,
    "thincms_list_document_events",
    "The document's tamper-evident event timeline, oldest first: { events: [{ seq, type, at, actor, hash, data }], chain: { ok, events, brokenAt?, reason? } }. Types: created, updated, previewed, sent, resent, email_failed (an invitation or code email didn't go out), code_sent, code_failed, code_locked, authenticated (recipient confirmed who they are), viewed, withdrawn, replaced, expired. actor is user:<id>, apikey, mcp, system or recipient:<recipientId>. Use it to answer \"has she opened it?\" and \"did the email go out?\". chain.ok false means the log was altered.",
    { id: z.string().describe("Document id") },
    async ({ id }) => formatResult(await client.get(`/documents/${encodeURIComponent(id)}/events`)),
  );

  siteAwareTool(server, client,
    "thincms_resend_document",
    "Email a fresh link for a sent (or viewed) document that hasn't expired. The new link replaces the old one: earlier links for that recipient stop working and anyone signed in with them is signed out. Omit recipientId to resend to every recipient. On a live site this needs confirmProductionWrite: true (it emails a real person). Returns { document, links } with each new url and emailSent, returned only this once. 409 if the document isn't sent/viewed or has expired.",
    {
      id: z.string().describe("Document id"),
      recipientId: z.string().optional().describe("Recipient id (from thincms_get_document); omit for all recipients"),
    },
    async ({ id, recipientId }) => formatResult(await client.post(`/documents/${encodeURIComponent(id)}/resend`, recipientId ? { recipientId } : {})),
  );

  siteAwareTool(server, client,
    "thincms_withdraw_document",
    "Withdraw a sent or viewed document. Its links then show a neutral \"This document has been withdrawn\" page with none of the content, and open sessions end. On a live site this needs confirmProductionWrite: true. This can't be undone; to send a corrected version instead, create a new document with replacesDocumentId and send that. 409 for a draft or an already finished document.",
    {
      id: z.string().describe("Document id"),
      reason: z.string().optional().describe("Why, for the event log (max 500 characters; not shown to the recipient)"),
    },
    async ({ id, reason }) => formatResult(await client.post(`/documents/${encodeURIComponent(id)}/withdraw`, reason ? { reason } : {})),
  );
}
