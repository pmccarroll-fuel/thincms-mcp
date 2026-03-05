# ThinCMS MCP Server

MCP (Model Context Protocol) server for [ThinCMS](https://github.com/pmccarroll-fuel/thincms). Gives AI agents typed tool access to your ThinCMS site — no HTTP boilerplate, no header construction, no JSON encoding.

## What it does

Wraps the ThinCMS REST API as **45 typed tools** that any MCP-compatible AI client can call directly. Instead of constructing HTTP requests, agents call tools like `thincms_create_post(title, content, status)` and get structured responses back.

## Requirements

- Node.js 18+
- A running ThinCMS instance
- An API key from ThinCMS (Admin > API Keys)
- An MCP-compatible client (Claude Desktop, Claude Code, VS Code, etc.)

## Setup

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

Uses the same API key auth as the REST API. API keys grant **editor-level** access — full CRUD on content, forms, templates, navigation, scripts, and secrets. Cannot change site settings, manage users, or run imports/backups.

## Development

```bash
npm install
npm run build     # Compile TypeScript
npm run dev       # Run with tsx (for development)
```

## License

MIT
