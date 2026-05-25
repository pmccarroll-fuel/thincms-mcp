import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ThinCMSClient } from "../client.js";
import { formatResult, siteAwareTool } from "../helpers.js";

export function registerQuizTools(server: McpServer, client: ThinCMSClient) {
  siteAwareTool(server, client, 
    "thincms_create_quiz",
    "Create a new quiz within a module. Quizzes share sort order with lessons — use thincms_reorder_module_items to position them. Two feedback modes: 'show_answer' reveals correct answers after submission, 'retry' shows only the score.",
    {
      moduleId: z.string().describe("Module ID (required)"),
      title: z.string().describe("Quiz title (required)"),
      slug: z.string().optional().describe("URL slug (auto-generated from title if omitted)"),
      feedbackMode: z.enum(["show_answer", "retry"]).optional().describe("Feedback mode (default: show_answer)"),
      passingScore: z.number().int().min(0).max(100).optional().describe("Passing score percentage (default: 70)"),
    },
    async (params) => {
      const result = await client.post("/quizzes", params);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_get_quiz",
    "Get a single quiz by ID, including its questions with correct answers.",
    {
      id: z.string().describe("Quiz ID"),
    },
    async (params) => {
      const result = await client.get(`/quizzes/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_quiz",
    "Update a quiz. Only provided fields are changed.",
    {
      id: z.string().describe("Quiz ID (required)"),
      title: z.string().optional().describe("Quiz title"),
      slug: z.string().optional().describe("URL slug"),
      feedbackMode: z.enum(["show_answer", "retry"]).optional().describe("Feedback mode"),
      passingScore: z.number().int().min(0).max(100).optional().describe("Passing score percentage"),
    },
    async (params) => {
      const { id, ...body } = params;
      const result = await client.put(`/quizzes/${id}`, body);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_quiz",
    "Delete a quiz and all its questions and attempts.",
    {
      id: z.string().describe("Quiz ID"),
    },
    async (params) => {
      const result = await client.delete(`/quizzes/${params.id}`);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_add_quiz_question",
    "Add a question to a quiz. Each question has 2-5 answer options and one correct answer identified by index (0-based).",
    {
      quizId: z.string().describe("Quiz ID (required)"),
      questionText: z.string().describe("The question text (required)"),
      options: z.array(z.string()).min(2).max(5).describe("Array of 2-5 answer option strings (required)"),
      correctIndex: z.number().int().min(0).describe("Index of the correct answer in the options array (0-based, required)"),
      explanation: z.string().optional().describe("Explanation shown after answering (for show_answer mode)"),
      sortOrder: z.number().int().optional().describe("Position within the quiz (auto-assigned if omitted)"),
    },
    async (params) => {
      const { quizId, ...body } = params;
      const result = await client.post(`/quizzes/${quizId}/questions`, {
        ...body,
        options: JSON.stringify(body.options),
      });
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_update_quiz_question",
    "Update a quiz question. Only provided fields are changed.",
    {
      quizId: z.string().describe("Quiz ID (required)"),
      questionId: z.string().describe("Question ID (required)"),
      questionText: z.string().optional().describe("The question text"),
      options: z.array(z.string()).min(2).max(5).optional().describe("Array of 2-5 answer option strings"),
      correctIndex: z.number().int().min(0).optional().describe("Index of the correct answer (0-based)"),
      explanation: z.string().optional().describe("Explanation shown after answering"),
      sortOrder: z.number().int().optional().describe("Position within the quiz"),
    },
    async (params) => {
      const { quizId, questionId, ...body } = params;
      const sendBody: any = { ...body };
      if (body.options) {
        sendBody.options = JSON.stringify(body.options);
      }
      const result = await client.put(`/quizzes/${quizId}/questions/${questionId}`, sendBody);
      return formatResult(result);
    }
  );

  siteAwareTool(server, client, 
    "thincms_delete_quiz_question",
    "Delete a question from a quiz.",
    {
      quizId: z.string().describe("Quiz ID (required)"),
      questionId: z.string().describe("Question ID (required)"),
    },
    async (params) => {
      const result = await client.delete(`/quizzes/${params.quizId}/questions/${params.questionId}`);
      return formatResult(result);
    }
  );
}
