#!/usr/bin/env node

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ensureLogDir,
  // SUBAGENTS, // No longer needed directly in tests for this pattern
} from "./index.js"; // Assuming functions are exported from index.ts
import { runSubagent } from "./tools/run.js";
import { checkSubagentStatus, updateSubagentStatus } from "./tools/status.js";
import { getSubagentLogs } from "./tools/logs.js";
import { SubagentConfig } from "./tools/schemas.js"; // Import SubagentConfig
import { promises as fs } from "fs";
import path from "path";

// Define a helper to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Define the log directory, relative to the src directory for consistency with index.ts
const LOG_DIR = path.join(process.cwd(), "logs");

// Define types for our dynamic subagents if not already defined in index.ts
// (Assuming SUBAGENTS values have a specific structure)
// interface SubagentConfig { // This local interface is no longer needed
// name: string; // name is part of the imported SubagentConfig
// command: string;
// getArgs: (input: string) => string[];
// description: string;
// }

describe("Subagent MCP Server Functionality", () => {
  const testSubagentName = "test_in_vitest";
  const testFailSubagentName = "test_fail_in_vitest";
  let runId: string;
  let failRunId: string;

  // Test subagent configurations
  let testSubagentConfig: SubagentConfig;
  let testFailSubagentConfig: SubagentConfig;

  beforeAll(async () => {
    await ensureLogDir();

    testSubagentConfig = {
      name: testSubagentName,
      command: "echo",
      getArgs: (input: string) => [
        `Simulating ${testSubagentName} with full input: ${input}`,
      ],
      description: "Test subagent that just echoes input, added by Vitest",
    };

    testFailSubagentConfig = {
      name: testFailSubagentName,
      command: "sh",
      getArgs: (input: string) => {
        // Escape single quotes in the input for the shell
        const escapedInput = input.replace(/'/g, "'\\''");
        return [
          "-c",
          // Use printf for the main message to handle newlines and special characters in 'input'.
          // Then echo the second line and exit.
          `printf '%s' 'Error message for ${testFailSubagentName} with full input: ${escapedInput}' && echo 'Second error line' && exit 1`,
        ];
      },
      description: "Test subagent that intentionally fails, added by Vitest",
    };

    // We are no longer modifying the global SUBAGENTS from index.ts for tests
    // Tests will use their own SubagentConfig instances.
  });

  afterAll(async () => {
    // No cleanup of global SUBAGENTS needed
  });

  describe("Successful Subagent Operations", () => {
    it("should run a subagent and get an initial status", async () => {
      console.log(`\n--- Running ${testSubagentConfig.name} ---`);
      runId = await runSubagent(
        testSubagentConfig,
        "Hello from Vitest!",
        process.cwd(),
        LOG_DIR
      );
      console.log(
        `Subagent ${testSubagentConfig.name} started with run ID: ${runId}`
      );
      expect(runId).toBeTypeOf("string");
      expect(runId.length).toBeGreaterThan(0);

      await delay(1000);

      console.log(
        `\n--- Checking initial status for ${testSubagentConfig.name} ---`
      );
      const initialStatus = await checkSubagentStatus(runId, LOG_DIR);
      console.log("Initial status:", JSON.stringify(initialStatus, null, 2));

      expect(initialStatus).toBeDefined();
      expect(initialStatus.runId).toBe(runId);
      expect(initialStatus.status).toBe("success");
      expect(initialStatus.summary).toBeNull(); // Or specific initial summary if set
      expect(initialStatus.command).toContain("Hello from Vitest!");
      expect(initialStatus.command).toContain(
        "This is a sub-task executed by an automated agent."
      );
      expect(initialStatus.command).toContain(
        `Your unique run ID for this task is: ${runId}`
      );
      expect(initialStatus.command).toContain(
        `You MUST report your final status and results using the MCP tool: update_subagent_status`
      );
      expect(initialStatus.command).toContain(
        "Instructions are the following:"
      );
    });

    it("should update the subagent status with a summary", async () => {
      expect(runId, "runId must be set from previous test").toBeDefined();
      const summaryText = "The task was completed successfully by Vitest.";

      console.log(`\n--- Updating status for ${testSubagentConfig.name} ---`);
      const updatedStatus = await updateSubagentStatus(
        runId,
        "completed",
        LOG_DIR, // Pass LOG_DIR
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
        `\n--- Checking status after update for ${testSubagentConfig.name} ---`
      );
      const finalStatus = await checkSubagentStatus(runId, LOG_DIR);
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
      console.log(`\n--- Getting logs for ${testSubagentConfig.name} ---`);
      const logs = await getSubagentLogs(runId, LOG_DIR);
      console.log("Logs:", logs);

      expect(logs).toBeTypeOf("string");
      expect(logs).toContain("Hello from Vitest!");
      expect(logs).toContain("Status updated to: completed");
      expect(logs).toContain(
        "This is a sub-task executed by an automated agent."
      );
      expect(logs).toContain(`Your unique run ID for this task is: ${runId}`);
      expect(logs).toContain(
        `You MUST report your final status and results using the MCP tool: update_subagent_status`
      );
      expect(logs).toContain("Instructions are the following:");
      expect(logs).toContain(
        "Summary: The task was completed successfully by Vitest."
      );
    });
  });

  describe("Failing Subagent Operations", () => {
    it('should mark a failing subagent run as "error" and capture log tail in summary', async () => {
      console.log(
        `\n--- Running failing subagent ${testFailSubagentConfig.name} ---`
      );
      failRunId = await runSubagent(
        testFailSubagentConfig,
        "TestFailureInput",
        process.cwd(),
        LOG_DIR
      );
      console.log(
        `Failing subagent ${testFailSubagentConfig.name} started with run ID: ${failRunId}`
      );
      expect(failRunId).toBeTypeOf("string");

      await delay(1000); // Wait for the process to exit and metadata to be updated

      console.log(
        `\n--- Checking status for failing subagent ${testFailSubagentConfig.name} ---`
      );
      const status = await checkSubagentStatus(failRunId, LOG_DIR);
      console.log("Failing status:", JSON.stringify(status, null, 2));

      expect(status).toBeDefined();
      expect(status.runId).toBe(failRunId);
      expect(status.status).toBe("error");
      expect(status.exitCode).toBe(1);
      expect(status.summary).toBeTypeOf("string");
      expect(status.summary).toContain(
        "Error message for test_fail_in_vitest with full input:"
      );
      expect(status.summary).toContain("TestFailureInput");
      expect(status.summary).toContain(
        "This is a sub-task executed by an automated agent."
      );
      expect(status.summary).toContain(
        `Your unique run ID for this task is: ${failRunId}`
      );
      expect(status.summary).toContain(
        `You MUST report your final status and results using the MCP tool: update_subagent_status`
      );
      expect(status.summary).toContain("Instructions are the following:");
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
        `\n--- Getting logs for failing subagent ${testFailSubagentConfig.name} ---`
      );
      const logs = await getSubagentLogs(failRunId, LOG_DIR);
      console.log("Failing logs:", logs);

      expect(logs).toBeTypeOf("string");
      expect(logs).toContain(
        "Error message for test_fail_in_vitest with full input:"
      );
      expect(logs).toContain("TestFailureInput");
      expect(logs).toContain(
        "This is a sub-task executed by an automated agent."
      );
      expect(logs).toContain(
        `Your unique run ID for this task is: ${failRunId}`
      );
      expect(logs).toContain(
        `You MUST report your final status and results using the MCP tool: update_subagent_status`
      );
      expect(logs).toContain("Instructions are the following:");
      expect(logs).toContain("Process exited with code 1");
    });
  });
});
