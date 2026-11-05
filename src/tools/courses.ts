import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerCourseTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
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

  siteAwareTool(server, client, 
    "thincms_get_course",
    "Get a single course by ID, including its sections, modules (with sectionId), lessons, quizzes and workbooks.",
    {
      id: z.string().describe("Course ID"),
    },
    async (params) => {
      const result = await client.get(`/courses/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
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
      autoNumbering: z.boolean().optional().describe("Automatic numbering in outlines: \"Module N:\", item numbers and \"Session N:\" (default true). Set false when titles carry their own labels, e.g. \"Belt 3 · Module 1: …\"."),
    },
    async (params) => {
      const result = await client.post("/courses", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
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
      autoNumbering: z.boolean().optional().describe("Automatic numbering in outlines: \"Module N:\", item numbers and \"Session N:\" (default true). Set false when titles carry their own labels, e.g. \"Belt 3 · Module 1: …\"."),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/courses/${id}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
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

  siteAwareTool(server, client, 
    "thincms_create_module",
    "Create a new module within a course. New modules go last in the course (and so last in their section, if sectionId is given).",
    {
      courseId: z.string().describe("Course ID (required)"),
      title: z.string().describe("Module title (required)"),
      description: z.string().optional().describe("Module description"),
      sectionId: z.string().nullable().optional().describe("Put the module in this section (from thincms_create_section); null removes it from its section"),
      requiredForCompletion: z.boolean().optional().describe("false = none of this module's items count toward completion (e.g. a Bonus material module). Default true."),
    },
    async (params) => {
      const { courseId, ...body } = params;
      const result = await client.post(`/courses/${courseId}/modules`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_module",
    "Update a module: title, description, section, or whether its items count toward completion.",
    {
      courseId: z.string().describe("Course ID (required)"),
      moduleId: z.string().describe("Module ID (required)"),
      title: z.string().optional().describe("Module title"),
      description: z.string().optional().describe("Module description"),
      sectionId: z.string().nullable().optional().describe("Put the module in this section (from thincms_create_section); null removes it from its section"),
      requiredForCompletion: z.boolean().optional().describe("false = none of this module's items count toward completion (e.g. a Bonus material module). Default true."),
    },
    async (params) => {
      const { courseId, moduleId, ...body } = params;
      const result = await client.put(`/courses/${courseId}/modules/${moduleId}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
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

  siteAwareTool(server, client, 
    "thincms_reorder_modules",
    "Reorder modules within a course. Pass all module IDs in the desired order: this is the course order. Each section's modules stay together where its first module is; move whole sections with thincms_reorder_sections.",
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

  siteAwareTool(server, client,
    "thincms_reorder_module_items",
    "Reorder lessons, quizzes, and workbooks within a module. All three types share a single sort order space — pass all items in the desired order with their type.",
    {
      moduleId: z.string().describe("Module ID (required)"),
      items: z.array(z.object({
        id: z.string().describe("Lesson, quiz, or workbook ID"),
        type: z.enum(["lesson", "quiz", "workbook"]).describe("Item type"),
      })).describe("Array of items in desired order"),
    },
    async (params) => {
      const result = await client.put(`/modules/${params.moduleId}/reorder`, {
        items: params.items,
      });
      return formatResult(result);
    }
  );

  // ── Sections (groups of modules, e.g. one belt of a program) ──

  siteAwareTool(server, client,
    "thincms_create_section",
    "Create a course section: a group of modules shown to learners as a collapsible outline (one open at a time, opening on the section of the item they last viewed), with progress per section. Put modules in it with thincms_update_module (sectionId); grouping keeps the course order, and the section sits where its first module is. Release rules can target a section (itemType \"section\" in thincms_set_cohort_release_schedule). Sections are written live (not staged in releases).",
    {
      courseId: z.string().describe("Course ID (required)"),
      title: z.string().describe("Section title, e.g. \"Session 1 · Belt 1\" (required)"),
      description: z.string().optional().describe("Short text shown when the section is open"),
      sortOrder: z.number().int().optional().describe("Position (default: last)"),
    },
    async (params) => {
      const { courseId, ...body } = params;
      const result = await client.post(`/courses/${courseId}/sections`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_list_sections",
    "List a course's sections in order, each with its module IDs and titles.",
    {
      courseId: z.string().describe("Course ID (required)"),
    },
    async (params) => {
      const result = await client.get(`/courses/${params.courseId}/sections`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_update_section",
    "Rename a section or change its description or position.",
    {
      courseId: z.string().describe("Course ID (required)"),
      sectionId: z.string().describe("Section ID (required)"),
      title: z.string().optional().describe("Section title"),
      description: z.string().nullable().optional().describe("Section description (null clears it)"),
      sortOrder: z.number().int().optional().describe("Position"),
    },
    async (params) => {
      const { courseId, sectionId, ...body } = params;
      const result = await client.put(`/courses/${courseId}/sections/${sectionId}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_delete_section",
    "Delete a section. Its modules are kept, without a section; release rules and overrides on the section are removed.",
    {
      courseId: z.string().describe("Course ID (required)"),
      sectionId: z.string().describe("Section ID (required)"),
    },
    async (params) => {
      const result = await client.delete(`/courses/${params.courseId}/sections/${params.sectionId}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_reorder_sections",
    "Reorder a course's sections. Pass all section IDs in the desired order; modules move with their section.",
    {
      courseId: z.string().describe("Course ID (required)"),
      sectionIds: z.array(z.string()).describe("Section IDs in the desired order"),
    },
    async (params) => {
      const result = await client.put(`/courses/${params.courseId}/sections/reorder`, { sectionIds: params.sectionIds });
      return formatResult(result);
    }
  );
}
