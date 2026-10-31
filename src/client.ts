import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { lookup } from "node:dns/promises";
import type { ThinCMSConfig, SiteProfile } from "./config.js";
import type { ApiResult } from "./types.js";
import { getCurrentOverride } from "./helpers.js";

export class ThinCMSClient {
  private baseUrl: string;
  private apiKey: string | undefined;
  private siteId: string;
  private sites: SiteProfile[];
  private activeSiteName: string;
  private productionSiteIds: Set<string>;
  private bearerToken: string | undefined;
  private remote: boolean;
  private ownerId: string;

  constructor(config: ThinCMSConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.siteId = config.siteId;
    this.sites = config.sites;
    this.activeSiteName = config.sites[0]?.name ?? "";
    this.productionSiteIds = new Set(config.productionSiteIds ?? []);
    this.bearerToken = config.bearerToken;
    this.remote = config.remote ?? false;
    this.ownerId = config.ownerId ?? "local";
  }

  getSites(): SiteProfile[] {
    return this.sites;
  }

  isRemote(): boolean {
    return this.remote;
  }

  getOwnerId(): string {
    return this.ownerId;
  }

  // Hosted mode: refresh credentials and the permitted site list on every
  // request, so token refreshes and admin permission changes apply mid-session.
  updateHostedAuth(bearerToken: string, sites: SiteProfile[]): void {
    this.bearerToken = bearerToken;
    this.sites = sites;
    if (sites.length > 0 && !sites.some((s) => s.siteId === this.siteId)) {
      this.siteId = sites[0].siteId;
      this.activeSiteName = sites[0].name;
    }
  }

  /** Resolve a site by ID or (case-insensitive) name. */
  findSite(idOrName: string): SiteProfile | undefined {
    const needle = idOrName.toLowerCase();
    return (
      this.sites.find((s) => s.siteId === idOrName) ??
      this.sites.find((s) => s.name.toLowerCase() === needle)
    );
  }

  // Production = listed in THINCMS_PRODUCTION_SITE_IDS, or (hosted mode)
  // reported live by ThinCMS (Site.siteStatus === "live").
  isProductionSite(siteId: string): boolean {
    if (this.productionSiteIds.has(siteId)) return true;
    return this.sites.some((s) => s.siteId === siteId && s.siteStatus === "live");
  }

  getProductionSiteIds(): string[] {
    return Array.from(this.productionSiteIds);
  }

  getActiveSite(): { name: string; siteId: string } {
    return { name: this.activeSiteName, siteId: this.siteId };
  }

  switchSite(name: string): { name: string; siteId: string } | null {
    const profile = this.findSite(name);
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
    const siteId = override?.siteId ?? this.siteId;
    if (this.bearerToken) {
      return { Authorization: `Bearer ${this.bearerToken}`, "X-Site-Id": siteId };
    }
    return {
      "X-API-Key": (override?.apiKey ?? this.apiKey)!,
      "X-Site-Id": siteId,
    };
  }

  // Hosted mode: a URL source is fetched by the server, so refuse anything
  // that resolves to a private/loopback/link-local address (SSRF), and check
  // every redirect hop the same way.
  private async fetchSourceUrl(rawUrl: string): Promise<Response> {
    if (!this.remote) return fetch(rawUrl);
    let current = rawUrl;
    for (let hop = 0; hop < 5; hop++) {
      await assertPublicUrl(current);
      const res = await fetch(current, { redirect: "manual" });
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        current = new URL(location, current).toString();
        continue;
      }
      return res;
    }
    throw new Error("Too many redirects");
  }

  private rejectLocalPath(filePath?: string): ApiResult | null {
    if (filePath && this.remote) {
      return {
        ok: false,
        status: 0,
        data: { error: "File paths aren't available on the hosted server. Use thincms_prepare_upload and pass uploadId instead (or provide url or base64 with filename)." },
      };
    }
    return null;
  }

  // Production-site write guard. Returns an error ApiResult when the call
  // would write to a production site (see isProductionSite) without an
  // explicit confirmProductionWrite acknowledgement; null when the call is
  // allowed to proceed.
  checkProductionWrite(): ApiResult | null {
    const override = getCurrentOverride();
    const targetSiteId = override?.siteId ?? this.siteId;
    if (!this.isProductionSite(targetSiteId)) return null;
    if (override?.confirmProductionWrite === true) return null;
    const profile = this.sites.find((s) => s.siteId === targetSiteId);
    const label = profile ? `${profile.name} [${targetSiteId}]` : targetSiteId;
    const reason = this.productionSiteIds.has(targetSiteId)
      ? "it is in THINCMS_PRODUCTION_SITE_IDS"
      : "the site is live";
    return {
      ok: false,
      status: 403,
      data: {
        error: `Refusing to write to production site ${label} — ${reason}. Take a snapshot first (thincms_snapshot) so the write is reversible, then re-call with confirmProductionWrite: true to acknowledge.`,
      },
    };
  }

  // Staged uploads. Preparing a slot and consuming it don't change site
  // content, so they skip the production guard; the write that uses the
  // upload is guarded as usual.
  async prepareUpload(body: {
    filename: string;
    contentType: string;
    bytes?: number;
    sha256?: string;
  }): Promise<ApiResult> {
    return this.request(this.url("/uploads"), {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /** Claim a staged upload (single use) and return its bytes. */
  async consumeUpload(
    uploadId: string,
  ): Promise<
    | { ok: true; bytes: ArrayBuffer; filename: string; contentType: string; sha256: string }
    | { ok: false; result: ApiResult }
  > {
    try {
      const res = await fetch(this.url(`/uploads/${encodeURIComponent(uploadId)}/consume`), {
        method: "POST",
        headers: this.headers,
      });
      if (!res.ok) {
        const contentType = res.headers.get("content-type") || "";
        const data = contentType.includes("application/json") ? await res.json() : await res.text();
        return { ok: false, result: { ok: false, status: res.status, data } };
      }
      return {
        ok: true,
        bytes: await res.arrayBuffer(),
        filename: decodeURIComponent(res.headers.get("x-upload-filename") || "upload"),
        contentType: res.headers.get("content-type") || "application/octet-stream",
        sha256: res.headers.get("x-upload-sha256") || "",
      };
    } catch (err: any) {
      return { ok: false, result: { ok: false, status: 0, data: { error: `Network error: ${err.message}` } } };
    }
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
      uploadId?: string;
      filename?: string;
      fields?: Record<string, string | undefined>;
    }
  ): Promise<ApiResult> {
    const localPathError = this.rejectLocalPath(options.filePath);
    if (localPathError) return localPathError;
    // Check before consuming, so a refused write doesn't burn the upload
    const earlyGuard = this.checkProductionWrite();
    if (earlyGuard) return earlyGuard;

    const formData = new FormData();
    let uploadSha256: string | undefined;

    if (options.uploadId) {
      const upload = await this.consumeUpload(options.uploadId);
      if (!upload.ok) return upload.result;
      uploadSha256 = upload.sha256;
      const blob = new Blob([upload.bytes], { type: upload.contentType });
      formData.append("file", blob, options.filename || upload.filename);
    } else if (options.filePath) {
      const buffer = await readFile(options.filePath);
      const name = options.filename || basename(options.filePath);
      const blob = new Blob([buffer]);
      formData.append("file", blob, name);
    } else if (options.url) {
      let res: Response;
      try {
        res = await this.fetchSourceUrl(options.url);
      } catch (err: any) {
        return { ok: false, status: 0, data: { error: `Refused to fetch URL: ${err.message}` } };
      }
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
        data: { error: "Provide one of: filePath, url, base64, or uploadId" },
      };
    }

    if (options.fields) {
      for (const [key, value] of Object.entries(options.fields)) {
        if (value !== undefined && value !== null) {
          formData.append(key, value);
        }
      }
    }

    const result = await this.request(this.url(path), {
      method: "POST",
      headers: this.headers,
      body: formData,
    });
    // Echo the hash of the staged bytes so the agent can match it against
    // `shasum -a 256` of the local file.
    if (result.ok && uploadSha256 && result.data && typeof result.data === "object") {
      result.data = { ...result.data, sha256: uploadSha256 };
    }
    return result;
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
    const localPathError = this.rejectLocalPath(options.filePath);
    if (localPathError) return localPathError;

    const formData = new FormData();

    if (options.filePath) {
      const buffer = await readFile(options.filePath);
      const name = options.filename || basename(options.filePath);
      const blob = new Blob([buffer]);
      formData.append("file", blob, name);
    } else if (options.url) {
      let res: Response;
      try {
        res = await this.fetchSourceUrl(options.url);
      } catch (err: any) {
        return { ok: false, status: 0, data: { error: `Refused to fetch URL: ${err.message}` } };
      }
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

// SSRF guard for hosted mode. Exported for tests.
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("only http(s) URLs are allowed");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true });
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error(`${u.hostname} resolves to a non-public address`);
    }
  }
}

export function isPrivateAddress(address: string): boolean {
  const v4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) ||           // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224                              // multicast / reserved
    );
  }
  const v6 = address.toLowerCase();
  return (
    v6 === "::" || v6 === "::1" ||
    v6.startsWith("fc") || v6.startsWith("fd") || // unique local
    v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb") // link-local
  );
}
