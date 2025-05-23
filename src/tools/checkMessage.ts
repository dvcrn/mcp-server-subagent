import { promises as fs } from "fs";
import { join } from "path";
import { z } from "zod";
import type { CommunicationMessage } from "./schemas.js";

export const CheckMessageStatusArgumentsSchema = z.object({
  runId: z.string().uuid("Run ID must be a valid UUID"),
  messageId: z.string().min(1, "Message ID cannot be empty"),
});

export const CheckMessageStatusOutputSchema = z.object({
  messageId: z.string(),
  questionContent: z.string(),
  questionTimestamp: z.string(),
  answerContent: z.string().optional(),
  answerTimestamp: z.string().optional(),
  messageStatus: z.string(),
});

export async function checkMessageStatusHandler(
  input: z.infer<typeof CheckMessageStatusArgumentsSchema>
): Promise<z.infer<typeof CheckMessageStatusOutputSchema>> {
  const { runId, messageId } = input;
  const metaPath = join("runs", runId, ".meta.json");

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

  const meta = metadata.meta || metadata; // fallback for legacy structure

  // Find the message
  if (!Array.isArray(meta.messages)) {
    throw new Error(`No messages found for runId ${runId}`);
  }

  const messageIndex = meta.messages.findIndex(
    (msg: CommunicationMessage) => msg.messageId === messageId
  );

  if (messageIndex === -1) {
    throw new Error(`Message with ID ${messageId} not found`);
  }

  const message = meta.messages[messageIndex];

  // Prepare the output
  const output = {
    messageId: message.messageId,
    questionContent: message.questionContent,
    questionTimestamp: message.questionTimestamp,
    answerContent: message.answerContent,
    answerTimestamp: message.answerTimestamp,
    messageStatus: message.messageStatus,
  };

  // If the message status is "parent_replied", acknowledge it and update status
  if (message.messageStatus === "parent_replied") {
    // Update message status to acknowledged
    meta.messages[messageIndex].messageStatus = "acknowledged_by_subagent";

    // Update overall status back to running
    meta.status = "running";
    if (metadata.meta) {
      metadata.meta.status = "running";
    }
    if (metadata.status) {
      metadata.status = "running";
    }

    // Write back the updated metadata
    await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2));
  }

  return output;
}
