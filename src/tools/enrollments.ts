import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerEnrollmentTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_enrollments",
    "List course enrollments with optional filters. Returns enrollments with user and course details.",
    {
      courseId: z.string().optional().describe("Filter by course ID"),
      status: z.enum(["pending", "active", "revoked", "completed"]).optional().describe("Filter by enrollment status"),
      page: z.number().int().positive().optional().describe("Page number (default: 1)"),
      limit: z.number().int().positive().max(100).optional().describe("Items per page (default: 50)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.courseId) queryParams.courseId = params.courseId;
      if (params.status) queryParams.status = params.status;
      if (params.page) queryParams.page = String(params.page);
      if (params.limit) queryParams.limit = String(params.limit);
      const result = await client.get("/enrollments", queryParams);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_create_enrollment",
    "Enroll a learner in a course. The user must already exist — specify by email or userId. This bypasses payment requirements, effectively creating a free/invite enrollment.",
    {
      courseId: z.string().describe("Course ID (required)"),
      email: z.string().optional().describe("Learner's email address (looks up existing user)"),
      userId: z.string().optional().describe("User ID (alternative to email)"),
      status: z.enum(["active", "pending"]).optional().describe("Enrollment status (default: active)"),
      source: z.string().optional().describe("Enrollment source label (default: invite)"),
    },
    async (params) => {
      const result = await client.post("/enrollments", params);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_enrollment",
    "Update an enrollment status. Use to approve pending enrollments or revoke access.",
    {
      id: z.string().describe("Enrollment ID (required)"),
      status: z.enum(["active", "revoked"]).describe("New status (required)"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/enrollments/${id}`, body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_delete_enrollment",
    "Delete an enrollment permanently.",
    {
      id: z.string().describe("Enrollment ID"),
    },
    async (params) => {
      const result = await client.delete(`/enrollments/${params.id}`);
      return formatResult(result);
    }
  );
}
