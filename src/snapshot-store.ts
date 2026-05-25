// In-memory snapshot store for the snapshot+restore safety pattern.
// Per-process (lives until the MCP wrapper restarts); not persisted to disk.
// Designed for the test-cleanup workflow: take a snapshot before a write,
// restore by ID after, get exact pre-write bytes back.

import { randomUUID } from "node:crypto";

export type SnapshotScope =
  | { kind: "settings" }
  | { kind: "template" }
  | { kind: "page"; id: string }
  | { kind: "post"; id: string }
  | { kind: "review"; id: string };

export interface Snapshot {
  id: string;
  siteId: string;
  siteName: string;
  scope: SnapshotScope;
  capturedAt: Date;
  expiresAt: Date;
  data: any;
}

const TTL_MS = 24 * 60 * 60 * 1000; // 24h
const _store = new Map<string, Snapshot>();

export function createSnapshot(
  siteId: string,
  siteName: string,
  scope: SnapshotScope,
  data: any,
): Snapshot {
  pruneExpired();
  const now = new Date();
  const snap: Snapshot = {
    id: randomUUID(),
    siteId,
    siteName,
    scope,
    capturedAt: now,
    expiresAt: new Date(now.getTime() + TTL_MS),
    data,
  };
  _store.set(snap.id, snap);
  return snap;
}

export function getSnapshot(id: string): Snapshot | null {
  pruneExpired();
  return _store.get(id) ?? null;
}

export function listSnapshots(): Snapshot[] {
  pruneExpired();
  return Array.from(_store.values()).sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, snap] of _store) {
    if (snap.expiresAt.getTime() < now) _store.delete(id);
  }
}

export function describeScope(scope: SnapshotScope): string {
  switch (scope.kind) {
    case "settings": return "settings";
    case "template": return "template";
    case "page": return `page:${scope.id}`;
    case "post": return `post:${scope.id}`;
    case "review": return `review:${scope.id}`;
  }
}
