import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerReviewTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client,
    "thincms_list_reviews",
    "List Google reviews ingested for the active site (Reviews Module v1). Filterable by post status, rating, sentiment, hold reason, and drift flag. Reviews are pulled from Outscraper on a daily cron schedule; sentiment is run via the configured AI provider. Use postStatus=posted to see what's currently on the public widget.",
    {
      postStatus: z.enum(["posted", "not_posted"]).optional().describe("Filter by published-to-widget state."),
      rating: z.number().int().min(1).max(5).optional().describe("Filter by rating (1-5)."),
      sentimentLabel: z.enum(["positive", "neutral", "negative"]).optional().describe("Filter by computed sentiment label."),
      holdReason: z.enum(["auto_post_off", "low_rating", "sentiment_mismatch", "editor_unpublished", "drift_pending"]).optional().describe("Filter by why a review is held back from the widget."),
      driftFlag: z.enum(["none", "edited", "missing"]).optional().describe("Filter by drift state. 'edited' = changed on Google since capture; 'missing' = no longer returned by Google."),
      provider: z.enum(["outscraper", "google_business_profile"]).optional().describe("Filter by which provider ingested the review."),
      page: z.number().int().positive().optional().describe("Page number (default 1)."),
      limit: z.number().int().positive().max(200).optional().describe("Items per page (default 50, max 200)."),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.postStatus) queryParams.postStatus = params.postStatus;
      if (params.rating !== undefined) queryParams.rating = String(params.rating);
      if (params.sentimentLabel) queryParams.sentimentLabel = params.sentimentLabel;
      if (params.holdReason) queryParams.holdReason = params.holdReason;
      if (params.driftFlag) queryParams.driftFlag = params.driftFlag;
      if (params.provider) queryParams.provider = params.provider;
      if (params.page) queryParams.page = String(params.page);
      if (params.limit) queryParams.limit = String(params.limit);
      const result = await client.get("/reviews", queryParams);
      return formatResult(result);
    },
  );

  siteAwareTool(server, client,
    "thincms_get_review",
    "Get a single review by ID, including full text, sentiment fields, and drift notes if drift was detected.",
    { id: z.string().describe("Review ID.") },
    async (params) => {
      const result = await client.get(`/reviews/${params.id}`);
      return formatResult(result);
    },
  );

  siteAwareTool(server, client,
    "thincms_publish_review",
    "Mark a review as posted to the public reviews widget. Sets postStatus='posted' and clears any holdReason. Subject to the production-write guard if the site is in THINCMS_PRODUCTION_SITE_IDS — pass confirmProductionWrite=true to acknowledge.",
    { id: z.string().describe("Review ID.") },
    async (params) => {
      const result = await client.put(`/reviews/${params.id}`, { postStatus: "posted" });
      return formatResult(result);
    },
  );

  siteAwareTool(server, client,
    "thincms_unpublish_review",
    "Hide a review from the public widget. Sets postStatus='not_posted' and holdReason='editor_unpublished'. Subject to the production-write guard.",
    { id: z.string().describe("Review ID.") },
    async (params) => {
      const result = await client.put(`/reviews/${params.id}`, { postStatus: "not_posted", holdReason: "editor_unpublished" });
      return formatResult(result);
    },
  );

  siteAwareTool(server, client,
    "thincms_clear_review_drift",
    "Clear the drift flag on a review after the editor has reconciled the edit (e.g. they're satisfied the new text is fine). Resets driftFlag to 'none' and clears driftNotes; if the review was held as drift_pending, that hold is also cleared (so a previously published review re-appears on the widget).",
    { id: z.string().describe("Review ID.") },
    async (params) => {
      const result = await client.put(`/reviews/${params.id}`, { driftFlag: "none" });
      return formatResult(result);
    },
  );

  siteAwareTool(server, client,
    "thincms_set_review_editor_notes",
    "Set free-text editor notes on a review (internal-only; not shown publicly). Useful for tracking why something was unpublished or what to do about a flagged drift event.",
    {
      id: z.string().describe("Review ID."),
      editorNotes: z.string().describe("Internal notes (pass empty string to clear)."),
    },
    async (params) => {
      const result = await client.put(`/reviews/${params.id}`, { editorNotes: params.editorNotes });
      return formatResult(result);
    },
  );

  siteAwareTool(server, client,
    "thincms_sync_reviews",
    "Manually trigger a reviews poll for the active site (same code path the cron uses). Fetches from the configured provider, runs sentiment on new reviews, applies the auto-post rule, and detects drift. Subject to the production-write guard. Optional backfillDaysOverride lets you re-run with a longer history window.",
    {
      backfillDaysOverride: z.number().int().positive().max(365).optional().describe("Override the per-site backfillDays setting for this single run (1-365)."),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.backfillDaysOverride) body.backfillDaysOverride = params.backfillDaysOverride;
      const result = await client.post("/reviews/sync", body);
      return formatResult(result);
    },
  );

  siteAwareTool(server, client,
    "thincms_re_analyze_review_sentiment",
    "Re-run sentiment analysis for a single review (id) or all reviews on the site (all=true). Useful after switching the AI provider in Settings. Does NOT change postStatus — only sentiment fields. Admin-only.",
    {
      id: z.string().optional().describe("Review ID. Omit when using all=true."),
      all: z.boolean().optional().describe("Re-analyse every review on the site (capped at 500)."),
    },
    async (params) => {
      const result = await client.post("/reviews/re-analyze", params);
      return formatResult(result);
    },
  );

  siteAwareTool(server, client,
    "thincms_get_reviews_settings",
    "Get the current reviews + AI configuration for the active site, plus recipient list and last-sync status. Admin-only. Secrets are echoed only as has*Key booleans, never as plaintext.",
    {},
    async () => {
      const result = await client.get("/reviews/settings");
      return formatResult(result);
    },
  );

  siteAwareTool(server, client,
    "thincms_update_reviews_settings",
    "Update reviews module + AI provider configuration. Partial-update — only provided fields change. Pass an empty string to a key field (e.g. reviews.outscraperApiKey='') to clear that secret. Admin-only; subject to production-write guard.",
    {
      reviews: z.object({
        provider: z.enum(["none", "outscraper", "google_business_profile"]).optional().describe("Active provider. 'google_business_profile' is reserved for v2 and currently rejected by the API."),
        googleLocationId: z.string().optional().describe("Google Business Profile place ID."),
        outscraperApiKey: z.string().optional().describe("Outscraper API key. Empty string clears."),
        autoPost5Star: z.boolean().optional().describe("Auto-publish 5-star reviews when sentiment matches."),
        syncTime: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("Daily sync time HH:mm in site's timezone."),
        backfillDays: z.number().int().min(1).max(365).optional().describe("How many days of history to fetch on first connect (1-365)."),
      }).optional(),
      ai: z.object({
        provider: z.enum(["none", "openai", "anthropic"]).optional(),
        model: z.string().optional().describe("Model name, e.g. 'gpt-4o-mini' or 'claude-haiku-4-5-20251001'."),
        openaiApiKey: z.string().optional().describe("OpenAI key. Empty string clears."),
        anthropicApiKey: z.string().optional().describe("Anthropic key. Empty string clears."),
      }).optional(),
      recipientUserIds: z.array(z.string()).optional().describe("Replace the list of users who receive the daily digest. Each ID must be an existing site user."),
    },
    async (params) => {
      const result = await client.put("/reviews/settings", params);
      return formatResult(result);
    },
  );

  siteAwareTool(server, client,
    "thincms_test_ai_connection",
    "Round-trip a 1-token prompt to the configured AI provider to confirm the key + model combination works. Returns provider, model, and a tiny sample reply. Admin-only.",
    {},
    async () => {
      const result = await client.post("/ai/test", {});
      return formatResult(result);
    },
  );
}
