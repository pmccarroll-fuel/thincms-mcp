import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { lookup } from "node:dns/promises";
import type { ThinCMSConfig } from "./config.js";
import type { ApiResult } from "./types.js";

export class ThinCMSClient {
  private baseUrl: string;
  private apiKey: string;
  private siteId: string;

  constructor(config: ThinCMSConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.siteId = config.siteId;
  }

  private get headers(): Record<string, string> {
    return {
      "X-API-Key": this.apiKey,
      "X-Site-Id": this.siteId,
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

  async post(path: string, body: any): Promise<ApiResult> {
    return this.request(this.url(path), {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async put(path: string, body: any): Promise<ApiResult> {
    return this.request(this.url(path), {
      method: "PUT",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async delete(path: string): Promise<ApiResult> {
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

    return this.request(this.url(path), {
      method: "PUT",
      headers: this.headers,
      body: formData,
    });
  }
}
