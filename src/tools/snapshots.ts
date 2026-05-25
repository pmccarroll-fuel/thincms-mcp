import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, formatText, getCurrentOverride, runWithOverride } from "../helpers.js";
import { createSnapshot, getSnapshot, listSnapshots, describeScope, type SnapshotScope } from "../snapshot-store.js";

// Resolve the snapshot site from current override (preferred) or active client.
function resolveSiteForSnapshot(client: ThinCMSClient): { siteId: string; apiKey: string; siteName: string } {
  const override = getCurrentOverride();
  if (override) return override;
  const active = client.getActiveSite();
  const profile = client.getSites().find((s) => s.siteId === active.siteId);
  return {
    siteId: active.siteId,
    apiKey: profile?.apiKey ?? "",
    siteName: active.name,
  };
}

export function registerSnapshotTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_snapshot",
    "Capture the current state of a site resource so it can be restored byte-for-byte later. Use BEFORE any test write against a customer site — restore returns the resource to the exact pre-test state regardless of what the test write does (null, substitute, partial update, etc.). Snapshots live in MCP wrapper memory for 24 hours; they survive across tool calls within a session but are lost on host restart. Supports scope='settings', 'template', 'page' (requires resourceId), 'post' (requires resourceId), and 'review' (requires resourceId).",
    {
      scope: z.enum(["settings", "template", "page", "post", "review"]).describe("What to snapshot. 'settings' captures editable site settings (excludes admin-only fields like name/domain that PUT can't restore from an editor key); 'template' captures stylesheet/pageFrame/customHeadHtml; 'page' / 'post' / 'review' capture editable fields of a single resource and require a resourceId."),
      resourceId: z.string().optional().describe("Required for scope='page', 'post', or 'review'. The resource ID to snapshot."),
      siteId: z.string().optional().describe("Override the active site for this snapshot (matches the per-call siteId pattern used by other tools). Must match a siteId from your THINCMS_SITES config."),
    },
    async (params) => {
      // Resolve siteId override the same way siteAwareTool does, so snapshots
      // can target a specific tenant in multi-site setups.
      let override: { siteId: string; apiKey: string; siteName: string } | undefined;
      if (params.siteId) {
        const profile = client.getSites().find((s) => s.siteId === params.siteId);
        if (!profile) {
          return formatResult({ ok: false, status: 0, data: { error: `siteId "${params.siteId}" not found in THINCMS_SITES.` } });
        }
        override = { siteId: profile.siteId, apiKey: profile.apiKey, siteName: profile.name };
      }

      return runWithOverride(override ?? resolveSiteForSnapshot(client), async () => {
        let scope: SnapshotScope;
        let restoreData: any;
        let capturedFieldNames: string[];

        if (params.scope === "settings") {
          scope = { kind: "settings" };
          const result = await client.get("/settings");
          if (!result.ok) return formatResult(result);
          // Strip GET-only computed fields AND admin-only writable fields so
          // the PUT at restore time succeeds from an editor-role API key.
          // The admin-only set must match the gate in
          // src/app/api/v1/settings/route.ts (search: "adminOnlyFieldPresent")
          // — if a field is added there, mirror it here.
          const settings = (result.data as any)?.settings ?? {};
          const {
            // Read-only / computed (stripped to avoid stale values):
            previewSlug: _ps, previewUrl: _pu, siteStatus: _ss, liveAt: _la,
            // Admin-only writable (stripped because editor-role PUT 403s on these):
            name: _n, domain: _d,
            apiEnabled: _ae, smtp: _smtp, stripe: _stripe, previewDomain: _pd,
            // Keep the rest:
            ...editable
          } = settings;
          restoreData = editable;
          capturedFieldNames = Object.keys(editable);
        } else if (params.scope === "template") {
          scope = { kind: "template" };
          const result = await client.get("/template");
          if (!result.ok) return formatResult(result);
          restoreData = result.data;
          capturedFieldNames = Object.keys(result.data ?? {});
        } else if (params.scope === "page") {
          if (!params.resourceId) {
            return formatResult({ ok: false, status: 0, data: { error: "resourceId is required for scope='page'" } });
          }
          scope = { kind: "page", id: params.resourceId };
          const result = await client.get(`/pages/${params.resourceId}`);
          if (!result.ok) return formatResult(result);
          // Page PUT accepts only the editable subset (mirrors the `fields`
          // array in src/app/api/v1/pages/[id]/route.ts).
          const p = result.data as any;
          restoreData = {
            title: p.title, slug: p.slug, content: p.content,
            renderMode: p.renderMode, status: p.status,
            metaTitle: p.metaTitle, metaDescription: p.metaDescription,
            ogImageUrl: p.ogImageUrl, canonicalUrl: p.canonicalUrl,
            noIndex: p.noIndex, jsonLd: p.jsonLd,
          };
          capturedFieldNames = Object.keys(restoreData);
        } else if (params.scope === "post") {
          if (!params.resourceId) {
            return formatResult({ ok: false, status: 0, data: { error: "resourceId is required for scope='post'" } });
          }
          scope = { kind: "post", id: params.resourceId };
          const result = await client.get(`/posts/${params.resourceId}`);
          if (!result.ok) return formatResult(result);
          // Post PUT accepts the editable subset; categories/tags need to be
          // flattened from the included relations into the IDs/names PUT
          // accepts (mirrors the if-blocks in src/app/api/v1/posts/[id]/route.ts).
          const p = result.data as any;
          restoreData = {
            title: p.title, slug: p.slug, content: p.content, excerpt: p.excerpt,
            authorId: p.authorId, status: p.status,
            publishedAt: p.publishedAt, scheduledAt: p.scheduledAt,
            featured: p.featured, pinnedUntil: p.pinnedUntil,
            series: p.series, seriesOrder: p.seriesOrder,
            metaTitle: p.metaTitle, metaDescription: p.metaDescription,
            ogImageUrl: p.ogImageUrl, canonicalUrl: p.canonicalUrl,
            noIndex: p.noIndex, jsonLd: p.jsonLd,
            gatedFormSlug: p.gatedFormSlug, gatePreview: p.gatePreview,
            membersContent: p.membersContent,
            // Flatten relations:
            categoryIds: Array.isArray(p.categories)
              ? p.categories.map((c: any) => c.category?.id ?? c.id).filter(Boolean)
              : [],
            tags: Array.isArray(p.tags)
              ? p.tags.map((t: any) => t.tag?.name ?? t.name).filter(Boolean)
              : [],
          };
          capturedFieldNames = Object.keys(restoreData);
        } else {
          // scope === "review"
          if (!params.resourceId) {
            return formatResult({ ok: false, status: 0, data: { error: "resourceId is required for scope='review'" } });
          }
          scope = { kind: "review", id: params.resourceId };
          const result = await client.get(`/reviews/${params.resourceId}`);
          if (!result.ok) return formatResult(result);
          // Review PUT only accepts editor-controlled fields. Ingestion-derived
          // fields (text, rating, sentiment*) are owned by the source-of-truth
          // Google review and aren't part of restore — re-syncing pulls them
          // back from the provider as needed.
          const r = result.data as any;
          restoreData = {
            postStatus: r.postStatus,
            holdReason: r.holdReason,
            editorNotes: r.editorNotes,
            // driftFlag clear-only via PUT, so capturing the value but only sending it back when it's "none"
            ...(r.driftFlag === "none" ? { driftFlag: "none" } : {}),
          };
          capturedFieldNames = Object.keys(restoreData);
        }

        const ctx = resolveSiteForSnapshot(client);
        const snap = createSnapshot(ctx.siteId, ctx.siteName, scope, restoreData);
        return formatText(JSON.stringify({
          snapshotId: snap.id,
          siteName: snap.siteName,
          siteId: snap.siteId,
          scope: describeScope(snap.scope),
          capturedAt: snap.capturedAt.toISOString(),
          expiresAt: snap.expiresAt.toISOString(),
          capturedFields: capturedFieldNames,
          note: "Pass this snapshotId to thincms_restore_snapshot to revert.",
        }, null, 2));
      });
    },
  );

  server.tool(
    "thincms_restore_snapshot",
    "Write a previously-captured snapshot back to its original resource. Reverts the resource to the exact bytes captured at snapshot time. Fails if the snapshot has expired (24h) or the resource has been deleted. Use as the cleanup step after any test write.",
    {
      snapshotId: z.string().describe("The snapshot ID returned by thincms_snapshot."),
    },
    async (params) => {
      const snap = getSnapshot(params.snapshotId);
      if (!snap) {
        return formatResult({ ok: false, status: 0, data: { error: `Snapshot "${params.snapshotId}" not found. Snapshots expire after 24 hours and are lost on MCP wrapper restart.` } });
      }

      // Resolve credentials for the snapshot's site, regardless of current
      // active state. The restore must hit the same tenant the snapshot
      // captured from — never use whatever happens to be active right now.
      const profile = client.getSites().find((s) => s.siteId === snap.siteId);
      if (!profile) {
        return formatResult({ ok: false, status: 0, data: { error: `Snapshot's site "${snap.siteId}" no longer in THINCMS_SITES config.` } });
      }
      const override = { siteId: profile.siteId, apiKey: profile.apiKey, siteName: profile.name };

      // Restore is itself a write to the snapshot's site. If that site is
      // production-listed and the caller hasn't explicitly acknowledged,
      // the production-write guard fires — which is the correct outcome
      // (restore should be deliberate). Pass the confirmation through.
      return runWithOverride(
        { ...override, confirmProductionWrite: true },
        async () => {
          let result;
          switch (snap.scope.kind) {
            case "settings":
              result = await client.put("/settings", snap.data);
              break;
            case "template":
              result = await client.put("/template", snap.data);
              break;
            case "page":
              result = await client.put(`/pages/${snap.scope.id}`, snap.data);
              break;
            case "post":
              result = await client.put(`/posts/${snap.scope.id}`, snap.data);
              break;
            case "review":
              result = await client.put(`/reviews/${snap.scope.id}`, snap.data);
              break;
          }
          if (!result.ok) return formatResult(result);
          return formatText(JSON.stringify({
            restored: true,
            snapshotId: snap.id,
            siteName: snap.siteName,
            siteId: snap.siteId,
            scope: describeScope(snap.scope),
            capturedAt: snap.capturedAt.toISOString(),
          }, null, 2));
        },
      );
    },
  );

  server.tool(
    "thincms_list_snapshots",
    "List all snapshots taken in the current MCP wrapper session. Useful for finding the right snapshotId to restore, or auditing what test writes have been made.",
    {},
    async () => {
      const snaps = listSnapshots();
      const summary = snaps.map((s) => ({
        snapshotId: s.id,
        siteName: s.siteName,
        siteId: s.siteId,
        scope: describeScope(s.scope),
        capturedAt: s.capturedAt.toISOString(),
        expiresAt: s.expiresAt.toISOString(),
      }));
      return formatText(JSON.stringify({ count: snaps.length, snapshots: summary }, null, 2));
    },
  );
}
