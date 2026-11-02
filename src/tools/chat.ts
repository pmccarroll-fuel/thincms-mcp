import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

const periodFields = {
  days: z.number().int().positive().max(730).optional().describe("Look back this many days (default 30). Ignored when from is set."),
  from: z.string().optional().describe("Start date (ISO, e.g. 2026-10-01)."),
  to: z.string().optional().describe("End date (ISO). Default: now."),
};

function query(params: Record<string, unknown>): Record<string, string> {
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q[k] = String(v);
  }
  return q;
}

export function registerChatTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client,
    "thincms_chat_list_conversations",
    "List chat assistant conversations (newest first). A conversation exists only once a visitor sent a message. outcome is set ~30 minutes after the last message: resolved, unanswered (the assistant said it didn't know at least once), handover (visitor left a message for staff) or abandoned; null while in progress. Admin test-console chats are excluded unless includeTest=true.",
    {
      ...periodFields,
      outcome: z.enum(["open", "resolved", "unanswered", "handover", "abandoned"]).optional().describe("Filter by outcome (open = still in progress)."),
      unanswered: z.boolean().optional().describe("Only conversations where at least one question went unanswered."),
      handedOver: z.boolean().optional().describe("Only conversations that produced a handover."),
      topic: z.string().optional().describe("Filter by topic label (e.g. pricing, hours, grooming)."),
      path: z.string().optional().describe("Filter by entry page path (substring)."),
      q: z.string().optional().describe("Full-text search in the transcript."),
      includeTest: z.boolean().optional().describe("Include admin test-console conversations."),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(200).optional().describe("Default 50, max 200."),
    },
    async (params) => formatResult(await client.get("/chat/conversations", query(params))),
  );

  siteAwareTool(server, client,
    "thincms_chat_get_conversation",
    "Get one conversation's full transcript. Each assistant message includes status (answered | unanswered | handover | guardrail | offtopic | capped | error) and sources: the content chunks it used ({id, title, url, kind}; kind chat-only means an unlisted knowledge page). Phone numbers and emails are masked in transcripts; see the linked handovers for contact details.",
    { id: z.string().describe("Conversation ID.") },
    async (params) => formatResult(await client.get(`/chat/conversations/${params.id}`)),
  );

  siteAwareTool(server, client,
    "thincms_chat_list_unanswered",
    "List the questions the assistant couldn't answer from site content, newest first, each with the visitor's question and conversationId. Workflow to fill a gap: check the question isn't already answered somewhere, then either add an item to the FAQ collection (thincms_create_collection_item) or create a page with visibility \"chat-only\" and status \"published\" (thincms_create_page). The assistant picks up the change on its next answer.",
    { ...periodFields },
    async (params) => formatResult(await client.get("/chat/unanswered", query(params))),
  );

  siteAwareTool(server, client,
    "thincms_chat_list_handovers",
    "List take-a-message handovers (visitor contact details + question) for staff follow-up. Includes overdue (past the follow-up target), waitingMinutes, notifyLog (email/telegram/webhook delivery results) and counts by status.",
    {
      status: z.enum(["new", "contacted", "closed", "open"]).optional().describe("open = new + contacted."),
      outcome: z.enum(["booked", "answered_no_sale", "no_response", "not_a_fit", "spam"]).optional(),
      days: z.number().int().positive().max(730).optional().describe("Only handovers from the last N days (default: all)."),
      page: z.number().int().positive().optional(),
      limit: z.number().int().positive().max(200).optional(),
    },
    async (params) => formatResult(await client.get("/chat/handovers", query(params))),
  );

  siteAwareTool(server, client,
    "thincms_chat_update_handover",
    "Record staff follow-up on a handover. Setting status contacted stamps contactedAt (used for follow-up time); closed stamps closedAt. outcome: booked (booked / signed up), answered_no_sale, no_response, not_a_fit, spam.",
    {
      id: z.string().describe("Handover ID."),
      status: z.enum(["new", "contacted", "closed"]).optional(),
      outcome: z.enum(["booked", "answered_no_sale", "no_response", "not_a_fit", "spam"]).nullable().optional().describe("null clears it."),
      staffNotes: z.string().optional(),
    },
    async ({ id, ...body }) => formatResult(await client.patch(`/chat/handovers/${id}`, body)),
  );

  siteAwareTool(server, client,
    "thincms_get_chat_settings",
    "Get the chat assistant settings plus status (AI provider connected, SMTP configured, Telegram token set), the collections and pages with whether each is a knowledge source, and suggested guardrails.",
    {},
    async () => formatResult(await client.get("/chat/settings")),
  );

  siteAwareTool(server, client,
    "thincms_update_chat_settings",
    "Update chat assistant settings. Partial update — only fields you pass change. JSON-shaped fields replace the whole value (send the full object/array). Editors and API keys can change wording, appearance, starter questions, excluded paths, sources, guardrails, tone, hours, booking URL and privacy link; enabled, notifyEmails, telegram*, webhookUrl, model, caps and retention need an admin.",
    {
      enabled: z.boolean().optional().describe("Show the widget on the public site."),
      appearance: z.object({
        position: z.enum(["bottom-right", "bottom-left"]).optional(),
        primaryColor: z.string().optional(),
        textColor: z.string().optional(),
        launcherLabel: z.string().optional(),
        offsetX: z.number().optional(),
        offsetY: z.number().optional(),
        keepClearSelectors: z.string().optional().describe("CSS selectors; on phones the launcher hides while any match is on screen (e.g. main CTA buttons)."),
      }).optional(),
      greeting: z.string().optional(),
      disclosureText: z.string().optional().describe("Line shown at the top of the chat, e.g. \"I'm the K9 Clubhouse AI assistant...\""),
      starterQuestions: z.array(z.string()).max(4).optional(),
      excludedPaths: z.array(z.string()).optional().describe("Glob paths where the launcher is hidden (* = one segment, ** = anything)."),
      sources: z.object({
        pages: z.object({ excludeIds: z.array(z.string()) }).optional(),
        collections: z.record(z.boolean()).optional().describe("collectionId → included. FAQ collections default to included."),
        posts: z.boolean().optional(),
      }).optional(),
      guardrails: z.array(z.object({ topic: z.string(), instruction: z.string().optional() })).optional().describe("Topics the assistant must not advise on; it offers a handover instead."),
      tone: z.string().optional(),
      businessHours: z.array(z.object({ dayOfWeek: z.array(z.string()), opens: z.string(), closes: z.string() })).nullable().optional().describe("null = use the site's LocalBusiness opening hours."),
      handoverWording: z.string().optional().describe("Used above the message form and whenever the assistant offers to take a message. {when} is replaced with the next business-hours window; without it, no reply time is quoted."),
      handoverConfirmation: z.string().optional().describe("Shown in the chat after a message is sent. {name} = visitor's first name, {when} = next business-hours window."),
      bookingUrl: z.string().nullable().optional(),
      notifyEmails: z.array(z.string()).optional(),
      telegramChatId: z.string().nullable().optional(),
      telegramBotToken: z.string().optional().describe("Write-only; stored as the TELEGRAM_BOT_TOKEN site secret. Empty string removes it."),
      webhookUrl: z.string().nullable().optional().describe("Receives a chat.handover event (e.g. n8n → SMS)."),
      followUpTargetHours: z.number().int().positive().nullable().optional(),
      model: z.string().nullable().optional().describe("Override the site AI model for chat."),
      maxMessagesPerConversation: z.number().int().positive().optional(),
      dailyMessageCap: z.number().int().nonnegative().optional(),
      hourlyVisitorCap: z.number().int().positive().optional(),
      retentionMonths: z.number().int().positive().optional(),
      handoverRetentionMonths: z.number().int().positive().optional(),
      privacyNoticeUrl: z.string().nullable().optional(),
    },
    async (params) => formatResult(await client.put("/chat/settings", params)),
  );

  siteAwareTool(server, client,
    "thincms_chat_knowledge",
    "Show what the chat assistant currently knows: the compiled knowledge snapshot (sections with id, kind, title, url). Pass includeText to see section text. Pass rebuild to rebuild it now (normally automatic on every content change).",
    {
      includeText: z.boolean().optional(),
      rebuild: z.boolean().optional(),
    },
    async (params) => formatResult(params.rebuild
      ? await client.post("/chat/knowledge", {})
      : await client.get("/chat/knowledge", params.includeText ? { text: "true" } : {})),
  );

  siteAwareTool(server, client,
    "thincms_chat_test",
    "Ask the chat assistant a question as a visitor would, using the saved settings (works while chat is disabled). Returns the answer, status, sources used and token usage. Reuse the same sessionKey to continue a conversation. Stored as a test conversation, excluded from reporting.",
    {
      message: z.string().describe("The visitor's question."),
      sessionKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/).optional().describe("16–64 chars [A-Za-z0-9_-]; omit to start a new conversation."),
    },
    async (params) => {
      const sessionKey = params.sessionKey || `mcptest${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
      return formatResult(await client.post("/chat/test", { sessionKey, message: params.message, stream: false }));
    },
  );
}
