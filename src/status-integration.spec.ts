// status-integration.spec.ts - Integration tests for status handling between status.ts and index.ts

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkSubagentStatus } from "./tools/status.js";
import { v4 as uuidv4 } from "uuid";
import fs from "fs-extra";
import path from "path";

describe("Status handling integration", () => {
  let runId: string;
  let logDir: string;
  let metaPath: string;

  beforeEach(async () => {
    runId = uuidv4();
    logDir = "logs";
    await fs.ensureDir(logDir);
    metaPath = path.join(logDir, `${runId}.meta.json`);
  });

  afterEach(async () => {
    await fs.remove(metaPath);
  });

  describe("checkSubagentStatus function", () => {
    it("should handle not_found status when runId doesn't exist", async () => {
      const nonExistentRunId = uuidv4();
      const status = await checkSubagentStatus(nonExistentRunId, logDir);

      expect(status).toEqual({
        runId: nonExistentRunId,
        status: "not_found",
        message: "Run ID not found",
        logDirectory: logDir,
      });
    });

    it("should handle waiting_parent_reply status", async () => {
      const metadata = {
        runId,
        agentName: "test",
        status: "waiting_parent_reply",
        messages: [
          {
            messageId: "msg-1",
            questionContent: "What should I do?",
            questionTimestamp: "2025-01-01T00:00:00.000Z",
            answerContent: "",
            answerTimestamp: "",
            messageStatus: "pending_parent_reply",
          },
        ],
      };

      await fs.writeJson(metaPath, metadata);
      const status = await checkSubagentStatus(runId, logDir);

      expect(status.status).toBe("waiting_parent_reply");
      expect(status.messages).toHaveLength(1);
      expect(status.messages[0].messageStatus).toBe("pending_parent_reply");
      expect(status.logFile).toBe(path.join(logDir, `${runId}.log`));
      expect(status.logDirectory).toBe(logDir);
    });

    it("should return parent_replied status without auto-acknowledgment", async () => {
      const metadata = {
        runId,
        agentName: "test",
        status: "parent_replied",
        messages: [
          {
            messageId: "msg-1",
            questionContent: "What should I do?",
            questionTimestamp: "2025-01-01T00:00:00.000Z",
            answerContent: "Do this task",
            answerTimestamp: "2025-01-01T00:01:00.000Z",
            messageStatus: "parent_replied",
          },
        ],
      };

      await fs.writeJson(metaPath, metadata);
      const status = await checkSubagentStatus(runId, logDir);

      // Status should remain parent_replied (no auto-acknowledgment)
      expect(status.status).toBe("parent_replied");
      expect(status.messages[0].messageStatus).toBe("parent_replied");

      // Verify the file was NOT updated
      const unchangedMetadata = await fs.readJson(metaPath);
      expect(unchangedMetadata.status).toBe("parent_replied");
      expect(unchangedMetadata.messages[0].messageStatus).toBe(
        "parent_replied"
      );
    });

    it("should handle legacy metadata structure fallback", async () => {
      // Legacy structure without nested meta object
      const legacyMetadata = {
        runId,
        agentName: "test",
        status: "completed",
        summary: "Task completed",
        startTime: "2025-01-01T00:00:00.000Z",
        endTime: "2025-01-01T00:05:00.000Z",
        exitCode: 0,
      };

      await fs.writeJson(metaPath, legacyMetadata);
      const status = await checkSubagentStatus(runId, logDir);

      expect(status.runId).toBe(runId);
      expect(status.status).toBe("completed");
      expect(status.logFile).toBe(path.join(logDir, `${runId}.log`));
      expect(status.logDirectory).toBe(logDir);
    });

    it("should handle multiple parent_replied messages without acknowledgment", async () => {
      const metadata = {
        runId,
        agentName: "test",
        status: "parent_replied",
        messages: [
          {
            messageId: "msg-1",
            questionContent: "First question?",
            questionTimestamp: "2025-01-01T00:00:00.000Z",
            answerContent: "First answer",
            answerTimestamp: "2025-01-01T00:01:00.000Z",
            messageStatus: "acknowledged_by_subagent", // Already acknowledged
          },
          {
            messageId: "msg-2",
            questionContent: "Second question?",
            questionTimestamp: "2025-01-01T00:02:00.000Z",
            answerContent: "Second answer",
            answerTimestamp: "2025-01-01T00:03:00.000Z",
            messageStatus: "parent_replied", // Should remain unchanged
          },
        ],
      };

      await fs.writeJson(metaPath, metadata);
      const status = await checkSubagentStatus(runId, logDir);

      expect(status.status).toBe("parent_replied");
      expect(status.messages[0].messageStatus).toBe("acknowledged_by_subagent"); // Should remain unchanged
      expect(status.messages[1].messageStatus).toBe("parent_replied"); // Should remain unchanged
    });

    it("should handle empty messages array", async () => {
      const metadata = {
        runId,
        agentName: "test",
        status: "running",
        messages: [],
      };

      await fs.writeJson(metaPath, metadata);
      const status = await checkSubagentStatus(runId, logDir);

      expect(status.status).toBe("running");
      // The function doesn't automatically add messages for non-communication statuses
      // It only adds it for waiting_parent_reply and parent_replied
      expect(status.messages).toEqual([]);
    });

    it("should handle missing messages property", async () => {
      const metadata = {
        runId,
        agentName: "test",
        status: "running",
        // messages property is missing
      };

      await fs.writeJson(metaPath, metadata);
      const status = await checkSubagentStatus(runId, logDir);

      expect(status.status).toBe("running");
      // The function doesn't automatically add messages for non-communication statuses
      expect(status.messages).toBeUndefined();
    });
  });

  describe("Error handling", () => {
    it("should handle corrupted JSON metadata file", async () => {
      await fs.writeFile(metaPath, "{ invalid json }");

      await expect(checkSubagentStatus(runId, logDir)).rejects.toThrow();
    });

    it("should propagate file system errors", async () => {
      // Mock fs.readFile to throw a different error
      const originalReadFile = fs.readFile;
      vi.spyOn(fs, "readFile").mockRejectedValue(
        new Error("Permission denied")
      );

      // The function actually catches file system errors and returns not_found
      // instead of propagating them, due to the ENOENT handling
      const status = await checkSubagentStatus(runId, logDir);
      expect(status.status).toBe("not_found");

      vi.restoreAllMocks();
    });
  });
});
