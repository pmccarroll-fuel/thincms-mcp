import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

// Documents module (Level 1): send a document to one person, who opens it
// through a private link after confirming who they are and signs it (M2).
// Signing itself happens on the recipient's page, not through MCP; agents
// declare priced items, void a signature and fetch the signed copy.

const HTML_RULES =
  "A full standalone HTML page (<!doctype html><html><head>…</head><body>…</body></html>), not a fragment: the site template is NOT applied. " +
  "Put all CSS in inline <style> blocks or style attributes and use system fonts. " +
  "Images must be in this site's Media library (src=\"/media/…\", or the site's own domain + /media/…; upload with thincms_upload_media first) or be data: URIs; they are embedded into the document when it is sent. " +
  "Nothing may load from the network: no external stylesheets (<link rel=stylesheet>), @import, scripts with src, web fonts, remote images, iframes, <base> or meta refresh. " +
  "Links (<a href>) to other sites are fine; they open in a new tab. " +
  "Problems are not checked here: thincms_preview_document and thincms_send_document report them (422 with a problems list). " +
  "Max 15 MB. " +
  "Signature position: put <thincms-signature></thincms-signature> where the signature belongs (e.g. under \"Signed for the client\"). In the signed copy (PDF) it is replaced by the signature block (signature, name, capacity, date and document id); on the recipient's page it shows as a dashed \"Your signature will appear here\" box. Without it, the signature block goes at the end of the document. " +
  "Don't build your own signing form, consent checkbox or Sign button: ThinCMS adds the signing panel (choices, totals, consent, type-or-draw signature, Sign and Decline) under the document. " +
  "Optional runtime for showing priced items inside the document: inline scripts may read window.thinCMSDocument, which ThinCMS injects into the signer's page: " +
  "items (the document's items, each with price in currency units, plus priceCents, kind, group, recurrence, taxRate, default), currency (e.g. \"CAD\", or null), " +
  "getSelected() (ids currently chosen), select(ids) (asks the signing panel to choose these ids; the panel validates them and stays in charge of what is submitted), " +
  "onChange(fn) (fn(selectedIds) is called at once and after every change). " +
  "It is available on the recipient's link, in the preview, and when the signed PDF is rendered (there with the signer's final choices, read-only). Keep the terms readable without it anyway; the chosen items and totals are always printed on the PDF's certificate page.";

const RECURRENCE = z.enum(["one-off", "monthly", "quarterly", "annual"]);

const ITEM = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/i, "letters, numbers, - or _ (max 41 characters)").describe("Stable id, unique in this document: letters, numbers, - or _. The signer's choices are recorded by id."),
  label: z.string().describe("What the signer sees, e.g. \"Monthly bookkeeping package\" (max 200 characters)"),
  description: z.string().optional().describe("One line of detail under the label (max 500 characters)"),
  kind: z.enum(["fixed", "optional", "choice"]).optional().describe(
    "fixed (default): always included and always counted in the totals; the signer can't untick it. " +
    "optional: a tick box the signer may turn on or off. " +
    "choice: one option in a choose-one group (set group); the signer must pick exactly one option per group, so include a \"none\" option at 0 if choosing nothing is allowed.",
  ),
  group: z.string().optional().describe("Required for choice items, not allowed otherwise: the group id (same rules as id). Every group needs at least two choices."),
  recurrence: RECURRENCE.optional().describe("How often it is billed: one-off (default), monthly, quarterly or annual. Totals are shown and recorded per recurrence."),
  price: z.number().min(0).max(100_000_000)
    .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "price can have at most two decimals")
    .describe("Price before tax in currency units (e.g. 300.50), at most two decimals. 0 is allowed."),
  taxRate: z.number().min(0).max(100).optional().describe("Tax percentage on this item, e.g. 13 for 13% HST (default 0). Tax is rounded half-up to the cent per line."),
  default: z.boolean().optional().describe("optional items: ticked to start with. choice items: the option picked to start with (at most one per group). Not allowed on fixed items."),
}).strict();

const SELECTION_TEXT =
  "Priced items the signer sees and chooses between in the signing panel (Level 1: one signer). " +
  "Fixed items always count; optional items count when ticked; each choice group needs exactly one pick. " +
  "The panel shows a total per recurrence (before tax, tax, after tax). When the recipient signs, the server recomputes every total from these items and the chosen ids and refuses the signature if the totals the signer saw differ by even a cent; the choices and totals are then recorded with the signature and printed on the certificate. " +
  "The items are frozen at send, with their hash in the event log. Max 100 items. currency is required with items. " +
  "Describe the same terms in the html too: the panel is the binding choice, and the html is the letter around it.";

const SELECTION_FIELDS = {
  items: z.array(ITEM).max(100).optional().describe(SELECTION_TEXT),
  currency: z.string().regex(/^[A-Z]{3}$/, "a three-letter code such as CAD, NZD or USD").optional().describe("Three-letter currency code in capitals (CAD, NZD, USD…). Required with items."),
  groups: z.record(z.string()).optional().describe('Headings for choice groups: { "<group id>": "<heading shown above the options>" }, e.g. { "coaching": "Coaching sessions" }. Each key must be a group used by a choice item. Without a heading the group shows as "Choose one".'),
};

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
  requiresSignature: z.boolean().optional().describe("Whether documents of this type are signed. true (default): the signer sees the signing panel under the document. false: view-only, no signing panel."),
  expiryDays: z.number().int().min(1).max(365).optional().describe("Days a sent document's links stay open when the document has no expiresAt. Default 30."),
  retentionSignedDays: z.number().int().min(0).max(3650).optional().describe("Days to keep signed documents (default 90). Auto-delete is still to come; the value is stored now."),
  retentionUnsignedDays: z.number().int().min(0).max(3650).optional().describe("Days to keep unsigned documents (default 30). Auto-delete is still to come; the value is stored now."),
  consentText: z.string().optional().describe("The statement the signer must tick before signing (max 2000 characters). It is recorded with the signature and printed on the certificate. Default: \"I agree that typing or drawing my signature here is my electronic signature, with the same effect as signing on paper, and that I have read this document.\""),
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
    "Create a document as a draft. Nothing is sent. Workflow: create → thincms_preview_document → give the preview link to a person and wait for their approval → thincms_send_document → the signer signs (or declines) on their page → watch thincms_list_document_events for signed → thincms_get_signed_copy to file the PDF. " +
      "The html is the document itself; mark the signature spot with <thincms-signature></thincms-signature> (otherwise the signature goes at the end). ThinCMS provides the signing panel under the document, so the html needs no form or Sign button. " +
      "For prices the signer chooses between (packages, optional extras, choose-one options), pass items + currency (+ groups): see items. " +
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
      ...SELECTION_FIELDS,
    },
    async (params) => formatResult(await client.post("/documents", params)),
  );

  siteAwareTool(server, client,
    "thincms_update_document",
    "Edit a DRAFT document; send only the fields to change. Sent documents can't be edited (409): create a new document with replacesDocumentId instead. recipients, when given, replaces the whole list. " +
      "items, currency and groups are one set: sending any of them replaces the stored set, re-checked as a whole, with any of the three you leave out taken from the stored set. So send the full items list (not just the changed item); if you remove or rename a choice group, send groups again too (a heading for a group no longer used is a 400). items: [] removes all items. " +
      "After changing the html or items, preview again before sending.",
    {
      id: z.string().describe("Document id"),
      title: z.string().optional(),
      html: z.string().optional().describe("The full replacement page. " + HTML_RULES),
      recipients: RECIPIENTS.optional(),
      authMethod: AUTH_METHOD.optional().describe(AUTH_METHOD_TEXT),
      expiresAt: z.string().nullable().optional().describe("ISO 8601 with timezone, at least an hour away; null to use the type's expiryDays"),
      message: z.string().nullable().optional().describe("Note in the invitation email; null or \"\" to remove"),
      ...SELECTION_FIELDS,
    },
    async ({ id, ...body }) => formatResult(await client.put(`/documents/${encodeURIComponent(id)}`, body)),
  );

  siteAwareTool(server, client,
    "thincms_preview_document",
    "Get a private preview link showing exactly what the recipient will see, valid for 2 hours. Give the link to the person who must approve the document, and send only after they approve it. " +
      "For a draft this also checks the html: if anything would stop it being sent, the call fails with 422 and a problems list (e.g. a remote image or stylesheet); fix them with thincms_update_document and preview again. " +
      "A new preview link replaces the previous one. The preview shows exactly what the signer sees, including the items and the signing panel (with Sign switched off). Returns { url, expiresAt }.",
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
    "Get one document: status (draft, sent, viewed, signed, declined, expired, withdrawn, voided), type, sign-in method, expiry, body hash once sent, replaces/replacedBy, and each recipient's status (pending, sent, viewed, signed, declined…), viewedAt and the email they confirmed with. " +
      "selections: { currency, groups, items } as declared (prices in currency units), or null; the signer's actual choices and totals are in the signed event (thincms_list_document_events) and on the certificate. " +
      "signedPdfHash: SHA-256 of the stored signed copy (null until it is produced). sealCertFingerprint: SHA-256 fingerprint of the certificate that digitally sealed it (null if the copy isn't sealed). Links are never returned here.",
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
    "The document's tamper-evident event timeline, oldest first: { events: [{ seq, type, at, actor, hash, data }], chain: { ok, events, brokenAt?, reason? } }. Types: created, updated, previewed, sent (the document was frozen and sent), invited (one recipient's invitation email went out), resent, email_failed (an invitation, code or signed-copy email didn't go out), code_sent, code_failed, code_locked, authenticated (recipient confirmed who they are), viewed, withdrawn, replaced, expired, " +
      "signed (data holds the acceptance record: name, email, capacity, typed or drawn signature, signedAt, IP, browser, how identity was confirmed, consent text, body and selections hashes, the chosen item ids and the totals), declined (data.reason, if the signer gave one), voided (data.reason), " +
      "signed_copy (the signed PDF was produced: data.pdfHash, sealed), pdf_failed (producing it failed: data.error; thincms_get_signed_copy tries again), seal_unavailable (the copy was produced without a digital seal because sealing isn't configured on the server), copy_emailed (the signed copy was emailed: data.to is signer or sender). " +
      "actor is user:<id>, apikey, mcp, system or recipient:<recipientId>. Use it to answer \"has she opened it?\", \"did the email go out?\" and \"has she signed?\". chain.ok false means the log was altered.",
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

  // ── Signing (M2) ──

  siteAwareTool(server, client,
    "thincms_void_document",
    "Void a signed document's signature, e.g. when it was signed by mistake or the engagement is cancelled. Only a signed document can be voided (409 otherwise, naming its status). " +
      "Needs Documents edit plus the separate \"documents.void\" permission, which a site owner grants per user (403 with code grant_forbidden otherwise). " +
      "Nothing is deleted: the signed record, the event history and the signed copy all stay (thincms_get_signed_copy still works); the status becomes voided and a voided event with your reason is added to the history. It can't be undone. " +
      "On a live site this needs confirmProductionWrite: true. Returns { document }.",
    {
      id: z.string().describe("Document id"),
      reason: z.string().min(3).describe("Why the signature is voided (3 to 1000 characters), recorded in the event log. Required."),
    },
    async ({ id, reason }) => formatResult(await client.post(`/documents/${encodeURIComponent(id)}/void`, { reason })),
  );

  siteAwareTool(server, client,
    "thincms_get_signed_copy",
    "Get the signed copy of a signed (or voided) document as a PDF download link, to file it (e.g. in the client's folder). " +
      "The PDF is the document as sent with the signature block where <thincms-signature> was (or at the end), then a certificate page: document title, id, type, sent time and content fingerprint; the signer's name, email, capacity, signature and time; how their identity was confirmed (method, confirmed email, IP, browser); the consent statement they accepted; the items with what was chosen and the totals per recurrence (when the document had items); the event history; and the signing event's fingerprint. " +
      "When sealing is configured on the server, the whole PDF is digitally sealed (a certificate-based PAdES signature with a trusted timestamp), so PDF readers show any later change; the certificate page then names the seal and its fingerprint (also sealCertFingerprint on thincms_get_document). Otherwise the certificate page says it is not sealed. " +
      "The signer and the sender are emailed the same PDF automatically when it is signed; this tool is for filing it or sending it on. If the copy is missing (e.g. producing it failed earlier: a pdf_failed event), it is produced now. " +
      "Returns { downloadUrl, filename, bytes, sha256, expiresAt, pdfHash }: downloadUrl works once and for 15 minutes, needs no login, and is a secret (don't post it anywhere public); pdfHash equals the document's signedPdfHash. Call again for a fresh link. " +
      "Errors: 409 if the document isn't signed or voided (there is no signed copy yet, or it was declined/withdrawn), 404 if not found, 503 \"The signed copy could not be produced\" when the copy is missing and can't be rebuilt from the stored signing record. If rendering or sealing fails while producing it, a pdf_failed event is logged (thincms_list_document_events shows the error) and the call fails with 503 naming the error; the signature itself still stands, so try again later.",
    { id: z.string().describe("Document id") },
    async ({ id }) => formatResult(await client.get(`/documents/${encodeURIComponent(id)}/signed-copy`)),
  );
}
