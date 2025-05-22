#!/usr/bin/env node

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ensureLogDir,
  runSubagent,
  checkSubagentStatus,
  getSubagentLogs,
  updateSubagentStatus,
} from "./index.js"; // Assuming functions are exported from index.ts
import { promises as fs } from "fs";
import path from "path";

// Define a helper to delay execution
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Define the log directory, relative to the src directory for consistency with index.ts
const LOG_DIR = path.join(process.cwd(), "logs");

describe("Subagent MCP Server Functionality", () => {
  const subagentName = "test"; // Using the test subagent from SUBAGENTS in index.ts
  let runId: string;

  beforeAll(async () => {
    // Ensure the log directory exists before any tests run
    // Note: ensureLogDir from index.ts already handles creation
    await ensureLogDir();
  });

  afterAll(async () => {
    // Optional: Clean up logs after tests if desired
    // For now, we'll leave them for inspection
    // Example cleanup:
    // if (runId) {
    //   try {
    //     await fs.unlink(path.join(LOG_DIR, `${subagentName}-${runId}.log`));
    //     await fs.unlink(path.join(LOG_DIR, `${subagentName}-${runId}.meta.json`));
    //   } catch (error) {
    //     console.warn('Error during cleanup:', error);
    //   }
    // }
  });

  it("should run a subagent and get an initial status", async () => {
    console.log("\n--- Running a simulated subagent ---");
    runId = await runSubagent(subagentName, "Hello from Vitest!");
    console.log(`Subagent started with run ID: ${runId}`);
    expect(runId).toBeTypeOf("string");
    expect(runId.length).toBeGreaterThan(0);

    // Wait for the subagent process to likely complete its initial write
    await delay(1000);

    console.log("\n--- Checking initial status ---");
    const initialStatus = await checkSubagentStatus(subagentName, runId);
    console.log("Initial status:", JSON.stringify(initialStatus, null, 2));

    expect(initialStatus).toBeDefined();
    expect(initialStatus.runId).toBe(runId);
    expect(initialStatus.status).toBe("success"); // The 'echo' command should succeed
    expect(initialStatus.summary).toBeNull();
    expect(initialStatus.command).toContain("Hello from Vitest!");
  });

  it("should update the subagent status with a summary", async () => {
    expect(runId, "runId must be set from previous test").toBeDefined();
    const summaryText = "The task was completed successfully by Vitest.";

    console.log("\n--- Updating status with summary ---");
    const updatedStatus = await updateSubagentStatus(
      subagentName,
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
    console.log("\n--- Checking status after update ---");
    const finalStatus = await checkSubagentStatus(subagentName, runId);
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
    console.log("\n--- Getting logs ---");
    const logs = await getSubagentLogs(subagentName, runId);
    console.log("Logs:", logs);

    expect(logs).toBeTypeOf("string");
    expect(logs).toContain("Hello from Vitest!");
    expect(logs).toContain("Status updated to: completed");
    expect(logs).toContain(
      "Summary: The task was completed successfully by Vitest."
    );
  });
});
