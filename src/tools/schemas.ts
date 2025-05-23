import { z } from "zod";

export interface SubagentConfig {
  name: string;
  command: string;
  getArgs: (input: string) => string[];
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
