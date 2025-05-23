// communication.spec.ts - Vitest tests for bi-directional communication tools

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { askParentHandler, AskParentInputSchema } from "./tools/askParent.js";
import {
  replySubagentHandler,
  replySubagentInputSchema,
} from "./tools/replySubagent.js";
import { checkSubagentStatus } from "./tools/status.js";
import { v4 as uuidv4 } from "uuid";
import fs from "fs-extra";
import path from "path";
import os from "os";

const AGENT_NAME = "testagent";

type Message = {
  messageId: string;
  questionContent: string;
  questionTimestamp: string;
  answerContent: string | null;
  answerTimestamp: string | null;
  messageStatus: string;
};

function makeMetaFileContent(messages: Message[] = [], status = "running") {
  return {
    meta: {
      status,
      messages,
    },
  };
}

function makeMessage({
  messageId = uuidv4(),
  questionContent = "Q?",
  questionTimestamp = new Date().toISOString(),
  answerContent,
  answerTimestamp,
  messageStatus = "pending_parent_reply",
}: Partial<Message> = {}): Message {
  const msg: any = {
    messageId,
    questionContent,
    questionTimestamp,
    messageStatus,
  };
  if (answerContent !== undefined) msg.answerContent = answerContent;
  if (answerTimestamp !== undefined) msg.answerTimestamp = answerTimestamp;
  return msg;
}

describe("Bi-directional communication tools", () => {
  let runId: string;
  let metaPath: string;
  let logDir: string;
  let logMetaPath: string;

  beforeEach(async () => {
    runId = uuidv4();
    metaPath = path.join("runs", runId, ".meta.json");
    await fs.ensureDir(path.dirname(metaPath));
    logDir = "logs";
    await fs.ensureDir(logDir);
    logMetaPath = path.join(logDir, `${AGENT_NAME}-${runId}.meta.json`);
  });

  afterEach(async () => {
    // Clean up created files and directories
    await fs.remove(path.join("runs", runId));
    await fs.remove(logMetaPath);
  });

  it("ask_parent appends new message and sets status", async () => {
    // Arrange
    const initialMeta = makeMetaFileContent();
    await fs.writeJson(metaPath, initialMeta);

    // Act
    const input = { runId, question: "What is your status?" };
    const result = await askParentHandler({
      ...input,
    });

    // Assert
    const updated = await fs.readJson(metaPath);
    expect(updated.meta.status).toBe("waiting_parent_reply");
    expect(updated.meta.messages).toHaveLength(1);
    expect(updated.meta.messages[0].questionContent).toBe(
      "What is your status?"
    );
    expect(updated.meta.messages[0].messageStatus).toBe("pending_parent_reply");
    expect(result).toHaveProperty("messageId");
    expect(result.instructions).toMatch(/Poll status/);
  });

  it("check_subagent_status returns messages when waiting_parent_reply", async () => {
    // Arrange
    const msg = makeMessage();
    const meta = makeMetaFileContent([msg], "waiting_parent_reply");
    await fs.writeJson(metaPath, meta);
    await fs.copy(metaPath, logMetaPath);

    // Act
    const status = await checkSubagentStatus(AGENT_NAME, runId, logDir);

    // Assert
    expect(status.messages).toHaveLength(1);
    expect(status.meta.status).toBe("waiting_parent_reply");
    expect(status.messages[0].messageStatus).toBe("pending_parent_reply");
  });

  it("reply_subagent updates message, timestamps, and status", async () => {
    // Arrange: use askParentHandler to create the message
    await fs.ensureDir(path.dirname(metaPath));
    await fs.writeJson(metaPath, makeMetaFileContent());
    const askResult = await askParentHandler({
      runId,
      question: "Reply test?",
    });

    // Act
    const replyInput = {
      runId,
      messageId: askResult.messageId,
      answer: "Here is the answer.",
    };
    const result = await replySubagentHandler(replyInput);

    // Assert
    const updated = await fs.readJson(metaPath);
    expect(updated.meta.status || updated.status).toBe("parent_replied");
    const updatedMsg = (updated.meta?.messages || updated.messages).find(
      (m: any) => m.messageId === askResult.messageId
    );
    expect(updatedMsg.answerContent).toBe("Here is the answer.");
    expect(updatedMsg.answerTimestamp).toBeTruthy();
    expect(updatedMsg.messageStatus).toBe("parent_replied");
    expect(result.success).toBe(true);
  });

  it("check_subagent_status auto-acknowledges parent_replied and resets status", async () => {
    // Arrange
    const msg = makeMessage({ messageStatus: "parent_replied" });
    const meta = makeMetaFileContent([msg], "parent_replied");
    await fs.writeJson(metaPath, meta);
    await fs.copy(metaPath, logMetaPath);

    // Act
    const status = await checkSubagentStatus(AGENT_NAME, runId, logDir);

    // Assert
    expect(status.meta.status).toBe("running");
    const ackMsg = status.messages.find(
      (m: any) => m.messageStatus === "acknowledged_by_subagent"
    );
    expect(ackMsg).toBeTruthy();
  });

  it("edge case: invalid runId returns not_found", async () => {
    const status = await checkSubagentStatus(AGENT_NAME, "nonexistent", logDir);
    expect(status.status).toBe("not_found");
  });

  it("edge case: invalid messageId in reply_subagent throws", async () => {
    const meta = makeMetaFileContent([], "waiting_parent_reply");
    await fs.writeJson(metaPath, meta);

    await expect(
      replySubagentHandler({
        runId,
        messageId: "bad-id",
        answer: "nope",
      })
    ).rejects.toThrow(/not found/);
  });

  it("edge case: multiple pending messages, reply_subagent only updates correct one", async () => {
    // Arrange: use askParentHandler to create two messages
    await fs.ensureDir(path.dirname(metaPath));
    await fs.writeJson(metaPath, makeMetaFileContent());
    const ask1 = await askParentHandler({ runId, question: "First?" });
    const ask2 = await askParentHandler({ runId, question: "Second?" });

    await replySubagentHandler({
      runId,
      messageId: ask2.messageId,
      answer: "answer2",
    });

    const updated = await fs.readJson(metaPath);
    const m1 = updated.meta.messages.find(
      (m: any) => m.messageId === ask1.messageId
    );
    const m2 = updated.meta.messages.find(
      (m: any) => m.messageId === ask2.messageId
    );
    expect(m1.answerContent).toBe("");
    expect(m2.answerContent).toBe("answer2");
    expect(m2.messageStatus).toBe("parent_replied");
  });
});
