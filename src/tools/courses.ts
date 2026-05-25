import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerCourseTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_courses",
    "List courses with optional filters. Returns courses with module/enrollment counts.",
    {
      status: z.enum(["draft", "published", "archived"]).optional().describe("Filter by status"),
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().max(100).optional().describe("Items per page (default: 20)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.status) queryParams.status = params.status;
      if (params.page) queryParams.page = String(params.page);
      if (params.limit) queryParams.limit = String(params.limit);
      const result = await client.get("/courses", queryParams);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_get_course",
    "Get a single course by ID, including its modules, lessons, and quizzes.",
    {
      id: z.string().describe("Course ID"),
    },
    async (params) => {
      const result = await client.get(`/courses/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_create_course",
    "Create a new course or community. Courses start as draft by default. Set courseType to 'community' for ongoing recording libraries (modules become topics, lessons become recordings, content sorts newest-first). Set accessMode to control enrollment: 'free' (open), 'invite' (admin enrolls learners), or 'purchase' (Stripe payment required).",
    {
      title: z.string().describe("Course title (required)"),
      courseType: z.enum(["course", "community"]).optional().describe("Type: 'course' (structured curriculum) or 'community' (ongoing recordings). Default: course. Communities default to all-at-once drip and sort recordings by date."),
      slug: z.string().optional().describe("URL slug (auto-generated from title if omitted)"),
      summary: z.string().optional().describe("Short plain-text blurb for course catalog cards"),
      description: z.string().optional().describe("Full HTML landing page content"),
      thumbnailUrl: z.string().optional().describe("Thumbnail image URL"),
      showInCatalog: z.boolean().optional().describe("Show on public course catalog page (default: true)"),
      status: z.enum(["draft", "published", "archived"]).optional().describe("Course status (default: draft)"),
      accessMode: z.enum(["invite", "purchase", "free"]).optional().describe("How learners gain access (default: free)"),
      dripMode: z.enum(["all-at-once", "scheduled", "manual", "sequential"]).optional().describe("Content drip mode (default: all-at-once). Ignored for communities."),
      priceAmountCents: z.number().int().optional().describe("Price in cents (for purchase mode)"),
      priceCurrency: z.string().optional().describe("Currency code (default: USD)"),
    },
    async (params) => {
      const result = await client.post("/courses", params);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_course",
    "Update an existing course. Only provided fields are changed (partial update).",
    {
      id: z.string().describe("Course ID (required)"),
      title: z.string().optional().describe("Course title"),
      courseType: z.enum(["course", "community"]).optional().describe("Type: 'course' or 'community'"),
      slug: z.string().optional().describe("URL slug"),
      summary: z.string().optional().describe("Short plain-text blurb"),
      description: z.string().optional().describe("Full HTML landing page content"),
      thumbnailUrl: z.string().optional().describe("Thumbnail image URL"),
      showInCatalog: z.boolean().optional().describe("Show on public course catalog"),
      status: z.enum(["draft", "published", "archived"]).optional().describe("Course status"),
      accessMode: z.enum(["invite", "purchase", "free"]).optional().describe("How learners gain access"),
      dripMode: z.enum(["all-at-once", "scheduled", "manual", "sequential"]).optional().describe("Content drip mode"),
      priceAmountCents: z.number().int().optional().describe("Price in cents"),
      priceCurrency: z.string().optional().describe("Currency code"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/courses/${id}`, body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_delete_course",
    "Delete a course and all its modules, lessons, quizzes, and enrollments.",
    {
      id: z.string().describe("Course ID"),
    },
    async (params) => {
      const result = await client.delete(`/courses/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_create_module",
    "Create a new module within a course. Modules are auto-ordered by creation sequence.",
    {
      courseId: z.string().describe("Course ID (required)"),
      title: z.string().describe("Module title (required)"),
      description: z.string().optional().describe("Module description"),
    },
    async (params) => {
      const { courseId, ...body } = params;
      const result = await client.post(`/courses/${courseId}/modules`, body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_module",
    "Update a module's title or description.",
    {
      courseId: z.string().describe("Course ID (required)"),
      moduleId: z.string().describe("Module ID (required)"),
      title: z.string().optional().describe("Module title"),
      description: z.string().optional().describe("Module description"),
    },
    async (params) => {
      const { courseId, moduleId, ...body } = params;
      const result = await client.put(`/courses/${courseId}/modules/${moduleId}`, body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_delete_module",
    "Delete a module and all its lessons and quizzes.",
    {
      courseId: z.string().describe("Course ID (required)"),
      moduleId: z.string().describe("Module ID (required)"),
    },
    async (params) => {
      const result = await client.delete(`/courses/${params.courseId}/modules/${params.moduleId}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_reorder_modules",
    "Reorder modules within a course. Pass all module IDs in the desired order.",
    {
      courseId: z.string().describe("Course ID (required)"),
      moduleIds: z.array(z.string()).describe("Array of module IDs in desired order"),
    },
    async (params) => {
      const result = await client.put(`/courses/${params.courseId}/modules/reorder`, {
        moduleIds: params.moduleIds,
      });
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_reorder_module_items",
    "Reorder lessons and quizzes within a module. Lessons and quizzes share a single sort order space — pass all items in the desired order with their type.",
    {
      moduleId: z.string().describe("Module ID (required)"),
      items: z.array(z.object({
        id: z.string().describe("Lesson or quiz ID"),
        type: z.enum(["lesson", "quiz"]).describe("Item type"),
      })).describe("Array of items in desired order"),
    },
    async (params) => {
      const result = await client.put(`/modules/${params.moduleId}/reorder`, {
        items: params.items,
      });
      return formatResult(result);
    }
  );
}
