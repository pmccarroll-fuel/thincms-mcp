export interface SiteProfile {
  name: string;
  siteId: string;
  apiKey: string;
}

export interface ThinCMSConfig {
  baseUrl: string;
  apiKey: string;
  siteId: string;
  sites: SiteProfile[];
}

export function loadConfig(): ThinCMSConfig {
  const baseUrl = process.env.THINCMS_BASE_URL;
  if (!baseUrl) {
    throw new Error(
      "Missing required environment variable: THINCMS_BASE_URL. " +
      "Set it in your MCP server config or .env file."
    );
  }

  const sitesJson = process.env.THINCMS_SITES;

  if (sitesJson) {
    let sites: SiteProfile[];
    try {
      sites = JSON.parse(sitesJson);
    } catch {
      throw new Error(
        "THINCMS_SITES must be a valid JSON array of {name, siteId, apiKey} objects."
      );
    }

    if (!Array.isArray(sites) || sites.length === 0) {
      throw new Error("THINCMS_SITES must be a non-empty array.");
    }

    for (const s of sites) {
      if (!s.name || !s.siteId || !s.apiKey) {
        throw new Error(
          "Each entry in THINCMS_SITES must have name, siteId, and apiKey."
        );
      }
    }

    return {
      baseUrl: baseUrl.replace(/\/+$/, ""),
      apiKey: sites[0].apiKey,
      siteId: sites[0].siteId,
      sites,
    };
  }

  // Backward-compatible single-site config
  const apiKey = process.env.THINCMS_API_KEY;
  const siteId = process.env.THINCMS_SITE_ID;

  const missing: string[] = [];
  if (!apiKey) missing.push("THINCMS_API_KEY");
  if (!siteId) missing.push("THINCMS_SITE_ID");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
      `Set them in your MCP server config or .env file, ` +
      `or use THINCMS_SITES for multi-site support.`
    );
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: apiKey!,
    siteId: siteId!,
    sites: [{ name: "default", siteId: siteId!, apiKey: apiKey! }],
  };
}
