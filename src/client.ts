import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { lookup } from "node:dns/promises";
import type { ThinCMSConfig, SiteProfile } from "./config.js";
import type { ApiResult } from "./types.js";
import { getCurrentOverride } from "./helpers.js";

export class ThinCMSClient {
  private baseUrl: string;
  private apiKey: string;
  private siteId: string;
  private sites: SiteProfile[];
  private activeSiteName: string;
  private productionSiteIds: Set<string>;

  constructor(config: ThinCMSConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.siteId = config.siteId;
    this.sites = config.sites;
    this.activeSiteName = config.sites[0].name;
    this.productionSiteIds = new Set(config.productionSiteIds ?? []);
  }

  getSites(): SiteProfile[] {
    return this.sites;
  }

  isProductionSite(siteId: string): boolean {
    return this.productionSiteIds.has(siteId);
  }

  getProductionSiteIds(): string[] {
    return Array.from(this.productionSiteIds);
  }

  getActiveSite(): { name: string; siteId: string } {
    return { name: this.activeSiteName, siteId: this.siteId };
  }

  switchSite(name: string): { name: string; siteId: string } | null {
    const profile = this.sites.find(
      (s) => s.name.toLowerCase() === name.toLowerCase()
    );
    if (!profile) return null;
    this.apiKey = profile.apiKey;
    this.siteId = profile.siteId;
    this.activeSiteName = profile.name;
    return { name: profile.name, siteId: profile.siteId };
  }

  private get headers(): Record<string, string> {
    // Per-call override (set by siteAwareTool via AsyncLocalStorage) wins
    // over the persistent active-site state. When no override is in effect
    // — single-tenant flows, switch_site users — falls back to instance
    // state and behaves exactly as before.
    const override = getCurrentOverride();
    return {
      "X-API-Key": override?.apiKey ?? this.apiKey,
      "X-Site-Id": override?.siteId ?? this.siteId,
    };
  }

  // Production-site write guard. Returns an error ApiResult when the call
  // would write to a site listed in THINCMS_PRODUCTION_SITE_IDS without an
  // explicit confirmProductionWrite acknowledgement; null when the call is
  // allowed to proceed.
  private checkProductionWrite(): ApiResult | null {
    const override = getCurrentOverride();
    const targetSiteId = override?.siteId ?? this.siteId;
    if (!this.productionSiteIds.has(targetSiteId)) return null;
    if (override?.confirmProductionWrite === true) return null;
    const profile = this.sites.find((s) => s.siteId === targetSiteId);
    const label = profile ? `${profile.name} [${targetSiteId}]` : targetSiteId;
    return {
      ok: false,
      status: 403,
      data: {
        error: `Refusing to write to production site ${label} — it is in THINCMS_PRODUCTION_SITE_IDS. Take a snapshot first (thincms_snapshot) so the write is reversible, then re-call with confirmProductionWrite: true to acknowledge.`,
      },
    };
  }

  private url(path: string, params?: Record<string, string>): string {
    const url = new URL(`/api/v1${path}`, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null && value !== "") {
          url.searchParams.set(key, value);
        }
      }
    }
    return url.toString();
  }

  private async request(url: string, init: RequestInit): Promise<ApiResult> {
    try {
      const res = await fetch(url, init);
      let data: any;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        data = await res.text();
      }
      return { ok: res.ok, status: res.status, data };
    } catch (err: any) {
      return {
        ok: false,
        status: 0,
        data: { error: `Network error: ${err.message}` },
      };
    }
  }

  async get(path: string, params?: Record<string, string>): Promise<ApiResult> {
    return this.request(this.url(path, params), {
      method: "GET",
      headers: this.headers,
    });
  }

  /**
   * GET a binary or text payload (PDF, CSV, Markdown) and return the raw bytes
   * plus content-type/disposition headers. On HTTP error, attempts to parse a
   * JSON body and returns it via the data field.
   */
  async getRaw(
    path: string,
    params?: Record<string, string>,
  ): Promise<
    | { ok: true; kind: "binary"; status: number; bytes: Uint8Array; contentType: string; filename: string | null }
    | { ok: false; kind: "error"; status: number; data: any }
  > {
    try {
      const res = await fetch(this.url(path, params), {
        method: "GET",
        headers: this.headers,
      });
      if (!res.ok) {
        const contentType = res.headers.get("content-type") || "";
        const data = contentType.includes("application/json") ? await res.json() : await res.text();
        return { ok: false, kind: "error", status: res.status, data };
      }
      const contentType = res.headers.get("content-type") || "";
      const cd = res.headers.get("content-disposition") || "";
      const match = /filename="([^"]+)"/.exec(cd);
      const buf = await res.arrayBuffer();
      return {
        ok: true,
        kind: "binary",
        status: res.status,
        bytes: new Uint8Array(buf),
        contentType,
        filename: match ? match[1] : null,
      };
    } catch (err: any) {
      return { ok: false, kind: "error", status: 0, data: { error: `Network error: ${err.message}` } };
    }
  }

  async post(path: string, body: any): Promise<ApiResult> {
    const guard = this.checkProductionWrite();
    if (guard) return guard;
    return this.request(this.url(path), {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async put(path: string, body: any): Promise<ApiResult> {
    const guard = this.checkProductionWrite();
    if (guard) return guard;
    return this.request(this.url(path), {
      method: "PUT",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async patch(path: string, body: any): Promise<ApiResult> {
    const guard = this.checkProductionWrite();
    if (guard) return guard;
    return this.request(this.url(path), {
      method: "PATCH",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async delete(path: string): Promise<ApiResult> {
    const guard = this.checkProductionWrite();
    if (guard) return guard;
    return this.request(this.url(path), {
      method: "DELETE",
      headers: this.headers,
    });
  }

  async uploadFile(
    path: string,
    options: {
      filePath?: string;
      url?: string;
      base64?: string;
      filename?: string;
      fields?: Record<string, string | undefined>;
    }
  ): Promise<ApiResult> {
    const formData = new FormData();

    if (options.filePath) {
      const buffer = await readFile(options.filePath);
      const name = options.filename || basename(options.filePath);
      const blob = new Blob([buffer]);
      formData.append("file", blob, name);
    } else if (options.url) {
      const res = await fetch(options.url);
      if (!res.ok) {
        return {
          ok: false,
          status: 0,
          data: { error: `Failed to download file from URL: ${res.status} ${res.statusText}` },
        };
      }
      const buffer = await res.arrayBuffer();
      const urlPath = new URL(options.url).pathname;
      const name = options.filename || basename(urlPath) || "download";
      const blob = new Blob([buffer]);
      formData.append("file", blob, name);
    } else if (options.base64) {
      if (!options.filename) {
        return {
          ok: false,
          status: 0,
          data: { error: "filename is required when uploading base64 content" },
        };
      }
      const buffer = Buffer.from(options.base64, "base64");
      const blob = new Blob([buffer]);
      formData.append("file", blob, options.filename);
    } else {
      return {
        ok: false,
        status: 0,
        data: { error: "Provide one of: filePath, url, or base64" },
      };
    }

    if (options.fields) {
      for (const [key, value] of Object.entries(options.fields)) {
        if (value !== undefined && value !== null) {
          formData.append(key, value);
        }
      }
    }

    const guard = this.checkProductionWrite();
    if (guard) return guard;
    return this.request(this.url(path), {
      method: "POST",
      headers: this.headers,
      body: formData,
    });
  }

  async uploadFileReplace(
    path: string,
    options: {
      filePath?: string;
      url?: string;
      base64?: string;
      filename?: string;
    }
  ): Promise<ApiResult> {
    const formData = new FormData();

    if (options.filePath) {
      const buffer = await readFile(options.filePath);
      const name = options.filename || basename(options.filePath);
      const blob = new Blob([buffer]);
      formData.append("file", blob, name);
    } else if (options.url) {
      const res = await fetch(options.url);
      if (!res.ok) {
        return {
          ok: false,
          status: 0,
          data: { error: `Failed to download file from URL: ${res.status} ${res.statusText}` },
        };
      }
      const buffer = await res.arrayBuffer();
      const urlPath = new URL(options.url).pathname;
      const name = options.filename || basename(urlPath) || "download";
      const blob = new Blob([buffer]);
      formData.append("file", blob, name);
    } else if (options.base64) {
      if (!options.filename) {
        return {
          ok: false,
          status: 0,
          data: { error: "filename is required when uploading base64 content" },
        };
      }
      const buffer = Buffer.from(options.base64, "base64");
      const blob = new Blob([buffer]);
      formData.append("file", blob, options.filename);
    } else {
      return {
        ok: false,
        status: 0,
        data: { error: "Provide one of: filePath, url, or base64" },
      };
    }

    const guard = this.checkProductionWrite();
    if (guard) return guard;
    return this.request(this.url(path), {
      method: "PUT",
      headers: this.headers,
      body: formData,
    });
  }
}
