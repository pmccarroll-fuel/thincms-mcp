import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

// Cohorts run one course on their own calendar. Release rules are set once per
// course ("3 days before session 2") and resolved per cohort; overrides change
// one item for one cohort. Dates are ISO 8601 instants — include the offset
// (e.g. 2027-03-02T19:00:00+13:00) or use Z.

const iso = (what: string) => z.string().describe(`${what} — ISO 8601 with offset, e.g. 2027-03-02T19:00:00+13:00`);

const session = z.object({
  number: z.number().int().positive().optional().describe("Session number (default: position in the list, from 1)"),
  title: z.string().nullable().optional(),
  startsAt: iso("Session start"),
  endsAt: iso("Session end").nullable().optional(),
  joinUrl: z.string().nullable().optional().describe("Live session link (Zoom etc.)"),
  recordingUrl: z.string().nullable().optional().describe("Recording link, added after the session"),
});

const cohortFields = {
  name: z.string().describe("Cohort name, e.g. 'PTP Cohort 3 (March 2027)'"),
  slug: z.string().optional().describe("Lowercase-hyphen slug, unique in the course; used in ActiveCampaign tags cohort:<slug>. Default: from the name"),
  timezone: z.string().optional().describe("IANA time zone, e.g. Pacific/Auckland (default: the site's). Learners see dates in this zone"),
  startDate: iso("Cohort start (anchor for 'after start' rules; default the first session)").nullable().optional(),
  endDate: iso("Cohort end (default: a day after the last session)").nullable().optional(),
  enrollmentOpensAt: iso("Self-enrolment opens").nullable().optional(),
  enrollmentClosesAt: iso("Self-enrolment closes").nullable().optional(),
  capacity: z.number().int().positive().nullable().optional().describe("Max learners (null = no limit). Self-enrolment stops when full; admin enrolments may exceed it and are flagged"),
  status: z.enum(["auto", "enrolling", "running", "completed"]).optional().describe("'auto' (default) derives the status from the dates"),
  sessions: z.array(session).optional().describe("Live sessions. On update this REPLACES the whole list"),
};

export function registerCohortTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client,
    "thincms_list_cohorts",
    "List a course's cohorts with sessions, member counts, capacity and effective status (enrolling / running / completed).",
    { courseId: z.string().describe("Course ID") },
    async ({ courseId }) => formatResult(await client.get(`/courses/${courseId}/cohorts`)),
  );

  siteAwareTool(server, client,
    "thincms_get_cohort",
    "Get one cohort with its sessions.",
    { id: z.string().describe("Cohort ID") },
    async ({ id }) => formatResult(await client.get(`/cohorts/${id}`)),
  );

  siteAwareTool(server, client,
    "thincms_create_cohort",
    "Create a cohort of a course, optionally with its live sessions. Then set the course's release rules with thincms_set_cohort_release_schedule (once per course) and enrol learners with thincms_enroll_in_cohort.",
    { courseId: z.string().describe("Course ID"), ...cohortFields },
    async ({ courseId, ...body }) => formatResult(await client.post(`/courses/${courseId}/cohorts`, body)),
  );

  siteAwareTool(server, client,
    "thincms_update_cohort",
    "Update a cohort. Only given fields change; `sessions`, if given, replaces the whole session list (send all of them). Changing dates, name or slug re-syncs members' ActiveCampaign tag and date fields.",
    { id: z.string().describe("Cohort ID"), ...Object.fromEntries(Object.entries(cohortFields).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])) },
    async ({ id, ...body }) => formatResult(await client.put(`/cohorts/${id}`, body)),
  );

  siteAwareTool(server, client,
    "thincms_delete_cohort",
    "Delete a cohort. Its learners stay enrolled in the course without a cohort (they then follow the course's drip mode).",
    { id: z.string().describe("Cohort ID") },
    async ({ id }) => formatResult(await client.delete(`/cohorts/${id}`)),
  );

  siteAwareTool(server, client,
    "thincms_get_release_schedule",
    "Get a course's release schedule: every module and item, its rule, and the resolved release time in each cohort (with source: rule / module-rule / override / override-unlocked / none, and a problem if a rule's session isn't scheduled).",
    { courseId: z.string().describe("Course ID") },
    async ({ courseId }) => formatResult(await client.get(`/courses/${courseId}/release-schedule`)),
  );

  siteAwareTool(server, client,
    "thincms_set_cohort_release_schedule",
    "Set when modules/items open for cohort learners, relative to each cohort's calendar. anchor 'session' + sessionNumber + offsetDays (negative = before, 0 = at the session's start time; items open at the session's time of day), or anchor 'start' + offsetDays after the cohort start. A module rule applies to its items unless an item has its own; a section rule (itemType 'section') applies to the modules and items in it that have no closer rule. anchor null removes a rule. mode 'replace' (default) replaces all rules; 'merge' changes only those given. Items without any rule open on enrolment.",
    {
      courseId: z.string().describe("Course ID"),
      rules: z.array(z.object({
        itemType: z.enum(["section", "module", "lesson", "quiz", "workbook"]),
        itemId: z.string(),
        anchor: z.enum(["session", "start"]).nullable(),
        sessionNumber: z.number().int().positive().nullable().optional(),
        offsetDays: z.number().int().optional().describe("Days relative to the anchor; negative = before"),
      })),
      mode: z.enum(["replace", "merge"]).optional(),
    },
    async ({ courseId, ...body }) => formatResult(await client.put(`/courses/${courseId}/release-rules`, body)),
  );

  siteAwareTool(server, client,
    "thincms_set_cohort_release_override",
    "Exception for one section, module or item in one cohort: a different release time (releaseAt), or unlocked now (unlocked: true). Send neither to remove the override and go back to the course rule.",
    {
      cohortId: z.string().describe("Cohort ID"),
      itemType: z.enum(["section", "module", "lesson", "quiz", "workbook"]),
      itemId: z.string(),
      releaseAt: iso("Release time for this cohort").nullable().optional(),
      unlocked: z.boolean().optional(),
    },
    async ({ cohortId, ...body }) => formatResult(await client.put(`/cohorts/${cohortId}/overrides`, body)),
  );

  siteAwareTool(server, client,
    "thincms_enroll_in_cohort",
    "Enrol a learner by email into a course cohort (no account needed: they get a welcome email with a set-password link that mentions the cohort and first session). If they are already enrolled, they are moved to this cohort. Also tags them cohort:<slug> with session date fields in ActiveCampaign.",
    {
      courseId: z.string().describe("Course ID"),
      cohortId: z.string().describe("Cohort ID"),
      email: z.string(),
      name: z.string().optional(),
      firm: z.string().optional(),
      sendWelcomeAt: z.string().optional().describe("ISO date-time to hold the welcome email until"),
      sendEmail: z.boolean().optional().describe("false = no welcome email"),
    },
    async (body) => formatResult(await client.post("/enrollments", body)),
  );

  siteAwareTool(server, client,
    "thincms_move_enrollment",
    "Move an enrolment to another cohort of the same course (cohortId null = no cohort). The learner's progress, quiz attempts and workbook answers are kept. Swaps the ActiveCampaign cohort tag and dates.",
    {
      id: z.string().describe("Enrollment ID"),
      cohortId: z.string().nullable().describe("Target cohort ID, or null"),
    },
    async ({ id, cohortId }) => formatResult(await client.put(`/enrollments/${id}`, { cohortId })),
  );

  siteAwareTool(server, client,
    "thincms_get_course_progress",
    "Per-learner progress in a course: items completed of total, percent, last activity, cohort and firm. Filter with cohortId ('none' = learners without a cohort).",
    { courseId: z.string(), cohortId: z.string().optional() },
    async ({ courseId, cohortId }) => formatResult(await client.get(`/courses/${courseId}/progress`, cohortId ? { cohortId } : undefined)),
  );

  siteAwareTool(server, client,
    "thincms_get_quiz_results",
    "Best score, pass and attempt count per learner for every quiz in a course. Filter with cohortId ('none' = learners without a cohort).",
    { courseId: z.string(), cohortId: z.string().optional() },
    async ({ courseId, cohortId }) => formatResult(await client.get(`/courses/${courseId}/quiz-results`, cohortId ? { cohortId } : undefined)),
  );

  siteAwareTool(server, client,
    "thincms_list_discussions",
    "List lesson and workbook discussion threads with replies (newest first). Each thread has itemType (lesson | workbook) and item. Learners only see their own cohort's threads; this shows all. Filter by courseId, cohortId ('none' = no cohort), lessonId or workbookId.",
    {
      courseId: z.string().optional(),
      cohortId: z.string().optional(),
      lessonId: z.string().optional(),
      workbookId: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
    async (params) => {
      const q: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) if (v !== undefined) q[k] = String(v);
      return formatResult(await client.get("/discussions", q));
    },
  );

  siteAwareTool(server, client,
    "thincms_reply_discussion",
    "Reply to a discussion thread as the instructor (shown with your name and '(instructor)'). Plain text, up to 5000 characters.",
    { threadId: z.string(), content: z.string() },
    async ({ threadId, content }) => formatResult(await client.post(`/discussions/${threadId}/replies`, { content })),
  );

  siteAwareTool(server, client,
    "thincms_delete_discussion",
    "Remove a discussion thread (with its replies), or a single reply with replyId.",
    { threadId: z.string().optional(), replyId: z.string().optional() },
    async ({ threadId, replyId }) => {
      if (replyId) return formatResult(await client.delete(`/discussion-replies/${replyId}`));
      if (threadId) return formatResult(await client.delete(`/discussions/${threadId}`));
      return formatResult({ ok: false, status: 0, data: { error: "Provide threadId or replyId" } });
    },
  );
}
