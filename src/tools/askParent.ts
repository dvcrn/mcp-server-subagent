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
  input: z.infer<typeof AskParentInputSchema>,
  logDir: string
) {
  const { runId, question } = input;
  const metaPath = join(logDir, `${runId}.meta.json`);

  // Read meta file
  let metaRaw: string;
  try {
    metaRaw = await fs.readFile(metaPath, "utf-8");
  } catch (err) {
    throw new Error(`Could not read meta file for runId ${runId}: ${err}`);
  }

  let metadata: any;
  try {
    metadata = JSON.parse(metaRaw);
  } catch (err) {
    throw new Error(`Meta file for runId ${runId} is not valid JSON: ${err}`);
  }

  // Validate the flat metadata structure
  const parsed = MetaFileContentSchema.safeParse(metadata);
  if (!parsed.success) {
    throw new Error(
      `Meta file for runId ${runId} does not match schema: ${parsed.error}`
    );
  }
  metadata = parsed.data;

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
  if (!Array.isArray(metadata.messages)) {
    metadata.messages = [];
  }
  metadata.messages.push(newMessage);

  // Update status
  metadata.status = "waiting_parent_reply";

  // Write back
  await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));

  return {
    messageId,
    instructions:
      "Poll for the answer using the 'check_message_status' tool with your runId and messageId.",
  };
}
