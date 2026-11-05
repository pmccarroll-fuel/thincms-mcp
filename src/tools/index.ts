import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ThinCMSClient } from "../client.js";
import { recordToolName, runWithClient } from "../helpers.js";
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

export function registerAllTools(server: McpServer, client: ThinCMSClient) {
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
    const bound = typeof handler === "function"
      ? (...args: any[]) => runWithClient(client, () => handler(...args))
      : handler;
    const description = typeof rest[0] === "string" ? (rest.shift() as string) : undefined;
    const shape = rest.length ? rest.shift() : undefined;
    const annotations = rest.length ? rest.shift() : undefined;
    return registerTool(
      name,
      {
        ...(description !== undefined && { description }),
        ...(shape !== undefined && { inputSchema: z.object(shape).strict() }),
        ...(annotations !== undefined && { annotations }),
      },
      bound,
    );
  };

  registerPostTools(server, client);
  registerPageTools(server, client);
  registerCategoryTools(server, client);
  registerAuthorTools(server, client);
  registerTagTools(server, client);
  registerMediaTools(server, client);
  registerUploadTools(server, client);
  registerTemplateTools(server, client);
  registerNavigationTools(server, client);
  registerSettingsTools(server, client);
  registerScriptTools(server, client);
  registerSecretTools(server, client);
  registerFormTools(server, client);
  registerSubmissionTools(server, client);
  registerSearchTools(server, client);
  registerPreviewTools(server, client);
  registerSocialLinksTools(server, client);
  registerContentBlockTools(server, client);
  registerCollectionTools(server, client);
  registerPopupTools(server, client);
  registerShareButtonTools(server, client);
  registerRedirectTools(server, client);
  registerAnalyticsTools(server, client);
  registerSiteTools(server, client);
  registerSeoTools(server, client);
  registerCourseTools(server, client);
  registerLessonTools(server, client);
  registerQuizTools(server, client);
  registerWorkbookTools(server, client);
  registerEnrollmentTools(server, client);
  registerCohortTools(server, client);
  registerSubscriberTools(server, client);
  registerLeadMagnetTools(server, client);
  registerIntegrationTools(server, client);
  registerCampaignTools(server, client);
  registerSequenceTools(server, client);
  registerReviewTools(server, client);
  registerChatTools(server, client);
  registerToolTools(server, client);
  registerVersionTools(server, client);
  registerReleaseTools(server, client);
  registerSnapshotTools(server, client);  // Snapshot/restore safety tools
  registerCapabilitiesTool(server, client);  // Last — reads the populated registry
}
