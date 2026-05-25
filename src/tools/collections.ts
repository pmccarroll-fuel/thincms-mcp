import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerCollectionTools(server: McpServer, client: ThinCMSClient) {
  // --- Collection CRUD ---

  siteAwareTool(server, client, 
    "thincms_list_collections",
    "List all collections for the site. Collections are structured data lists (testimonials, reviews, products, team members) that render via {{collection:slug}} template tag in multiple display modes: cards, carousel, banner, list, compact.",
    {
      enabled: z.enum(["true", "false"]).optional().describe("Filter by enabled status"),
    },
    async (params) => {
      const query = params.enabled ? `?enabled=${params.enabled}` : "";
      const result = await client.get(`/collections${query}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_collection",
    "Get a single collection by ID, including all its items.",
    {
      id: z.string().describe("Collection ID"),
    },
    async (params) => {
      const result = await client.get(`/collections/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_create_collection",
    "Create a new collection. Display modes: 'cards' (grid), 'carousel' (horizontal scroll), 'banner' (full-width rotating), 'list' (vertical stack), 'compact' (smaller grid). Embed with {{collection:slug}} in page frame or content.",
    {
      name: z.string().describe("Collection name"),
      slug: z.string().optional().describe("URL-safe slug (auto-generated from name if omitted)"),
      description: z.string().optional().describe("Internal description/note"),
      displayMode: z.enum(["cards", "carousel", "banner", "list", "compact"]).optional().describe("Display mode (default: cards)"),
      maxItems: z.number().optional().describe("Max items to show, 0 = all (default: 0)"),
      columns: z.number().optional().describe("Grid columns for cards/compact/carousel (default: 3)"),
      showTitle: z.boolean().optional().describe("Show item titles (default: true)"),
      showSubtitle: z.boolean().optional().describe("Show item subtitles (default: true)"),
      showImage: z.boolean().optional().describe("Show item images (default: true)"),
      showRating: z.boolean().optional().describe("Show item ratings (default: true)"),
      showLink: z.boolean().optional().describe("Show item links (default: true)"),
      autoAdvance: z.boolean().optional().describe("Auto-advance carousel/banner (default: false)"),
      advanceInterval: z.number().optional().describe("Seconds between auto-advance slides (default: 5)"),
      enabled: z.boolean().optional().describe("Whether the collection is active (default: true)"),
      sortOrder: z.number().optional().describe("Sort order for listing (default: 0)"),
      schemaType: z.enum(["none", "faq"]).optional().describe("Schema.org type to auto-emit on pages that render this collection via {{collection:slug}}. 'faq' emits FAQPage JSON-LD using each item's title as the question and body as the answer. Default 'none'."),
    },
    async (params) => {
      const result = await client.post("/collections", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_collection",
    "Update collection settings. Supports partial updates.",
    {
      id: z.string().describe("Collection ID"),
      name: z.string().optional().describe("Collection name"),
      slug: z.string().optional().describe("URL-safe slug"),
      description: z.string().optional().describe("Internal description/note"),
      displayMode: z.enum(["cards", "carousel", "banner", "list", "compact"]).optional().describe("Display mode"),
      maxItems: z.number().optional().describe("Max items to show, 0 = all"),
      columns: z.number().optional().describe("Grid columns"),
      showTitle: z.boolean().optional().describe("Show item titles"),
      showSubtitle: z.boolean().optional().describe("Show item subtitles"),
      showImage: z.boolean().optional().describe("Show item images"),
      showRating: z.boolean().optional().describe("Show item ratings"),
      showLink: z.boolean().optional().describe("Show item links"),
      autoAdvance: z.boolean().optional().describe("Auto-advance carousel/banner"),
      advanceInterval: z.number().optional().describe("Seconds between auto-advance slides"),
      enabled: z.boolean().optional().describe("Whether the collection is active"),
      sortOrder: z.number().optional().describe("Sort order"),
      schemaType: z.enum(["none", "faq"]).optional().describe("Schema.org type to auto-emit. 'faq' emits FAQPage JSON-LD on pages that render this collection."),
    },
    async (params) => {
      const { id, ...data } = params;
      const result = await client.put(`/collections/${id}`, data);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_collection",
    "Delete a collection and all its items. Any {{collection:slug}} references will render as empty.",
    {
      id: z.string().describe("Collection ID to delete"),
    },
    async (params) => {
      const result = await client.delete(`/collections/${params.id}`);
      return formatResult(result);
    }
  );

  // --- Collection Item CRUD ---

  siteAwareTool(server, client, 
    "thincms_list_collection_items",
    "List all items in a collection, ordered by sortOrder.",
    {
      collectionId: z.string().describe("Collection ID"),
      enabled: z.enum(["true", "false"]).optional().describe("Filter by enabled status"),
    },
    async (params) => {
      const query = params.enabled ? `?enabled=${params.enabled}` : "";
      const result = await client.get(`/collections/${params.collectionId}/items${query}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_create_collection_item",
    "Add an item to a collection. The 'body' field is required (main content, can be HTML). Other fields are optional and visibility depends on the collection's show* settings.",
    {
      collectionId: z.string().describe("Collection ID"),
      title: z.string().optional().describe("Item title (e.g., person name, product name)"),
      subtitle: z.string().optional().describe("Subtitle (e.g., role, company, price)"),
      body: z.string().describe("Main content text or HTML (required)"),
      imageUrl: z.string().optional().describe("Image URL (photo, product image, logo)"),
      linkUrl: z.string().optional().describe("Link URL (product page, profile, etc.)"),
      linkText: z.string().optional().describe("Link button text (default: 'Learn more')"),
      rating: z.number().min(1).max(5).optional().describe("Rating 1-5 (for reviews/testimonials)"),
      sortOrder: z.number().optional().describe("Sort order (auto-assigned to end if omitted)"),
      enabled: z.boolean().optional().describe("Whether item is visible (default: true)"),
    },
    async (params) => {
      const { collectionId, ...data } = params;
      const result = await client.post(`/collections/${collectionId}/items`, data);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_collection_item",
    "Update a collection item. Supports partial updates.",
    {
      collectionId: z.string().describe("Collection ID"),
      itemId: z.string().describe("Item ID"),
      title: z.string().optional().describe("Item title"),
      subtitle: z.string().optional().describe("Subtitle"),
      body: z.string().optional().describe("Main content text or HTML"),
      imageUrl: z.string().optional().describe("Image URL"),
      linkUrl: z.string().optional().describe("Link URL"),
      linkText: z.string().optional().describe("Link button text"),
      rating: z.number().min(1).max(5).optional().describe("Rating 1-5"),
      sortOrder: z.number().optional().describe("Sort order"),
      enabled: z.boolean().optional().describe("Whether item is visible"),
    },
    async (params) => {
      const { collectionId, itemId, ...data } = params;
      const result = await client.put(`/collections/${collectionId}/items/${itemId}`, data);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_collection_item",
    "Delete an item from a collection.",
    {
      collectionId: z.string().describe("Collection ID"),
      itemId: z.string().describe("Item ID to delete"),
    },
    async (params) => {
      const result = await client.delete(`/collections/${params.collectionId}/items/${params.itemId}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_reorder_collection_items",
    "Bulk reorder items in a collection. Pass an array of { id, sortOrder } pairs.",
    {
      collectionId: z.string().describe("Collection ID"),
      items: z.array(z.object({
        id: z.string().describe("Item ID"),
        sortOrder: z.number().describe("New sort order"),
      })).describe("Array of { id, sortOrder } pairs"),
    },
    async (params) => {
      const result = await client.put(`/collections/${params.collectionId}/items/reorder`, { items: params.items });
      return formatResult(result);
    }
  );
}
