import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool, resolveContentInput, uploadIdField, LOCAL_ONLY } from "../helpers.js";

// Learners are per-site member accounts. Enrolling an email that has no
// account creates one and sends a welcome email with a set-password link.

const sendWelcomeAt = z.string().optional().describe(
  "ISO date-time to hold the welcome email until (e.g. to land with a pre-start sequence). Omit to send now.",
);

export function registerEnrollmentTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client,
    "thincms_list_enrollments",
    "List course enrollments. Each has `member` (id, email, name, firm, hasSignedIn, canSignIn), course, status and welcome-email state (welcomeEmailSentAt / welcomeEmailScheduledFor / welcomeEmailError). Also returns `firms` for grouping.",
    {
      courseId: z.string().optional().describe("Filter by course ID"),
      cohortId: z.string().optional().describe("Filter by cohort ID ('none' = learners without a cohort)"),
      status: z.enum(["pending", "active", "revoked", "completed"]).optional().describe("Filter by enrollment status"),
      firm: z.string().optional().describe("Filter by the learner's firm/team"),
      search: z.string().optional().describe("Search learner email or name"),
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().max(500).optional().describe("Items per page (default: 50)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) queryParams[k] = String(v);
      }
      const result = await client.get("/enrollments", queryParams);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_create_enrollment",
    "Enrol a learner in a course by email, without payment. The person does not need an account: one is created and they get a welcome email with a link to set their password (valid 14 days), which signs them in and opens the course. Existing members get a 'go to course' email. Re-enrolling someone already enrolled changes nothing except name/firm. The response's welcomeEmail says whether the email was sent, scheduled or failed (e.g. email not configured — check with thincms_test_smtp).",
    {
      courseId: z.string().describe("Course ID (required)"),
      email: z.string().describe("Learner's email address (required)"),
      name: z.string().optional().describe("Learner's name"),
      firm: z.string().optional().describe("Learner's firm or team, for grouping seats from one organisation"),
      cohortId: z.string().optional().describe("Put the learner in this cohort (see thincms_list_cohorts)"),
      sendWelcomeAt,
      sendEmail: z.boolean().optional().describe("Set false to enrol without any welcome email (default true)"),
    },
    async (params) => {
      const result = await client.post("/enrollments", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_import_learners",
    "Bulk-enrol learners in a course (one row per seat). Same behaviour as thincms_create_enrollment for each row. Give either `learners` (array) or a CSV with a header row containing `email` and optionally `name`, `firm` and `cohort` (slug or name) (as csv, csvFile or csvUploadId). Returns a summary plus per-row results and errors. Max 500 rows per call.",
    {
      courseId: z.string().describe("Course ID (required)"),
      learners: z.array(z.object({
        email: z.string(),
        name: z.string().optional(),
        firm: z.string().optional(),
        cohort: z.string().optional().describe("Cohort slug or name"),
      })).optional().describe("Learners to enrol"),
      cohortId: z.string().optional().describe("Default cohort for rows without their own"),
      csv: z.string().optional().describe("CSV text with a header row (email, name, firm)"),
      csvFile: z.string().optional().describe("Local path to the CSV" + LOCAL_ONLY),
      csvUploadId: uploadIdField("the CSV"),
      sendWelcomeAt,
      sendEmail: z.boolean().optional().describe("Set false to enrol without welcome emails (default true)"),
    },
    async (params) => {
      const { courseId, learners, csv, csvFile, csvUploadId, sendWelcomeAt: when, sendEmail, cohortId } = params;
      const resolved = await resolveContentInput(client, { inline: csv, file: csvFile, uploadId: csvUploadId }, { inline: "csv", file: "csvFile", upload: "csvUploadId" });
      if (!resolved.ok) return formatResult(resolved.error);
      if (resolved.value === undefined && !learners) {
        return formatResult({ ok: false, status: 0, data: { error: "Provide learners, csv, csvFile or csvUploadId" } });
      }
      const body: Record<string, unknown> = { sendWelcomeAt: when, sendEmail, cohortId };
      if (resolved.value !== undefined) body.csv = resolved.value;
      else body.rows = learners;
      const result = await client.post(`/courses/${courseId}/learners/import`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_resend_enrollment_invite",
    "Send the welcome email for an active enrollment again now. Learners who haven't set a password get a fresh 14-day set-password link.",
    {
      id: z.string().describe("Enrollment ID"),
    },
    async (params) => {
      const result = await client.post(`/enrollments/${params.id}/resend-invite`, {});
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_update_enrollment",
    "Update an enrollment: approve a pending request (status active — this emails the learner), revoke or reinstate access, or change the learner's name/firm.",
    {
      id: z.string().describe("Enrollment ID (required)"),
      status: z.enum(["active", "revoked", "pending", "completed"]).optional().describe("New status"),
      cohortId: z.string().nullable().optional().describe("Move to this cohort (null = no cohort); progress is kept"),
      name: z.string().optional().describe("Learner's name"),
      firm: z.string().optional().describe("Learner's firm or team (empty string clears it)"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/enrollments/${id}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client,
    "thincms_delete_enrollment",
    "Delete an enrollment permanently (the learner's member account is kept).",
    {
      id: z.string().describe("Enrollment ID"),
    },
    async (params) => {
      const result = await client.delete(`/enrollments/${params.id}`);
      return formatResult(result);
    }
  );
}
