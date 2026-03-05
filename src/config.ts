export interface ThinCMSConfig {
  baseUrl: string;
  apiKey: string;
  siteId: string;
}

export function loadConfig(): ThinCMSConfig {
  const baseUrl = process.env.THINCMS_BASE_URL;
  const apiKey = process.env.THINCMS_API_KEY;
  const siteId = process.env.THINCMS_SITE_ID;

  const missing: string[] = [];
  if (!baseUrl) missing.push("THINCMS_BASE_URL");
  if (!apiKey) missing.push("THINCMS_API_KEY");
  if (!siteId) missing.push("THINCMS_SITE_ID");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
      `Set them in your MCP server config or .env file.`
    );
  }

  return {
    baseUrl: baseUrl!.replace(/\/+$/, ""),
    apiKey: apiKey!,
    siteId: siteId!,
  };
}
