// src/tools/replySubagent.ts

import { z } from "zod";
import fs from "fs/promises";
import path from "path";

// Types for .meta.json structure
type CommunicationMessage = {
  messageId: string;
  messageStatus: string;
  answerContent?: string;
  answerTimestamp?: string;
  [key: string]: any;
};

type MetaFileContent = {
  status: string;
  messages: CommunicationMessage[];
  [key: string]: any;
};

// Input schema
export const replySubagentInputSchema = z.object({
  runId: z.string(),
  messageId: z.string(),
  answer: z.string(),
});

// Output schema
export const replySubagentOutputSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  updatedMetadata: z.any(),
});

// Handler
export const replySubagentHandler = async (
  input: z.infer<typeof replySubagentInputSchema>
): Promise<z.infer<typeof replySubagentOutputSchema>> => {
  const { runId, messageId, answer } = input;
  const metaPath = path.join("runs", runId, ".meta.json");

  // Read and parse .meta.json
  let metaRaw: string;
  try {
    metaRaw = await fs.readFile(metaPath, "utf8");
  } catch (err) {
    throw new Error(`Could not read meta file: ${metaPath}`);
  }

  let meta: MetaFileContent;
  try {
    meta = JSON.parse(metaRaw);
  } catch (err) {
    throw new Error(`Invalid JSON in meta file: ${metaPath}`);
  }

  // Ensure messages array is initialized
  if (!Array.isArray(meta.messages)) {
    meta.messages = [];
  }

  // Find the message
  const msg = meta.meta.messages?.find(
    (m: CommunicationMessage) => m.messageId === messageId
  );
  if (!msg) {
    throw new Error(`Message with ID ${messageId} not found in meta file.`);
  }

  if (msg.messageStatus !== "pending_parent_reply") {
    throw new Error(
      `Message status is not 'pending_parent_reply' (found '${msg.messageStatus}').`
    );
  }

  // Update message
  msg.answerContent = answer;
  msg.answerTimestamp = new Date().toISOString();
  msg.messageStatus = "parent_replied";

  // Update meta status
  meta.status = "parent_replied";
  meta.meta.status = "parent_replied";

  // Write back to .meta.json
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf8");

  return {
    success: true,
    message: "Parent reply recorded and metadata updated.",
    updatedMetadata: meta,
  };
};
