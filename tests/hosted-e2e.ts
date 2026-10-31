/**
 * End-to-end test for the hosted MCP server + ThinCMS OAuth flow.
 * Requires a local ThinCMS dev server (port 3000, NODE_ENV=development so
 * /api/dev-login works) and the hosted MCP server (port 3100):
 *
 *   (thincms)     npm run dev
 *   (thincms-mcp) MCP_PUBLIC_URL=http://localhost:3000/mcp npm run dev:http
 *   (thincms-mcp) npx tsx tests/hosted-e2e.ts
 *
 * Toggles MCP access for the dev admin user on the first site, and restores
 * the original settings at the end.
 */
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const CMS = process.env.THINCMS_URL || "http://localhost:3000";
const MCP = process.env.MCP_URL || "http://localhost:3100/mcp";
const REDIRECT = "http://localhost:9999/callback";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function main() {
  // 1. Discovery
  const unauth = await fetch(MCP, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const wwwAuth = unauth.headers.get("www-authenticate") || "";
  check("unauthenticated /mcp → 401 with resource_metadata", unauth.status === 401 && wwwAuth.includes("resource_metadata="), wwwAuth);
  const prm = await (await fetch(`${CMS}/.well-known/oauth-protected-resource/mcp`)).json();
  check("protected resource metadata", prm.resource === `${CMS}/mcp`, JSON.stringify(prm.authorization_servers));
  const asm = await (await fetch(`${CMS}/.well-known/oauth-authorization-server`)).json();
  check("authorization server metadata", asm.code_challenge_methods_supported?.includes("S256"));

  // 2. Dynamic client registration
  const badReg = await fetch(asm.registration_endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }),
  });
  check("DCR rejects non-https, non-loopback redirect", badReg.status === 400);
  const reg = await (await fetch(asm.registration_endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: "E2E Test Client" }),
  })).json();
  check("DCR issues client_id", typeof reg.client_id === "string");

  // 3. Admin session (dev bypass) and MCP toggle on the first site
  const login = await fetch(`${CMS}/api/dev-login`, { redirect: "manual" });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  check("dev-login session cookie", cookie.includes("session-token"));
  const users = await (await fetch(`${CMS}/api/v1/users`, { headers: { cookie } })).json();
  const me = (await (await fetch(`${CMS}/api/auth/session`, { headers: { cookie } })).json()).user;
  const mine = users.users.find((u: any) => u.userId === me.id);
  const original = { mcpEnabled: mine.mcpEnabled, mcpRole: mine.mcpRole };
  const setMcp = (body: object) =>
    fetch(`${CMS}/api/v1/users/${mine.userSiteId}`, {
      method: "PUT", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });

  try {
    await setMcp({ mcpEnabled: true, mcpRole: "editor" });

    // 4. Authorize → consent → code
    const verifier = randomBytes(32).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const authParams = new URLSearchParams({
      client_id: reg.client_id, redirect_uri: REDIRECT, response_type: "code",
      code_challenge: challenge, code_challenge_method: "S256", state: "xyz", resource: `${CMS}/mcp`,
    });
    const noSession = await fetch(`${asm.authorization_endpoint}?${authParams}`, { redirect: "manual" });
    check("authorize without session → login redirect", (noSession.headers.get("location") || "").includes("/login?callbackUrl="));
    const consentHtml = await (await fetch(`${asm.authorization_endpoint}?${authParams}`, { headers: { cookie } })).text();
    const consentToken = /name="consent_token" value="([^"]+)"/.exec(consentHtml)?.[1];
    check("consent page lists sites and has CSRF token", !!consentToken && consentHtml.includes("Editor"));

    const form = new URLSearchParams(authParams);
    form.set("consent_token", consentToken!);
    form.set("decision", "approve");
    const forged = new URLSearchParams(form);
    forged.set("consent_token", "forged");
    const forgedRes = await fetch(`${CMS}/api/oauth/authorize/approve`, { method: "POST", headers: { cookie }, body: forged, redirect: "manual" });
    check("approve rejects forged consent token", forgedRes.status === 400);
    const approve = await fetch(`${CMS}/api/oauth/authorize/approve`, { method: "POST", headers: { cookie }, body: form, redirect: "manual" });
    const loc = new URL(approve.headers.get("location") || "http://x");
    const code = loc.searchParams.get("code");
    check("approve redirects with code + state", !!code && loc.searchParams.get("state") === "xyz");

    // 5. Token exchange
    const tokenReq = (body: Record<string, string>) =>
      fetch(asm.token_endpoint, { method: "POST", body: new URLSearchParams(body) });
    const badPkce = await tokenReq({ grant_type: "authorization_code", code: code!, code_verifier: "wrong", client_id: reg.client_id, redirect_uri: REDIRECT });
    check("token rejects wrong PKCE verifier", badPkce.status === 400);
    // The wrong-verifier attempt doesn't consume the code; a real exchange still works.
    const tokens = await (await tokenReq({ grant_type: "authorization_code", code: code!, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT })).json();
    check("token issues access + refresh", tokens.access_token?.startsWith("tcms_at_") && tokens.refresh_token?.startsWith("tcms_rt_"));
    const replay = await tokenReq({ grant_type: "authorization_code", code: code!, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT });
    check("code cannot be reused", replay.status === 400);

    // Code replay revokes tokens issued from it — get a fresh pair via a new code.
    const consent2 = await (await fetch(`${asm.authorization_endpoint}?${authParams}`, { headers: { cookie } })).text();
    form.set("consent_token", /name="consent_token" value="([^"]+)"/.exec(consent2)![1]);
    const loc2 = new URL((await fetch(`${CMS}/api/oauth/authorize/approve`, { method: "POST", headers: { cookie }, body: form, redirect: "manual" })).headers.get("location")!);
    const fresh = await (await tokenReq({ grant_type: "authorization_code", code: loc2.searchParams.get("code")!, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT })).json();
    const rotated = await (await tokenReq({ grant_type: "refresh_token", refresh_token: fresh.refresh_token, client_id: reg.client_id })).json();
    check("refresh token rotates", rotated.access_token && rotated.access_token !== fresh.access_token);
    const oldRefresh = await tokenReq({ grant_type: "refresh_token", refresh_token: fresh.refresh_token, client_id: reg.client_id });
    check("old refresh token is dead after rotation", oldRefresh.status === 400);
    const accessToken: string = rotated.access_token;

    // 6. MCP session
    const transport = new StreamableHTTPClientTransport(new URL(MCP), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const client = new Client({ name: "e2e", version: "1.0.0" });
    await client.connect(transport);
    const tools = await client.listTools();
    check("MCP tools listed", tools.tools.length > 100, `${tools.tools.length} tools`);

    const text = (r: any) => r.content.map((c: any) => c.text ?? "").join("\n");
    const sites = await client.callTool({ name: "thincms_list_sites", arguments: {} });
    check("list_sites shows MCP-enabled site with level", text(sites).includes("your MCP access: editor"), text(sites).split("\n")[1]);

    const mcpMe = await (await fetch(`${CMS}/api/v1/mcp/me`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
    const siteName: string = mcpMe.sites[0].name;
    const siteId: string = mcpMe.sites[0].siteId;
    const posts = await client.callTool({ name: "thincms_list_posts", arguments: { limit: 1, siteId: siteName } });
    check("read by site name works", !posts.isError, text(posts).split("\n")[0]);

    const local = await client.callTool({ name: "thincms_upload_media", arguments: { filePath: "/etc/hosts" } });
    check("filePath refused in hosted mode", !!local.isError && text(local).includes("not available on the hosted"));
    const ssrf = await client.callTool({ name: "thincms_upload_media", arguments: { url: "http://169.254.169.254/latest/meta-data" } });
    check("internal URL refused in hosted mode", !!ssrf.isError && text(ssrf).includes("non-public"));

    // Read-only level: writes rejected by ThinCMS
    await setMcp({ mcpRole: "viewer" });
    const write = await client.callTool({ name: "thincms_create_tag", arguments: { name: `e2e-${Date.now()}` } });
    check("read-only MCP level blocks writes", !!write.isError && text(write).includes("403"), text(write).split("\n")[1]);

    // MCP turned off: site disappears and direct calls 403
    await setMcp({ mcpEnabled: false });
    const offRes = await fetch(`${CMS}/api/v1/posts`, { headers: { Authorization: `Bearer ${accessToken}`, "X-Site-Id": siteId } });
    const meOff = await (await fetch(`${CMS}/api/v1/mcp/me`, { headers: { Authorization: `Bearer ${accessToken}` } })).json();
    check("MCP off → no sites", meOff.sites.length === 0 && offRes.status !== 200);

    // Revocation
    await fetch(`${CMS}/api/oauth/revoke`, { method: "POST", body: new URLSearchParams({ token: accessToken }) });
    const revoked = await fetch(`${CMS}/api/v1/mcp/me`, { headers: { Authorization: `Bearer ${accessToken}` } });
    check("revoked token → 401", revoked.status === 401);

    await client.close().catch(() => {});
  } finally {
    await setMcp(original);
  }

  console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
