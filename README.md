# ThinCMS MCP Server

MCP (Model Context Protocol) server for [ThinCMS](https://github.com/pmccarroll-fuel/thincms). Gives AI agents typed tool access to your ThinCMS site — no HTTP boilerplate, no header construction, no JSON encoding.

## What it does

Wraps the ThinCMS REST API as **45 typed tools** that any MCP-compatible AI client can call directly. Instead of constructing HTTP requests, agents call tools like `thincms_create_post(title, content, status)` and get structured responses back.

## Connect to the hosted server (recommended)

ThinCMS hosts this server at `https://<admin host>/mcp`. You sign in with your ThinCMS account (Google). No API keys needed.

1. A site admin enables **MCP access** for you in ThinCMS (**Settings > Users > Edit**) and picks a level per site: read-only, editor or admin.
2. Add the server:
   - **Claude (web / desktop):** Settings → Connectors → Add custom connector → paste the URL → Connect.
   - **Claude Code:** `claude mcp add --transport http thincms https://<admin host>/mcp`, then `/mcp` to sign in.
3. Ask for a site by name. `thincms_list_sites` shows your sites and access level; every tool's `siteId` accepts a site ID or name.

The hosted server can't access your filesystem: use `url` or `base64` for uploads instead of `filePath`; exports are returned in the response.

### Running the hosted server

```bash
npm run build
MCP_PUBLIC_URL=https://app.thincms.ai/mcp THINCMS_INTERNAL_URL=http://127.0.0.1:3000 PORT=3100 npm run start:http
```

ThinCMS acts as the OAuth authorization server. This process validates bearer tokens via `GET /api/v1/mcp/me` and forwards them to the REST API, which enforces each user's MCP permissions. In production it runs as the `thincms-mcp` PM2 app (see `../thincms/ecosystem.config.js`) behind nginx (`../thincms/deploy/nginx-mcp.conf`). Deploy with `bash deploy.sh`.

## Local / self-hosted (stdio)

### Requirements

- Node.js 18+
- A running ThinCMS instance
- An API key from ThinCMS (Admin > API Keys)
- An MCP-compatible client (Claude Desktop, Claude Code, VS Code, etc.)

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "thincms": {
      "command": "npx",
      "args": ["tsx", "/path/to/thincms-mcp/src/index.ts"],
      "env": {
        "THINCMS_BASE_URL": "https://your-domain.com",
        "THINCMS_API_KEY": "tcms_your_key_here",
        "THINCMS_SITE_ID": "your_site_id_here"
      }
    }
  }
}
```

### Claude Code

Same configuration in `.claude/settings.json` or global Claude Code settings.

## Available tools

| Group | Tools |
|---|---|
| Posts | `list_posts`, `get_post`, `create_post`, `update_post`, `delete_post`, `bulk_create_posts` |
| Pages | `list_pages`, `get_page`, `create_page`, `update_page`, `delete_page` |
| Categories | `list_categories`, `create_category`, `update_category`, `delete_category` |
| Authors | `list_authors`, `create_author`, `update_author`, `delete_author` |
| Tags | `list_tags`, `create_tag` |
| Media | `list_media`, `get_media`, `upload_media`, `update_media`, `delete_media` |
| Template | `get_template`, `update_template` |
| Navigation | `get_navigation`, `update_navigation` |
| Settings | `get_settings` (read-only) |
| Scripts | `list_scripts`, `create_script`, `update_script` |
| Secrets | `list_secrets`, `create_secret` |
| Forms | `list_forms`, `get_form`, `create_form`, `update_form` |
| Submissions | `list_submissions`, `export_submissions_csv` |
| Search | `search` |
| Preview | `create_preview`, `get_preview_url` |

All tool names are prefixed with `thincms_` (e.g., `thincms_list_posts`).

## Permissions

**Hosted:** each user's MCP level per site (read-only / editor / admin), capped by their normal site role and checked live on every call.

**Local:** uses the same API key auth as the REST API. API keys grant **editor-level** access — full CRUD on content, forms, templates, navigation, scripts, and secrets. Cannot change site settings, manage users, or run imports/backups.

## Development

```bash
npm install
npm run build     # Compile TypeScript
npm run dev       # Run stdio server with tsx (for development)
npm run dev:http  # Run hosted server with tsx (needs MCP_PUBLIC_URL)
npx tsx tests/hosted-e2e.ts   # End-to-end OAuth + hosted MCP test (needs both servers running locally)
```

## License

MIT
