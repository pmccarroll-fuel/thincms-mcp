import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ThinCMSClient } from "../client.js";
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

export function registerAllTools(server: McpServer, client: ThinCMSClient) {
  registerPostTools(server, client);
  registerPageTools(server, client);
  registerCategoryTools(server, client);
  registerAuthorTools(server, client);
  registerTagTools(server, client);
  registerMediaTools(server, client);
  registerTemplateTools(server, client);
  registerNavigationTools(server, client);
  registerSettingsTools(server, client);
  registerScriptTools(server, client);
  registerSecretTools(server, client);
  registerFormTools(server, client);
  registerSubmissionTools(server, client);
  registerSearchTools(server, client);
  registerPreviewTools(server, client);
}
