import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult } from "../helpers.js";

export function registerSequenceTools(server: McpServer, client: ThinCMSClient) {
  server.tool(
    "thincms_list_sequences",
    "List email sequences (drip campaigns) with their steps.",
    {},
    async () => {
      const result = await client.get("/sequences");
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_create_sequence",
    "Create a new email sequence.",
    {
      name: z.string().describe("Sequence name"),
      triggerFormSlug: z.string().optional().describe("Form slug that triggers enrollment"),
    },
    async (params) => {
      const result = await client.post("/sequences", params);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_get_sequence",
    "Get a sequence by ID, including its steps.",
    { id: z.string().describe("Sequence ID") },
    async (params) => {
      const result = await client.get(`/sequences/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_sequence",
    "Update a sequence's name or trigger form.",
    {
      id: z.string().describe("Sequence ID"),
      name: z.string().optional(),
      triggerFormSlug: z.string().optional(),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/sequences/${id}`, body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_delete_sequence",
    "Delete a sequence and all its steps.",
    { id: z.string().describe("Sequence ID") },
    async (params) => {
      const result = await client.delete(`/sequences/${params.id}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_add_sequence_step",
    "Add a step to a sequence.",
    {
      sequenceId: z.string().describe("Sequence ID"),
      subject: z.string().describe("Email subject"),
      htmlContent: z.string().describe("Email HTML body"),
      delayDays: z.number().int().min(0).optional().describe("Days to wait after previous step (0 = immediate)"),
    },
    async (params) => {
      const { sequenceId, ...body } = params;
      const result = await client.post(`/sequences/${sequenceId}/steps`, body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_update_sequence_step",
    "Update a sequence step.",
    {
      sequenceId: z.string().describe("Sequence ID"),
      stepId: z.string().describe("Step ID"),
      subject: z.string().optional(),
      htmlContent: z.string().optional(),
      delayDays: z.number().int().min(0).optional(),
    },
    async (params) => {
      const { sequenceId, stepId, ...body } = params;
      const result = await client.put(`/sequences/${sequenceId}/steps/${stepId}`, body);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_delete_sequence_step",
    "Delete a step from a sequence.",
    {
      sequenceId: z.string().describe("Sequence ID"),
      stepId: z.string().describe("Step ID"),
    },
    async (params) => {
      const result = await client.delete(`/sequences/${params.sequenceId}/steps/${params.stepId}`);
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_reorder_sequence_steps",
    "Reorder steps in a sequence.",
    {
      sequenceId: z.string().describe("Sequence ID"),
      stepIds: z.array(z.string()).describe("Step IDs in desired order"),
    },
    async (params) => {
      const result = await client.put(`/sequences/${params.sequenceId}/steps/reorder`, { stepIds: params.stepIds });
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_publish_sequence",
    "Publish a sequence as an automation in the email platform.",
    { id: z.string().describe("Sequence ID") },
    async (params) => {
      const result = await client.post(`/sequences/${params.id}/publish`, {});
      return formatResult(result);
    }
  );

  server.tool(
    "thincms_pause_sequence",
    "Pause a published sequence automation.",
    { id: z.string().describe("Sequence ID") },
    async (params) => {
      const result = await client.post(`/sequences/${params.id}/pause`, {});
      return formatResult(result);
    }
  );
}
