// askParent.ts: Implements the ask_parent MCP tool for subagent-to-parent communication

import { promises as fs } from "fs";
import { join } from "path";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  MetaFileContentSchema,
  CommunicationMessageSchema,
} from "./schemas.js";

export const AskParentInputSchema = z.object({
  runId: z.string().uuid("Run ID must be a valid UUID"),
  question: z.string().min(1, "Question cannot be empty"),
});

export const AskParentOutputSchema = z.object({
  messageId: z.string(),
  instructions: z.string(),
});

export async function askParentHandler(
  input: z.infer<typeof AskParentInputSchema>
) {
  const { runId, question } = input;
  const metaPath = join("runs", runId, ".meta.json");

  // Read meta file
  let metaRaw: string;
  try {
    metaRaw = await fs.readFile(metaPath, "utf-8");
  } catch (err) {
    throw new Error(`Could not read meta file for runId ${runId}: ${err}`);
  }

  let meta: any;
  try {
    meta = JSON.parse(metaRaw);
  } catch (err) {
    throw new Error(`Meta file for runId ${runId} is not valid JSON: ${err}`);
  }

  // Validate and coerce to schema
  const parsed = MetaFileContentSchema.safeParse(meta);
  if (!parsed.success) {
    throw new Error(
      `Meta file for runId ${runId} does not match schema: ${parsed.error}`
    );
  }
  meta = parsed.data;

  // Prepare new message
  const messageId = uuidv4();
  const now = new Date().toISOString();
  const newMessage = {
    messageId,
    questionContent: question,
    questionTimestamp: now,
    answerContent: undefined, // Initialize as undefined
    answerTimestamp: undefined, // Initialize as undefined
    messageStatus: "pending_parent_reply",
  };

  // Ensure messages array is initialized
  if (!Array.isArray(meta.meta.messages)) {
    meta.meta.messages = [];
  }
  meta.meta.messages.push(newMessage);

  // Update status
  meta.meta.status = "waiting_parent_reply";

  // Write back
  console.log(
    "DEBUG: Writing updated meta file:",
    JSON.stringify(meta, null, 2)
  );
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

  return {
    messageId,
    instructions:
      "Poll for the answer using the 'check_message_status' tool with your runId and messageId.",
  };
}
