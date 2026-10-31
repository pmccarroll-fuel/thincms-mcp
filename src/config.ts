export interface SiteProfile {
  name: string;
  siteId: string;
  // Present for local/API-key mode. Absent in hosted mode, where every call
  // carries the user's OAuth bearer token instead.
  apiKey?: string;
  // Hosted mode only: the user's effective MCP role on this site.
  role?: string;
  domain?: string;
}

export interface ThinCMSConfig {
  baseUrl: string;
  apiKey?: string;
  siteId: string;
  sites: SiteProfile[];
  // Hosted mode: OAuth access token sent as `Authorization: Bearer` with
  // X-Site-Id, replacing X-API-Key. Updated per request as clients refresh.
  bearerToken?: string;
  // Hosted mode: the process serves many users, so tools must not read or
  // write the server's own filesystem or fetch internal network addresses.
  remote?: boolean;
  // Scopes per-process state (snapshots) to one user. "local" for stdio.
  ownerId?: string;
  // Site IDs that should be treated as production. When set, any write tool
  // (POST/PUT/PATCH/DELETE) targeting one of these sites requires
  // confirmProductionWrite: true on the call. Acts as a backstop against
  // accidental production writes from a session intended for testing.
  productionSiteIds: string[];
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
      productionSiteIds: parseProductionSiteIds(),
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
    productionSiteIds: parseProductionSiteIds(),
  };
}

function parseProductionSiteIds(): string[] {
  const raw = process.env.THINCMS_PRODUCTION_SITE_IDS;
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
