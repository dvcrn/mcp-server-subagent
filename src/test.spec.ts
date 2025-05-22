#!/usr/bin/env node

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ensureLogDir,
  SUBAGENTS, // Import the SUBAGENTS object
} from "./index.js"; // Assuming functions are exported from index.ts
import { runSubagent } from "./tools/run.js";
import { checkSubagentStatus, updateSubagentStatus } from "./tools/status.js";
import { getSubagentLogs } from "./tools/logs.js";
import { promises as fs } from "fs";
import path from "path";

// Define a helper to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Define the log directory, relative to the src directory for consistency with index.ts
const LOG_DIR = path.join(process.cwd(), "logs");

// Define types for our dynamic subagents if not already defined in index.ts
// (Assuming SUBAGENTS values have a specific structure)
interface SubagentConfig {
  command: string;
  getArgs: (input: string) => string[];
  description: string;
}

describe("Subagent MCP Server Functionality", () => {
  const testSubagentName = "test_in_vitest";
  const testFailSubagentName = "test_fail_in_vitest";
  let runId: string;
  let failRunId: string;

  // Store original SUBAGENTS to restore later if needed, though Vitest usually isolates modules
  let originalSubagents: Record<string, SubagentConfig>;

  beforeAll(async () => {
    await ensureLogDir();

    // Clone the original SUBAGENTS to avoid modifying the imported object directly if it causes issues across test files (though unlikely with Vitest)
    originalSubagents = { ...SUBAGENTS };

    // Add test-specific subagents
    (SUBAGENTS as Record<string, SubagentConfig>)[testSubagentName] = {
      command: "echo",
      getArgs: (input: string) => [
        `Simulating ${testSubagentName} with input: ${input}`,
      ],
      description: "Test subagent that just echoes input, added by Vitest",
    };
    (SUBAGENTS as Record<string, SubagentConfig>)[testFailSubagentName] = {
      command: "sh",
      getArgs: (input: string) => [
        "-c",
        `echo \\"Error message for ${testFailSubagentName}: ${input}\\\" && echo \\"Second error line\\\" && exit 1`,
      ],
      description: "Test subagent that intentionally fails, added by Vitest",
    };
  });

  afterAll(async () => {
    // Restore original SUBAGENTS or simply delete the test-specific ones
    delete (SUBAGENTS as Record<string, SubagentConfig>)[testSubagentName];
    delete (SUBAGENTS as Record<string, SubagentConfig>)[testFailSubagentName];

    // Optional: Log cleanup (can be extensive if many tests create files)
    // Consider a dedicated cleanup script or more robust cleanup logic if needed
  });

  describe("Successful Subagent Operations", () => {
    it("should run a subagent and get an initial status", async () => {
      console.log(`\n--- Running ${testSubagentName} ---`);
      runId = await runSubagent(testSubagentName, "Hello from Vitest!");
      console.log(`Subagent ${testSubagentName} started with run ID: ${runId}`);
      expect(runId).toBeTypeOf("string");
      expect(runId.length).toBeGreaterThan(0);

      await delay(1000);

      console.log(`\n--- Checking initial status for ${testSubagentName} ---`);
      const initialStatus = await checkSubagentStatus(testSubagentName, runId);
      console.log("Initial status:", JSON.stringify(initialStatus, null, 2));

      expect(initialStatus).toBeDefined();
      expect(initialStatus.runId).toBe(runId);
      expect(initialStatus.status).toBe("success");
      expect(initialStatus.summary).toBeNull(); // Or specific initial summary if set
      expect(initialStatus.command).toContain("Hello from Vitest!");
    });

    it("should update the subagent status with a summary", async () => {
      expect(runId, "runId must be set from previous test").toBeDefined();
      const summaryText = "The task was completed successfully by Vitest.";

      console.log(`\n--- Updating status for ${testSubagentName} ---`);
      const updatedStatus = await updateSubagentStatus(
        testSubagentName,
        runId,
        "completed",
        summaryText
      );
      console.log("Updated status:", JSON.stringify(updatedStatus, null, 2));

      expect(updatedStatus).toBeDefined();
      expect(updatedStatus.runId).toBe(runId);
      expect(updatedStatus.status).toBe("completed");
      expect(updatedStatus.summary).toBe(summaryText);
      expect(updatedStatus.lastUpdated).toBeTypeOf("string");
    });

    it("should reflect the updated status and summary when checking again", async () => {
      expect(runId, "runId must be set from previous test").toBeDefined();
      console.log(
        `\n--- Checking status after update for ${testSubagentName} ---`
      );
      const finalStatus = await checkSubagentStatus(testSubagentName, runId);
      console.log("Final status:", JSON.stringify(finalStatus, null, 2));

      expect(finalStatus).toBeDefined();
      expect(finalStatus.runId).toBe(runId);
      expect(finalStatus.status).toBe("completed");
      expect(finalStatus.summary).toBe(
        "The task was completed successfully by Vitest."
      );
    });

    it("should retrieve the logs for the subagent run", async () => {
      expect(runId, "runId must be set from previous test").toBeDefined();
      console.log(`\n--- Getting logs for ${testSubagentName} ---`);
      const logs = await getSubagentLogs(testSubagentName, runId);
      console.log("Logs:", logs);

      expect(logs).toBeTypeOf("string");
      expect(logs).toContain("Hello from Vitest!");
      expect(logs).toContain("Status updated to: completed");
      expect(logs).toContain(
        "Summary: The task was completed successfully by Vitest."
      );
    });
  });

  describe("Failing Subagent Operations", () => {
    it('should mark a failing subagent run as "error" and capture log tail in summary', async () => {
      console.log(`\n--- Running failing subagent ${testFailSubagentName} ---`);
      failRunId = await runSubagent(testFailSubagentName, "TestFailureInput");
      console.log(
        `Failing subagent ${testFailSubagentName} started with run ID: ${failRunId}`
      );
      expect(failRunId).toBeTypeOf("string");

      await delay(1000); // Wait for the process to exit and metadata to be updated

      console.log(
        `\n--- Checking status for failing subagent ${testFailSubagentName} ---`
      );
      const status = await checkSubagentStatus(testFailSubagentName, failRunId);
      console.log("Failing status:", JSON.stringify(status, null, 2));

      expect(status).toBeDefined();
      expect(status.runId).toBe(failRunId);
      expect(status.status).toBe("error");
      expect(status.exitCode).toBe(1);
      expect(status.summary).toBeTypeOf("string");
      expect(status.summary).toContain(
        "Error message for test_fail_in_vitest: TestFailureInput"
      );
      expect(status.summary).toContain("Second error line");
      // Check if it includes the last line indicating exit
      expect(status.summary).toMatch(/Process exited with code 1/);
    });

    it("should retrieve logs for the failing subagent run", async () => {
      expect(
        failRunId,
        "failRunId must be set from previous test"
      ).toBeDefined();
      console.log(
        `\n--- Getting logs for failing subagent ${testFailSubagentName} ---`
      );
      const logs = await getSubagentLogs(testFailSubagentName, failRunId);
      console.log("Failing logs:", logs);

      expect(logs).toBeTypeOf("string");
      expect(logs).toContain(
        "Error message for test_fail_in_vitest: TestFailureInput"
      );
      expect(logs).toContain("Process exited with code 1");
    });
  });
});
