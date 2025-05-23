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
  let testLogsDir: string;

  beforeEach(async () => {
    testRunId = uuidv4();
    testLogsDir = "logs";
    testMetaPath = join(testLogsDir, `${testRunId}.meta.json`);

    // Create test logs directory
    await fs.mkdir(testLogsDir, { recursive: true });

    // Create initial meta file with flat structure
    const initialMeta = {
      runId: testRunId,
      agentName: "test",
      status: "running",
      messages: [],
    };
    await fs.writeFile(testMetaPath, JSON.stringify(initialMeta, null, 2));
  });

  afterEach(async () => {
    // Clean up test files
    try {
      await fs.unlink(testMetaPath);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe("ask_parent", () => {
    it("should create a new message with pending_parent_reply status", async () => {
      const question = "What should I do next?";

      const result = await askParentHandler(
        {
          runId: testRunId,
          question,
        },
        testLogsDir
      );

      expect(result).toHaveProperty("messageId");
      expect(result.instructions).toContain("check_message_status");

      // Verify meta file was updated
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);

      expect(meta.status).toBe("waiting_parent_reply");
      expect(meta.messages).toHaveLength(1);
      expect(meta.messages[0]).toMatchObject({
        messageId: result.messageId,
        questionContent: question,
        messageStatus: "pending_parent_reply",
      });
      expect(meta.messages[0]).toHaveProperty("questionTimestamp");
    });

    it("should handle invalid runId", async () => {
      const invalidRunId = uuidv4();

      await expect(
        askParentHandler(
          {
            runId: invalidRunId,
            question: "test question",
          },
          testLogsDir
        )
      ).rejects.toThrow("Could not read meta file");
    });
  });

  describe("reply_subagent", () => {
    it("should update message with parent reply", async () => {
      // First, ask a question
      const question = "What should I do next?";
      const askResult = await askParentHandler(
        {
          runId: testRunId,
          question,
        },
        testLogsDir
      );

      // Then reply to it
      const answer = "You should proceed with the next step.";
      const replyResult = await replySubagentHandler(
        {
          runId: testRunId,
          messageId: askResult.messageId,
          answer,
        },
        testLogsDir
      );

      expect(replyResult.success).toBe(true);
      expect(replyResult.message).toContain("Parent reply recorded");

      // Verify meta file was updated
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);

      expect(meta.status).toBe("parent_replied");
      expect(meta.messages[0]).toMatchObject({
        messageId: askResult.messageId,
        questionContent: question,
        answerContent: answer,
        messageStatus: "parent_replied",
      });
      expect(meta.messages[0]).toHaveProperty("answerTimestamp");
    });

    it("should handle invalid messageId", async () => {
      const invalidMessageId = uuidv4();

      await expect(
        replySubagentHandler(
          {
            runId: testRunId,
            messageId: invalidMessageId,
            answer: "test answer",
          },
          testLogsDir
        )
      ).rejects.toThrow("Message with ID");
    });

    it("should handle message not in pending_parent_reply status", async () => {
      // Create a message that's already been replied to
      const question = "What should I do next?";
      const askResult = await askParentHandler(
        {
          runId: testRunId,
          question,
        },
        testLogsDir
      );

      // Reply once
      await replySubagentHandler(
        {
          runId: testRunId,
          messageId: askResult.messageId,
          answer: "First answer",
        },
        testLogsDir
      );

      // Try to reply again
      await expect(
        replySubagentHandler(
          {
            runId: testRunId,
            messageId: askResult.messageId,
            answer: "Second answer",
          },
          testLogsDir
        )
      ).rejects.toThrow("Message status is not 'pending_parent_reply'");
    });
  });

  describe("check_message_status", () => {
    it("should return message details without acknowledgment for pending messages", async () => {
      // Ask a question
      const question = "What should I do next?";
      const askResult = await askParentHandler(
        {
          runId: testRunId,
          question,
        },
        testLogsDir
      );

      // Check message status before reply
      const statusResult = await checkMessageStatusHandler(
        {
          runId: testRunId,
          messageId: askResult.messageId,
        },
        testLogsDir
      );

      expect(statusResult).toMatchObject({
        messageId: askResult.messageId,
        questionContent: question,
        messageStatus: "pending_parent_reply",
      });
      expect(statusResult.answerContent).toBeUndefined();

      // Verify meta file status unchanged
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);
      expect(meta.status).toBe("waiting_parent_reply");
    });

    it("should return message details and acknowledge for replied messages", async () => {
      // Ask a question
      const question = "What should I do next?";
      const askResult = await askParentHandler(
        {
          runId: testRunId,
          question,
        },
        testLogsDir
      );

      // Reply to it
      const answer = "You should proceed with the next step.";
      await replySubagentHandler(
        {
          runId: testRunId,
          messageId: askResult.messageId,
          answer,
        },
        testLogsDir
      );

      // Check message status after reply
      const statusResult = await checkMessageStatusHandler(
        {
          runId: testRunId,
          messageId: askResult.messageId,
        },
        testLogsDir
      );

      expect(statusResult).toMatchObject({
        messageId: askResult.messageId,
        questionContent: question,
        answerContent: answer,
        messageStatus: "parent_replied",
      });

      // Verify meta file was updated to acknowledged and running
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);
      expect(meta.status).toBe("running");
      expect(meta.messages[0].messageStatus).toBe("acknowledged_by_subagent");
    });

    it("should handle invalid runId", async () => {
      const invalidRunId = uuidv4();

      await expect(
        checkMessageStatusHandler(
          {
            runId: invalidRunId,
            messageId: uuidv4(),
          },
          testLogsDir
        )
      ).rejects.toThrow("Could not read meta file");
    });

    it("should handle invalid messageId", async () => {
      const invalidMessageId = uuidv4();

      await expect(
        checkMessageStatusHandler(
          {
            runId: testRunId,
            messageId: invalidMessageId,
          },
          testLogsDir
        )
      ).rejects.toThrow("Message with ID");
    });

    it("should not re-acknowledge already acknowledged messages", async () => {
      // Ask a question
      const question = "What should I do next?";
      const askResult = await askParentHandler(
        {
          runId: testRunId,
          question,
        },
        testLogsDir
      );

      // Reply to it
      const answer = "You should proceed with the next step.";
      await replySubagentHandler(
        {
          runId: testRunId,
          messageId: askResult.messageId,
          answer,
        },
        testLogsDir
      );

      // Check message status (first time - should acknowledge)
      await checkMessageStatusHandler(
        {
          runId: testRunId,
          messageId: askResult.messageId,
        },
        testLogsDir
      );

      // Check message status again (should not change anything)
      const statusResult = await checkMessageStatusHandler(
        {
          runId: testRunId,
          messageId: askResult.messageId,
        },
        testLogsDir
      );

      expect(statusResult.messageStatus).toBe("acknowledged_by_subagent");

      // Verify meta file status remains running
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);
      expect(meta.status).toBe("running");
      expect(meta.messages[0].messageStatus).toBe("acknowledged_by_subagent");
    });
  });

  describe("output format validation", () => {
    it("should return ask_parent output in the correct MCP tool response format", async () => {
      // This test validates that the output from ask_parent matches what index.ts expects
      const question = "What should I do next?";

      const result = await askParentHandler(
        {
          runId: testRunId,
          question,
        },
        testLogsDir
      );

      // Validate against the schema
      expect(result).toHaveProperty("messageId");
      expect(result).toHaveProperty("instructions");
      expect(typeof result.messageId).toBe("string");
      expect(typeof result.instructions).toBe("string");

      // Simulate what index.ts does with the result
      const mcpResponse = {
        content: [
          {
            type: "text",
            text: `Message ID: ${result.messageId}\n\n${result.instructions}`,
          },
        ],
      };

      // Validate the MCP response structure
      expect(mcpResponse).toHaveProperty("content");
      expect(Array.isArray(mcpResponse.content)).toBe(true);
      expect(mcpResponse.content.length).toBe(1);
      expect(mcpResponse.content[0]).toHaveProperty("type", "text");
      expect(mcpResponse.content[0]).toHaveProperty("text");
      expect(typeof mcpResponse.content[0].text).toBe("string");
      expect(mcpResponse.content[0].text).toContain("Message ID:");
      expect(mcpResponse.content[0].text).toContain(result.messageId);
      expect(mcpResponse.content[0].text).toContain(result.instructions);
    });

    it("should validate ask_parent output against AskParentOutputSchema", async () => {
      // Import the schema from askParent.ts
      const { AskParentOutputSchema } = await import("./tools/askParent.js");
      
      const question = "What should I do next?";

      const result = await askParentHandler(
        {
          runId: testRunId,
          question,
        },
        testLogsDir
      );

      // This should not throw - validates that our handler output matches the schema
      const validated = AskParentOutputSchema.parse(result);
      
      expect(validated).toEqual(result);
      expect(validated.messageId).toBe(result.messageId);
      expect(validated.instructions).toBe(result.instructions);
    });
  });

  describe("end-to-end communication flow", () => {
    it("should handle complete ask -> reply -> check cycle", async () => {
      const question = "Should I continue with the current approach?";
      const answer = "Yes, continue with the current approach.";

      // 1. Subagent asks a question
      const askResult = await askParentHandler(
        {
          runId: testRunId,
          question,
        },
        testLogsDir
      );

      expect(askResult.messageId).toBeDefined();
      expect(askResult.instructions).toContain("check_message_status");

      // 2. Parent replies to the question
      const replyResult = await replySubagentHandler(
        {
          runId: testRunId,
          messageId: askResult.messageId,
          answer,
        },
        testLogsDir
      );

      expect(replyResult.success).toBe(true);

      // 3. Subagent checks for the reply
      const checkResult = await checkMessageStatusHandler(
        {
          runId: testRunId,
          messageId: askResult.messageId,
        },
        testLogsDir
      );

      expect(checkResult).toMatchObject({
        messageId: askResult.messageId,
        questionContent: question,
        answerContent: answer,
        messageStatus: "parent_replied",
      });

      // 4. Verify final state
      const metaContent = await fs.readFile(testMetaPath, "utf-8");
      const meta = JSON.parse(metaContent);
      expect(meta.status).toBe("running");
      expect(meta.messages[0].messageStatus).toBe("acknowledged_by_subagent");
    });
  });
});
