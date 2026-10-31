// Hosted MCP server (Streamable HTTP). One process serves every user.
//
// Auth: ThinCMS is the OAuth authorization server (Google sign-in via its
// admin login). This process is only a resource server: it validates bearer
// tokens by calling ThinCMS's /api/v1/mcp/me, then forwards the same token to
// the REST API, where per-user, per-site MCP permissions are enforced.
//
// Env:
//   MCP_PUBLIC_URL        Public URL of this endpoint, e.g. https://app.thincms.ai/mcp (required)
//   THINCMS_INTERNAL_URL  Where to reach the ThinCMS app (default http://127.0.0.1:3000)
//   PORT / HOST           Listen address (default 3100 on 127.0.0.1; nginx proxies /mcp here)
//   THINCMS_PRODUCTION_SITE_IDS  Optional production write guard, as in stdio mode

import express, { type Request, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { InvalidTokenError, ServerError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "./server.js";
import type { ThinCMSClient } from "./client.js";
import type { SiteProfile } from "./config.js";

const PUBLIC_URL = process.env.MCP_PUBLIC_URL;
if (!PUBLIC_URL) {
  throw new Error("MCP_PUBLIC_URL is required (e.g. https://app.thincms.ai/mcp)");
}
const INTERNAL_URL = (process.env.THINCMS_INTERNAL_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || "127.0.0.1";
const PRODUCTION_SITE_IDS = (process.env.THINCMS_PRODUCTION_SITE_IDS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const publicUrl = new URL(PUBLIC_URL);
const RESOURCE_METADATA_URL = new URL(
  `/.well-known/oauth-protected-resource${publicUrl.pathname}`,
  publicUrl,
).toString();

const TOKEN_CACHE_MS = 30_000;
const SESSION_IDLE_MS = 30 * 60_000;

// ── Token verification (via ThinCMS) ──

interface MeResponse {
  user: { id: string; email: string; name: string | null };
  clientId: string;
  tokenExpiresAt: number;
  sites: Array<{ siteId: string; name: string; domain: string; role: string; siteStatus?: string }>;
}

const tokenCache = new Map<string, { me: MeResponse; until: number }>();

async function fetchMe(token: string): Promise<MeResponse> {
  const key = createHash("sha256").update(token).digest("hex");
  const cached = tokenCache.get(key);
  if (cached && cached.until > Date.now()) return cached.me;

  let res: globalThis.Response;
  try {
    res = await fetch(`${INTERNAL_URL}/api/v1/mcp/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err: any) {
    throw new ServerError(`ThinCMS unreachable: ${err.message}`);
  }
  if (res.status === 401) {
    tokenCache.delete(key);
    throw new InvalidTokenError("Invalid or expired access token");
  }
  if (!res.ok) throw new ServerError(`Token check failed (${res.status})`);

  const me = (await res.json()) as MeResponse;
  tokenCache.set(key, { me, until: Date.now() + TOKEN_CACHE_MS });
  return me;
}

const verifier = {
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const me = await fetchMe(token);
    return {
      token,
      clientId: me.clientId,
      scopes: ["mcp"],
      expiresAt: me.tokenExpiresAt,
      extra: { me },
    };
  },
};

function sitesFrom(me: MeResponse): SiteProfile[] {
  return me.sites.map((s) => ({ name: s.name, siteId: s.siteId, domain: s.domain, role: s.role, siteStatus: s.siteStatus }));
}

// ── Sessions ──

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  client: ThinCMSClient;
  userId: string;
  lastSeen: number;
}

const sessions = new Map<string, Session>();

function meOf(req: Request): MeResponse {
  return (req.auth!.extra as { me: MeResponse }).me;
}

// Look up the session for this request and check it belongs to the caller.
// Returns null after writing an error response.
function resolveSession(req: Request, res: Response): Session | null {
  const sessionId = req.header("mcp-session-id");
  const session = sessionId ? sessions.get(sessionId) : undefined;
  if (!session) {
    res.status(404).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null });
    return null;
  }
  const me = meOf(req);
  if (session.userId !== me.user.id) {
    res.status(403).json({ jsonrpc: "2.0", error: { code: -32001, message: "Session belongs to another user" }, id: null });
    return null;
  }
  session.lastSeen = Date.now();
  session.client.updateHostedAuth(req.auth!.token, sitesFrom(me));
  return session;
}

async function startSession(req: Request, res: Response): Promise<void> {
  const me = meOf(req);
  const sites = sitesFrom(me);
  const { server, client } = createServer({
    baseUrl: INTERNAL_URL,
    siteId: sites[0]?.siteId ?? "",
    sites,
    bearerToken: req.auth!.token,
    remote: true,
    ownerId: me.user.id,
    productionSiteIds: PRODUCTION_SITE_IDS,
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport, server, client, userId: me.user.id, lastSeen: Date.now() });
      console.log(`[mcp] session ${id} opened for ${me.user.email} (${sites.length} site(s))`);
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

// Drop idle sessions so per-user servers don't accumulate.
setInterval(() => {
  const cutoff = Date.now() - SESSION_IDLE_MS;
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) {
      sessions.delete(id);
      s.transport.close().catch(() => {});
    }
  }
  for (const [key, entry] of tokenCache) {
    if (entry.until < Date.now()) tokenCache.delete(key);
  }
}, 5 * 60_000).unref();

// ── HTTP app ──

const app = express();
app.set("trust proxy", "loopback");
app.use(hostHeaderValidation([publicUrl.hostname, "localhost", "127.0.0.1"]));
// Page HTML and base64 media uploads routinely exceed express's 100kb default.
app.use(express.json({ limit: "50mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, sessions: sessions.size });
});

const auth = requireBearerAuth({ verifier, resourceMetadataUrl: RESOURCE_METADATA_URL });

app.post("/mcp", auth, async (req, res) => {
  try {
    if (!req.header("mcp-session-id")) {
      if (!isInitializeRequest(req.body)) {
        res.status(400).json({ jsonrpc: "2.0", error: { code: -32000, message: "Missing session ID" }, id: null });
        return;
      }
      await startSession(req, res);
      return;
    }
    const session = resolveSession(req, res);
    if (session) await session.transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[mcp] POST error", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
    }
  }
});

// GET opens the server-to-client SSE stream; DELETE ends the session.
const handleSessionRequest = async (req: Request, res: Response) => {
  try {
    const session = resolveSession(req, res);
    if (session) await session.transport.handleRequest(req, res);
  } catch (err) {
    console.error(`[mcp] ${req.method} error`, err);
    if (!res.headersSent) res.status(500).end();
  }
};
app.get("/mcp", auth, handleSessionRequest);
app.delete("/mcp", auth, handleSessionRequest);

app.listen(PORT, HOST, () => {
  console.log(`[mcp] ThinCMS hosted MCP listening on http://${HOST}:${PORT}/mcp (public: ${PUBLIC_URL})`);
});
