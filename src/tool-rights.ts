// Module rights for MCP tools (ThinCMS enhancement request P-3).
//
// Every tool belongs to one ThinCMS module (set per tool file in
// tools/index.ts) and needs either `view` or `edit` on it, decided by the
// verb in its name. A session lists only the tools the user's rights allow on
// the active site; switching site or a rights change re-applies the gate.
//
// This is about what an agent can see. The REST API still checks every call,
// including finer limits such as admin-only actions inside a module.

export type Module =
  | "content" | "marketing" | "courses" | "tools" | "reviews" | "chat"
  | "analytics" | "documents" | "administration";
export type Level = "none" | "view" | "edit" | "manage";
export type Rights = Partial<Record<Module, Level>> & { grants?: Record<string, boolean> };

const RANK: Record<Level, number> = { none: 0, view: 1, edit: 2, manage: 3 };

// Verbs that change something. A tool whose name (after `thincms_`, and after
// a module word like `chat_` or `analytics_annotations_`) starts with one of
// these needs `edit`; everything else needs `view`.
const WRITE_VERBS = [
  "create", "update", "delete", "patch", "append", "bulk", "publish", "unpublish",
  "schedule", "stage", "unstage", "discard", "restore", "go_live", "send", "import",
  "generate", "reorder", "move", "enroll", "add", "set", "clear", "pause", "reply",
  "resend", "sync", "re_analyze", "upload", "prepare_upload", "revoke", "erase", "test",
  "withdraw", "void",
  // Previewing a document issues a preview link: a POST that needs Documents edit.
  "preview",
];

export function requiredLevel(toolName: string): Level {
  const words = toolName.replace(/^thincms_/, "").split("_");
  // A leading read verb wins: thincms_get_release_schedule only reads.
  if (["get", "list", "search", "diff", "export", "check"].includes(words[0])) return "view";
  // Check each position so `chat_update_handover` and
  // `analytics_annotations_create` count as writes.
  for (let i = 0; i < words.length; i++) {
    const rest = words.slice(i).join("_");
    if (WRITE_VERBS.some((v) => rest === v || rest.startsWith(v + "_"))) return "edit";
  }
  return "view";
}

// Tools that need more than their verb implies (the API checks the same).
const LEVEL_OVERRIDES: Record<string, Level> = {
  thincms_create_document_type: "manage",
  thincms_update_document_type: "manage",
};

// Tools that also need a separately granted permission (P-7).
const GRANT_REQUIRED: Record<string, string> = {
  thincms_void_document: "documents.void",
};

// Tools whose module differs from their file's.
const MODULE_OVERRIDES: Record<string, Module> = {
  thincms_go_live: "administration",
};

export function allows(rights: Rights | undefined, module: Module | null, level: Level): boolean {
  if (module === null) return true; // always-available tools (site switching, capabilities)
  if (!rights) return true; // no rights reported (local API-key mode): leave it to the REST API
  const have = rights[module] ?? "none";
  return RANK[have] >= RANK[level];
}

interface GatedTool {
  tool: { enabled: boolean };
  module: Module | null;
  level: Level;
  grant?: string;
}

function permitted(rights: Rights | undefined, g: GatedTool): boolean {
  if (!allows(rights, g.module, g.level)) return false;
  if (g.grant && rights) return rights.grants?.[g.grant] === true;
  return true;
}

/** Per-server record of every tool's module and required level. */
export class ToolGate {
  private tools = new Map<string, GatedTool>();
  private notify: (() => void) | null = null;

  add(name: string, tool: { enabled: boolean }, module: Module | null): void {
    this.tools.set(name, { tool, module: MODULE_OVERRIDES[name] ?? module, level: LEVEL_OVERRIDES[name] ?? requiredLevel(name), grant: GRANT_REQUIRED[name] });
  }

  /** Called once the server can send notifications. */
  onChange(fn: () => void): void {
    this.notify = fn;
  }

  /** May this tool run on a site with these rights? */
  check(name: string, rights: Rights | undefined): { ok: true } | { ok: false; module: Module; level: Level } {
    const g = this.tools.get(name);
    if (!g || permitted(rights, g)) return { ok: true };
    return { ok: false, module: g.module!, level: g.level };
  }

  /** Enable exactly the tools these rights allow. Sends one list-changed notice if anything changed. */
  apply(rights: Rights | undefined): void {
    let changed = false;
    for (const g of this.tools.values()) {
      const enabled = permitted(rights, g);
      if (g.tool.enabled !== enabled) {
        g.tool.enabled = enabled;
        changed = true;
      }
    }
    if (changed && this.notify) {
      try { this.notify(); } catch { /* not connected yet */ }
    }
  }

  enabledNames(): string[] {
    return [...this.tools].filter(([, g]) => g.tool.enabled).map(([n]) => n);
  }
}
