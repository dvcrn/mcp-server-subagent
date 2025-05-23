// communication.spec.ts - Vitest tests for bi-directional communication tools

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { askParentHandler } from "./tools/askParent.js";
import { replySubagentHandler } from "./tools/replySubagent.js";
import { checkMessageStatusHandler } from "./tools/checkMessage.js";

describe("Bi-directional Communication", () => {
  let testRunId: string;
  let testMetaPath: string;
  let testRunsDir: string;

  beforeEach(async () => {
    testRunId = uuidv4();
    testRunsDir = join("runs", testRunId);
    testMetaPath = join(testRunsDir, ".meta.json");

    // Create test runs directory
    await fs.mkdir(testRunsDir, { recursive: true });

    // Create initial meta file
    const initialMeta = {
      runId: testRunId,
      agentName: "test",
      status: "running",
      meta: {
        status: "running",
        messages: [],
      },
    };
    await fs.writeFile(testMetaPath, JSON.stringify(initialMeta, null, 2));
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(testRunsDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("ask_parent", () => {
    it("should create a new message with pending_parent_reply status", async () => {
      const question = "What should I do next?";

      const result = await askParentHandler({
        runId: testRunId,
        question,
      });

      expect(result).toHaveProperty("messageId");
      expect(result.instructions).toContain("check_message_status");

      // Verify meta file was updated
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);

      expect(meta.meta.status).toBe("waiting_parent_reply");
      expect(meta.meta.messages).toHaveLength(1);
      expect(meta.meta.messages[0]).toMatchObject({
        messageId: result.messageId,
        questionContent: question,
        messageStatus: "pending_parent_reply",
      });
      expect(meta.meta.messages[0]).toHaveProperty("questionTimestamp");
    });

    it("should handle invalid runId", async () => {
      const invalidRunId = uuidv4();

      await expect(
        askParentHandler({
          runId: invalidRunId,
          question: "test question",
        })
      ).rejects.toThrow("Could not read meta file");
    });
  });

  describe("reply_subagent", () => {
    it("should update message with parent reply", async () => {
      // First, ask a question
      const question = "What should I do next?";
      const askResult = await askParentHandler({
        runId: testRunId,
        question,
      });

      // Then reply to it
      const answer = "You should proceed with the next step.";
      const replyResult = await replySubagentHandler({
        runId: testRunId,
        messageId: askResult.messageId,
        answer,
      });

      expect(replyResult.success).toBe(true);
      expect(replyResult.message).toContain("Parent reply recorded");

      // Verify meta file was updated
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);

      expect(meta.meta.status).toBe("parent_replied");
      expect(meta.meta.messages[0]).toMatchObject({
        messageId: askResult.messageId,
        questionContent: question,
        answerContent: answer,
        messageStatus: "parent_replied",
      });
      expect(meta.meta.messages[0]).toHaveProperty("answerTimestamp");
    });

    it("should handle invalid messageId", async () => {
      const invalidMessageId = uuidv4();

      await expect(
        replySubagentHandler({
          runId: testRunId,
          messageId: invalidMessageId,
          answer: "test answer",
        })
      ).rejects.toThrow("Message with ID");
    });

    it("should handle message not in pending_parent_reply status", async () => {
      // Create a message that's already been replied to
      const question = "What should I do next?";
      const askResult = await askParentHandler({
        runId: testRunId,
        question,
      });

      // Reply once
      await replySubagentHandler({
        runId: testRunId,
        messageId: askResult.messageId,
        answer: "First answer",
      });

      // Try to reply again
      await expect(
        replySubagentHandler({
          runId: testRunId,
          messageId: askResult.messageId,
          answer: "Second answer",
        })
      ).rejects.toThrow("Message status is not 'pending_parent_reply'");
    });
  });

  describe("check_message_status", () => {
    it("should return message details without acknowledgment for pending messages", async () => {
      // Ask a question
      const question = "What should I do next?";
      const askResult = await askParentHandler({
        runId: testRunId,
        question,
      });

      // Check message status before reply
      const statusResult = await checkMessageStatusHandler({
        runId: testRunId,
        messageId: askResult.messageId,
      });

      expect(statusResult).toMatchObject({
        messageId: askResult.messageId,
        questionContent: question,
        messageStatus: "pending_parent_reply",
      });
      expect(statusResult.answerContent).toBeUndefined();

      // Verify meta file status unchanged
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);
      expect(meta.meta.status).toBe("waiting_parent_reply");
    });

    it("should return message details and acknowledge for replied messages", async () => {
      // Ask a question
      const question = "What should I do next?";
      const askResult = await askParentHandler({
        runId: testRunId,
        question,
      });

      // Reply to it
      const answer = "You should proceed with the next step.";
      await replySubagentHandler({
        runId: testRunId,
        messageId: askResult.messageId,
        answer,
      });

      // Check message status after reply
      const statusResult = await checkMessageStatusHandler({
        runId: testRunId,
        messageId: askResult.messageId,
      });

      expect(statusResult).toMatchObject({
        messageId: askResult.messageId,
        questionContent: question,
        answerContent: answer,
        messageStatus: "parent_replied",
      });

      // Verify meta file was updated to acknowledged and running
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);
      expect(meta.meta.status).toBe("running");
      expect(meta.meta.messages[0].messageStatus).toBe(
        "acknowledged_by_subagent"
      );
    });

    it("should handle invalid runId", async () => {
      const invalidRunId = uuidv4();

      await expect(
        checkMessageStatusHandler({
          runId: invalidRunId,
          messageId: uuidv4(),
        })
      ).rejects.toThrow("Could not read meta file");
    });

    it("should handle invalid messageId", async () => {
      const invalidMessageId = uuidv4();

      await expect(
        checkMessageStatusHandler({
          runId: testRunId,
          messageId: invalidMessageId,
        })
      ).rejects.toThrow("Message with ID");
    });

    it("should not re-acknowledge already acknowledged messages", async () => {
      // Ask a question
      const question = "What should I do next?";
      const askResult = await askParentHandler({
        runId: testRunId,
        question,
      });

      // Reply to it
      const answer = "You should proceed with the next step.";
      await replySubagentHandler({
        runId: testRunId,
        messageId: askResult.messageId,
        answer,
      });

      // Check message status (first time - should acknowledge)
      await checkMessageStatusHandler({
        runId: testRunId,
        messageId: askResult.messageId,
      });

      // Check message status again (should not change anything)
      const statusResult = await checkMessageStatusHandler({
        runId: testRunId,
        messageId: askResult.messageId,
      });

      expect(statusResult.messageStatus).toBe("acknowledged_by_subagent");

      // Verify meta file status remains running
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);
      expect(meta.meta.status).toBe("running");
      expect(meta.meta.messages[0].messageStatus).toBe(
        "acknowledged_by_subagent"
      );
    });
  });

  describe("end-to-end communication flow", () => {
    it("should handle complete ask -> reply -> check cycle", async () => {
      const question = "Should I continue with the current approach?";
      const answer = "Yes, continue with the current approach.";

      // 1. Subagent asks a question
      const askResult = await askParentHandler({
        runId: testRunId,
        question,
      });

      expect(askResult.messageId).toBeDefined();
      expect(askResult.instructions).toContain("check_message_status");

      // 2. Parent replies to the question
      const replyResult = await replySubagentHandler({
        runId: testRunId,
        messageId: askResult.messageId,
        answer,
      });

      expect(replyResult.success).toBe(true);

      // 3. Subagent checks for the reply
      const checkResult = await checkMessageStatusHandler({
        runId: testRunId,
        messageId: askResult.messageId,
      });

      expect(checkResult).toMatchObject({
        messageId: askResult.messageId,
        questionContent: question,
        answerContent: answer,
        messageStatus: "parent_replied",
      });

      // 4. Verify final state
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);
      expect(meta.meta.status).toBe("running");
      expect(meta.meta.messages[0].messageStatus).toBe(
        "acknowledged_by_subagent"
      );
    });
  });
});
