import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ThinCMSClient } from "../client.js";
import { recordToolName, runWithClient, getCurrentOverride, formatText } from "../helpers.js";
import { ToolGate, type Module } from "../tool-rights.js";
import { registerCapabilitiesTool } from "./capabilities.js";
import { registerSnapshotTools } from "./snapshots.js";
import { registerPostTools } from "./posts.js";
import { registerPageTools } from "./pages.js";
import { registerCategoryTools } from "./categories.js";
import { registerAuthorTools } from "./authors.js";
import { registerTagTools } from "./tags.js";
import { registerMediaTools } from "./media.js";
import { registerTemplateTools } from "./template.js";
import { registerNavigationTools } from "./navigation.js";
import { registerSettingsTools } from "./settings.js";
import { registerScriptTools } from "./scripts.js";
import { registerSecretTools } from "./secrets.js";
import { registerFormTools } from "./forms.js";
import { registerSubmissionTools } from "./submissions.js";
import { registerSearchTools } from "./search.js";
import { registerPreviewTools } from "./preview.js";
import { registerSocialLinksTools } from "./social-links.js";
import { registerContentBlockTools } from "./content-blocks.js";
import { registerCollectionTools } from "./collections.js";
import { registerPopupTools } from "./popups.js";
import { registerShareButtonTools } from "./share-buttons.js";
import { registerRedirectTools } from "./redirects.js";
import { registerAnalyticsTools } from "./analytics.js";
import { registerSiteTools } from "./sites.js";
import { registerSeoTools } from "./seo.js";
import { registerCourseTools } from "./courses.js";
import { registerLessonTools } from "./lessons.js";
import { registerQuizTools } from "./quizzes.js";
import { registerWorkbookTools } from "./workbooks.js";
import { registerEnrollmentTools } from "./enrollments.js";
import { registerCohortTools } from "./cohorts.js";
import { registerSubscriberTools } from "./subscribers.js";
import { registerLeadMagnetTools } from "./lead-magnets.js";
import { registerIntegrationTools } from "./integrations.js";
import { registerCampaignTools } from "./campaigns.js";
import { registerSequenceTools } from "./sequences.js";
import { registerReviewTools } from "./reviews.js";
import { registerChatTools } from "./chat.js";
import { registerToolTools } from "./tools.js";
import { registerVersionTools } from "./versions.js";
import { registerReleaseTools } from "./releases.js";
import { registerUploadTools } from "./uploads.js";
import { registerUserTools } from "./users.js";

// Module each tool file belongs to (P-3). null = always available.
// Tools registered while `currentModule` is set are gated on that module.
let currentModule: Module | null = null;
function inModule(module: Module | null, register: () => void) {
  currentModule = module;
  try { register(); } finally { currentModule = null; }
}

export function registerAllTools(server: McpServer, client: ThinCMSClient): ToolGate {
  const gate = new ToolGate();
  // Wrap server.tool to record every registered name into the central
  // tool registry. thincms_capabilities reads it back to surface the live
  // tool surface — lets agents detect when their MCP host has cached a
  // stale schema set despite a current version stamp.
  //
  // The same interceptor binds each handler to this server's client via
  // runWithClient, so formatResult and the snapshot store see the right
  // session when many users share one hosted process.
  //
  // Inputs are strict (CR 17): the raw zod shape becomes z.object(shape).strict(),
  // registered through registerTool (the legacy tool() overload only accepts raw
  // shapes, which the SDK turns into non-strict objects that silently drop unknown
  // keys). An unknown parameter now fails with "Unrecognized key(s)" naming it.
  const registerTool = (server as any).registerTool.bind(server);
  (server as any).tool = (name: string, ...rest: any[]) => {
    recordToolName(name);
    const handler = rest.pop();
    // A per-call siteId can point at a site with fewer rights than the active
    // one; check the target site's rights before running (the REST API checks again).
    const guarded = typeof handler === "function"
      ? (...args: any[]) => {
          const target = getCurrentOverride()?.siteId ?? client.getActiveSite().siteId;
          const verdict = gate.check(name, client.findSite(target)?.rights);
          if (!verdict.ok) {
            return formatText(`You don't have ${verdict.level} access to ${verdict.module} on this site, so ${name} isn't available here.`, true);
          }
          return handler(...args);
        }
      : handler;
    const bound = typeof guarded === "function"
      ? (...args: any[]) => runWithClient(client, () => guarded(...args))
      : guarded;
    const description = typeof rest[0] === "string" ? (rest.shift() as string) : undefined;
    const shape = rest.length ? rest.shift() : undefined;
    const annotations = rest.length ? rest.shift() : undefined;
    const registered = registerTool(
      name,
      {
        ...(description !== undefined && { description }),
        ...(shape !== undefined && { inputSchema: z.object(shape).strict() }),
        ...(annotations !== undefined && { annotations }),
      },
      bound,
    );
    gate.add(name, registered, currentModule);
    return registered;
  };

  inModule("content", () => registerPostTools(server, client));
  inModule("content", () => registerPageTools(server, client));
  inModule("content", () => registerCategoryTools(server, client));
  inModule("content", () => registerAuthorTools(server, client));
  inModule("content", () => registerTagTools(server, client));
  inModule("content", () => registerMediaTools(server, client));
  inModule("content", () => registerUploadTools(server, client));
  inModule("content", () => registerTemplateTools(server, client));
  inModule("content", () => registerNavigationTools(server, client));
  inModule("content", () => registerSettingsTools(server, client));
  inModule("administration", () => registerScriptTools(server, client));
  inModule("administration", () => registerSecretTools(server, client));
  inModule("marketing", () => registerFormTools(server, client));
  inModule("marketing", () => registerSubmissionTools(server, client));
  inModule("content", () => registerSearchTools(server, client));
  inModule("content", () => registerPreviewTools(server, client));
  inModule("content", () => registerSocialLinksTools(server, client));
  inModule("content", () => registerContentBlockTools(server, client));
  inModule("content", () => registerCollectionTools(server, client));
  inModule("marketing", () => registerPopupTools(server, client));
  inModule("content", () => registerShareButtonTools(server, client));
  inModule("content", () => registerRedirectTools(server, client));
  inModule("analytics", () => registerAnalyticsTools(server, client));
  inModule(null, () => registerSiteTools(server, client));
  inModule("content", () => registerSeoTools(server, client));
  inModule("courses", () => registerCourseTools(server, client));
  inModule("courses", () => registerLessonTools(server, client));
  inModule("courses", () => registerQuizTools(server, client));
  inModule("courses", () => registerWorkbookTools(server, client));
  inModule("courses", () => registerEnrollmentTools(server, client));
  inModule("courses", () => registerCohortTools(server, client));
  inModule("marketing", () => registerSubscriberTools(server, client));
  inModule("marketing", () => registerLeadMagnetTools(server, client));
  inModule("marketing", () => registerIntegrationTools(server, client));
  inModule("marketing", () => registerCampaignTools(server, client));
  inModule("marketing", () => registerSequenceTools(server, client));
  inModule("reviews", () => registerReviewTools(server, client));
  inModule("chat", () => registerChatTools(server, client));
  inModule("tools", () => registerToolTools(server, client));
  inModule("content", () => registerVersionTools(server, client));
  inModule("content", () => registerReleaseTools(server, client));
  inModule("administration", () => registerUserTools(server, client));
  inModule(null, () => registerSnapshotTools(server, client));  // Snapshot/restore safety tools
  registerCapabilitiesTool(server, client, gate);  // Last — reads the populated registry
  return gate;
}
