// mcp-handler.spec.ts - Tests for MCP tool handler output formatting

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { v4 as uuidv4 } from "uuid";
import fs from "fs-extra";
import path from "path";
import { checkSubagentStatus } from "./tools/status.js";

// This simulates the formatting logic from index.ts check_subagent_status handler
function formatStatusOutput(statusObject: any, runId: string) {
  const outputParts = [];

  outputParts.push(`Run ID: ${statusObject.runId || runId}`);
  outputParts.push(`Agent Name: ${statusObject.agentName || "N/A"}`);
  outputParts.push(`Status: ${statusObject.status || "N/A"}`);
  outputParts.push(`Exit Code: ${statusObject.exitCode ?? "N/A"}`);
  outputParts.push(`Start Time: ${statusObject.startTime || "N/A"}`);
  outputParts.push(`End Time: ${statusObject.endTime || "N/A"}`);
  outputParts.push(`Summary: ${statusObject.summary || "N/A"}`);

  // Bi-directional communication details
  if (
    Array.isArray(statusObject.messages) &&
    statusObject.messages.length > 0
  ) {
    if (statusObject.status === "waiting_parent_reply") {
      const pendingMessage = statusObject.messages
        .slice()
        .reverse()
        .find((m: any) => m.messageStatus === "pending_parent_reply");
      if (pendingMessage) {
        outputParts.push(``);
        outputParts.push(
          `Question awaiting reply (Message ID: ${pendingMessage.messageId}):`
        );
        outputParts.push(`  ${pendingMessage.questionContent}`);
        outputParts.push(`  (Asked at: ${pendingMessage.questionTimestamp})`);
        outputParts.push(`  To reply, use the 'reply_subagent' tool.`);
        outputParts.push(
          `Note: This may take a while for the parent to respond. Use 'sleep 60' between status checks to avoid spamming.`
        );
      }
    } else if (
      statusObject.status === "parent_replied" ||
      statusObject.status === "running"
    ) {
      // Find the most recent message with an answer and acknowledged_by_subagent status
      const repliedMessage = statusObject.messages
        .slice()
        .reverse()
        .find(
          (m: any) =>
            m.answerContent &&
            (m.messageStatus === "acknowledged_by_subagent" ||
              m.messageStatus === "parent_replied")
        );
      if (repliedMessage) {
        outputParts.push(``);
        outputParts.push(
          `Last Interaction (Message ID: ${repliedMessage.messageId}):`
        );
        outputParts.push(`  Question: ${repliedMessage.questionContent}`);
        outputParts.push(`  (Asked at: ${repliedMessage.questionTimestamp})`);
        outputParts.push(`  Answer: ${repliedMessage.answerContent}`);
        outputParts.push(`  (Answered at: ${repliedMessage.answerTimestamp})`);
      }
    }
  }

  // Add general status-specific notes
  if (statusObject.status === "running") {
    outputParts.push(``);
    outputParts.push(
      `Note: Task is still running. This may take a while. Use 'sleep 60' between status checks to avoid spamming.`
    );
  } else if (
    statusObject.status === "waiting_parent_reply" &&
    (!Array.isArray(statusObject.messages) ||
      statusObject.messages.length === 0)
  ) {
    outputParts.push(``);
    outputParts.push(
      `Note: Waiting for parent reply. This may take a while. Use 'sleep 60' between status checks to avoid spamming.`
    );
  }

  return outputParts.join("\n");
}

describe("MCP status handler output formatting", () => {
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

  describe("Basic status formatting", () => {
    it("should format simple completed status correctly", async () => {
      const metadata = {
        runId,
        agentName: "test-agent",
        status: "completed",
        exitCode: 0,
        startTime: "2025-01-01T00:00:00.000Z",
        endTime: "2025-01-01T00:05:00.000Z",
        summary: "Task completed successfully",
      };

      await fs.writeJson(metaPath, metadata);
      const statusObject = await checkSubagentStatus(runId, logDir);
      const output = formatStatusOutput(statusObject, runId);

      expect(output).toBe(
        `Run ID: ${runId}\n` +
          `Agent Name: test-agent\n` +
          `Status: completed\n` +
          `Exit Code: 0\n` +
          `Start Time: 2025-01-01T00:00:00.000Z\n` +
          `End Time: 2025-01-01T00:05:00.000Z\n` +
          `Summary: Task completed successfully`
      );
    });

    it("should handle N/A values for missing fields", async () => {
      const metadata = {
        runId,
        // Missing agentName, status, exitCode, etc.
      };

      await fs.writeJson(metaPath, metadata);
      const statusObject = await checkSubagentStatus(runId, logDir);
      const output = formatStatusOutput(statusObject, runId);

      expect(output).toContain("Agent Name: N/A");
      expect(output).toContain("Status: N/A");
      expect(output).toContain("Exit Code: N/A");
      expect(output).toContain("Start Time: N/A");
      expect(output).toContain("End Time: N/A");
      expect(output).toContain("Summary: N/A");
    });

    it("should handle zero exit code correctly (not N/A)", async () => {
      const metadata = {
        runId,
        agentName: "test",
        exitCode: 0,
      };

      await fs.writeJson(metaPath, metadata);
      const statusObject = await checkSubagentStatus(runId, logDir);
      const output = formatStatusOutput(statusObject, runId);

      expect(output).toContain("Exit Code: 0");
    });
  });

  describe("Bi-directional communication formatting", () => {
    it("should format waiting_parent_reply status with pending question", async () => {
      const metadata = {
        runId,
        agentName: "test-agent",
        status: "waiting_parent_reply",
        messages: [
          {
            messageId: "msg-123",
            questionContent: "Should I proceed with the task?",
            questionTimestamp: "2025-01-01T00:02:00.000Z",
            answerContent: "",
            answerTimestamp: "",
            messageStatus: "pending_parent_reply",
          },
        ],
      };

      await fs.writeJson(metaPath, metadata);
      const statusObject = await checkSubagentStatus(runId, logDir);
      const output = formatStatusOutput(statusObject, runId);

      expect(output).toContain("Status: waiting_parent_reply");
      expect(output).toContain(
        "Question awaiting reply (Message ID: msg-123):"
      );
      expect(output).toContain("  Should I proceed with the task?");
      expect(output).toContain("  (Asked at: 2025-01-01T00:02:00.000Z)");
      expect(output).toContain("  To reply, use the 'reply_subagent' tool.");
      expect(output).toContain(
        "Note: This may take a while for the parent to respond. Use 'sleep 60' between status checks to avoid spamming."
      );
    });

    it("should show latest pending question when multiple exist", async () => {
      const metadata = {
        runId,
        agentName: "test-agent",
        status: "waiting_parent_reply",
        messages: [
          {
            messageId: "msg-1",
            questionContent: "First question?",
            questionTimestamp: "2025-01-01T00:01:00.000Z",
            messageStatus: "pending_parent_reply",
          },
          {
            messageId: "msg-2",
            questionContent: "Latest question?",
            questionTimestamp: "2025-01-01T00:03:00.000Z",
            messageStatus: "pending_parent_reply",
          },
        ],
      };

      await fs.writeJson(metaPath, metadata);
      const statusObject = await checkSubagentStatus(runId, logDir);
      const output = formatStatusOutput(statusObject, runId);

      expect(output).toContain("Question awaiting reply (Message ID: msg-2):");
      expect(output).toContain("  Latest question?");
      expect(output).not.toContain("First question?");
    });

    it("should format running status with last interaction", async () => {
      const metadata = {
        runId,
        agentName: "test-agent",
        status: "running",
        messages: [
          {
            messageId: "msg-456",
            questionContent: "What's the next step?",
            questionTimestamp: "2025-01-01T00:02:00.000Z",
            answerContent: "Continue with phase 2",
            answerTimestamp: "2025-01-01T00:03:00.000Z",
            messageStatus: "acknowledged_by_subagent",
          },
        ],
      };

      await fs.writeJson(metaPath, metadata);
      const statusObject = await checkSubagentStatus(runId, logDir);
      const output = formatStatusOutput(statusObject, runId);

      expect(output).toContain("Status: running");
      expect(output).toContain("Last Interaction (Message ID: msg-456):");
      expect(output).toContain("  Question: What's the next step?");
      expect(output).toContain("  (Asked at: 2025-01-01T00:02:00.000Z)");
      expect(output).toContain("  Answer: Continue with phase 2");
      expect(output).toContain("  (Answered at: 2025-01-01T00:03:00.000Z)");
      expect(output).toContain(
        "Note: Task is still running. This may take a while. Use 'sleep 60' between status checks to avoid spamming."
      );
    });

    it("should handle parent_replied status with answered message", async () => {
      const metadata = {
        runId,
        agentName: "test-agent",
        status: "parent_replied",
        messages: [
          {
            messageId: "msg-789",
            questionContent: "Need clarification on requirements",
            questionTimestamp: "2025-01-01T00:01:00.000Z",
            answerContent: "Here are the clarified requirements",
            answerTimestamp: "2025-01-01T00:02:30.000Z",
            messageStatus: "parent_replied",
          },
        ],
      };

      await fs.writeJson(metaPath, metadata);
      const statusObject = await checkSubagentStatus(runId, logDir);

      // Note: checkSubagentStatus no longer auto-acknowledges parent_replied,
      // so we expect the output to show "parent_replied" status
      const output = formatStatusOutput(statusObject, runId);

      expect(output).toContain("Status: parent_replied");
      expect(output).toContain("Last Interaction (Message ID: msg-789):");
      expect(output).toContain(
        "  Question: Need clarification on requirements"
      );
      expect(output).toContain("  Answer: Here are the clarified requirements");
    });

    it("should show most recent answered message when multiple exist", async () => {
      const metadata = {
        runId,
        agentName: "test-agent",
        status: "running",
        messages: [
          {
            messageId: "msg-1",
            questionContent: "First question?",
            questionTimestamp: "2025-01-01T00:01:00.000Z",
            answerContent: "First answer",
            answerTimestamp: "2025-01-01T00:02:00.000Z",
            messageStatus: "acknowledged_by_subagent",
          },
          {
            messageId: "msg-2",
            questionContent: "Latest question?",
            questionTimestamp: "2025-01-01T00:03:00.000Z",
            answerContent: "Latest answer",
            answerTimestamp: "2025-01-01T00:04:00.000Z",
            messageStatus: "acknowledged_by_subagent",
          },
        ],
      };

      await fs.writeJson(metaPath, metadata);
      const statusObject = await checkSubagentStatus(runId, logDir);
      const output = formatStatusOutput(statusObject, runId);

      expect(output).toContain("Last Interaction (Message ID: msg-2):");
      expect(output).toContain("  Question: Latest question?");
      expect(output).toContain("  Answer: Latest answer");
      expect(output).not.toContain("First question?");
      expect(output).toContain(
        "Note: Task is still running. This may take a while. Use 'sleep 60' between status checks to avoid spamming."
      );
    });

    it("should not show interaction section when no messages exist", async () => {
      const metadata = {
        runId,
        agentName: "test-agent",
        status: "running",
        messages: [],
      };

      await fs.writeJson(metaPath, metadata);
      const statusObject = await checkSubagentStatus(runId, logDir);
      const output = formatStatusOutput(statusObject, runId);

      expect(output).not.toContain("Question awaiting reply");
      expect(output).not.toContain("Last Interaction");
      expect(output).toContain("Status: running");
      expect(output).toContain(
        "Note: Task is still running. This may take a while. Use 'sleep 60' between status checks to avoid spamming."
      );
    });

    it("should not show interaction section when messages is undefined", async () => {
      const metadata = {
        runId,
        agentName: "test-agent",
        status: "running",
        // messages property is missing
      };

      await fs.writeJson(metaPath, metadata);
      const statusObject = await checkSubagentStatus(runId, logDir);
      const output = formatStatusOutput(statusObject, runId);

      expect(output).not.toContain("Question awaiting reply");
      expect(output).not.toContain("Last Interaction");
      expect(output).toContain("Status: running");
      expect(output).toContain(
        "Note: Task is still running. This may take a while. Use 'sleep 60' between status checks to avoid spamming."
      );
    });
  });

  describe("Edge cases", () => {
    it("should handle legacy structure without meta object", async () => {
      const legacyMetadata = {
        runId,
        agentName: "legacy-agent",
        status: "completed",
        exitCode: 0,
        summary: "Legacy task completed",
      };

      await fs.writeJson(metaPath, legacyMetadata);
      const statusObject = await checkSubagentStatus(runId, logDir);
      const output = formatStatusOutput(statusObject, runId);

      expect(output).toContain(`Run ID: ${runId}`);
      expect(output).toContain("Agent Name: legacy-agent");
      expect(output).toContain("Status: completed");
      expect(output).toContain("Exit Code: 0");
      expect(output).toContain("Summary: Legacy task completed");
    });

    it("should handle non-existent runId", async () => {
      const nonExistentRunId = uuidv4();
      const statusObject = await checkSubagentStatus(nonExistentRunId, logDir);
      const output = formatStatusOutput(statusObject, nonExistentRunId);

      expect(output).toContain(`Run ID: ${nonExistentRunId}`);
      expect(output).toContain("Agent Name: N/A");
      expect(output).toContain("Status: not_found");
    });
  });
});
