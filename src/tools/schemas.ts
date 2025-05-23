import { z } from "zod";

export interface SubagentConfig {
  name: string;
  command: string;
  getArgs: (...args: any[]) => string[];
  description: string;
}

export const RunSubagentArgumentsSchema = z.object({
  input: z.string().min(1, "Input cannot be empty"),
  cwd: z.string().min(1, "Working directory path cannot be empty"),
});

export const CheckSubagentStatusArgumentsSchema = z.object({
  runId: z.string().uuid("Run ID must be a valid UUID"),
});

export const GetSubagentLogsArgumentsSchema = z.object({
  runId: z.string().uuid("Run ID must be a valid UUID"),
});

export const UpdateSubagentStatusArgumentsSchema = z.object({
  runId: z.string().uuid("Run ID must be a valid UUID"),
  status: z.enum(["success", "error", "running", "completed"]),
  summary: z.string().optional(),
});

// CommunicationMessage schema and MetaFileContent schema (bi-directional communication design)

export const CommunicationMessageSchema = z.object({
  messageId: z.string(),
  questionContent: z.string(),
  questionTimestamp: z.string(),
  answerContent: z.string().optional(),
  answerTimestamp: z.string().optional(),
  messageStatus: z.enum([
    "pending_parent_reply",
    "parent_replied",
    "parent_acknowledged",
    "acknowledged_by_subagent",
  ]),
});
export type CommunicationMessage = z.infer<typeof CommunicationMessageSchema>;

export const MetaFileContentSchema = z.object({
  // ...other fields as per existing schema, add as needed
  meta: z.object({
    status: z.enum([
      "pending",
      "running",
      "completed",
      "error",
      "waiting_parent_reply",
      "parent_replied",
    ]),
    // ...other meta fields as per existing schema
    messages: z.array(CommunicationMessageSchema).optional(),
  }),
  // ...other fields as per existing schema
});
export type MetaFileContent = z.infer<typeof MetaFileContentSchema>;
