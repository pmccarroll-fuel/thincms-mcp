import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerAuthorTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_list_authors",
    "List all authors with their bios, avatars, and post counts.",
    {},
    async () => {
      const result = await client.get("/authors");
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_create_author",
    "Create a new author profile with bio, avatar, and social links.",
    {
      name: z.string().describe("Author name (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from name if omitted)"),
      bio: z.string().optional().describe("Author bio/description"),
      avatarUrl: z.string().optional().describe("URL to avatar image"),
      email: z.string().optional().describe("Author email"),
      website: z.string().optional().describe("Author website URL"),
      social: z.record(z.string()).optional().describe("Social links object, e.g. { twitter: '@handle', linkedin: 'url' }"),
    },
    async (params) => {
      const result = await client.post("/authors", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_author",
    "Update an existing author profile. Only provided fields are changed.",
    {
      id: z.string().describe("Author ID (required)"),
      name: z.string().optional().describe("Author name"),
      slug: z.string().optional().describe("URL slug"),
      bio: z.string().optional().describe("Author bio"),
      avatarUrl: z.string().optional().describe("Avatar image URL"),
      email: z.string().optional().describe("Author email"),
      website: z.string().optional().describe("Author website URL"),
      social: z.record(z.string()).optional().describe("Social links object"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/authors/${id}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_author",
    "Delete an author by ID. Posts by this author will have their author unset.",
    {
      id: z.string().describe("Author ID"),
    },
    async (params) => {
      const result = await client.delete(`/authors/${params.id}`);
      return formatResult(result);
    }
  );
}
