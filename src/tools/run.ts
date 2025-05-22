import { promises as fs } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { v4 as uuidv4 } from "uuid";
import { SUBAGENTS, LOG_DIR } from "../index.js"; // Assuming LOG_DIR will be exported from index.ts

// Run a subagent and return the run ID
export async function runSubagent(
  name: string,
  input: string
): Promise<string> {
  const subagent = SUBAGENTS[name as keyof typeof SUBAGENTS];
  if (!subagent) {
    throw new Error(`Unknown subagent: ${name}`);
  }

  const runId = uuidv4();
  const logFile = join(LOG_DIR, `${name}-${runId}.log`);
  const metadataFile = join(LOG_DIR, `${name}-${runId}.meta.json`);

  // Get command and arguments using the function
  const command = subagent.command;
  const args = subagent.getArgs(input);

  // Create log file stream for real-time logging
  const logStream = createWriteStream(logFile, { flags: "a" });

  // Write initial metadata
  const metadata = {
    runId,
    command: `${command} ${args.join(" ")}`,
    startTime: new Date().toISOString(),
    status: "running",
    exitCode: null,
    endTime: null,
    summary: null,
  };

  await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2));

  try {
    // Log the command being executed (for debugging)
    console.error(`Executing: ${command} ${args.join(" ")}`);

    // Use spawn instead of exec for better stream handling
    const process = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Log timestamp at the beginning
    logStream.write(
      `[${new Date().toISOString()}] Starting ${name} with input: ${input}\n`
    );
    logStream.write(
      `[${new Date().toISOString()}] Command: ${command} ${args.join(" ")}\n`
    );

    // Stream stdout to log file in real-time
    process.stdout.on("data", (data) => {
      const timestamp = new Date().toISOString();
      logStream.write(`[${timestamp}] [stdout] ${data}`);
    });

    // Stream stderr to log file in real-time
    process.stderr.on("data", (data) => {
      const timestamp = new Date().toISOString();
      logStream.write(`[${timestamp}] [stderr] ${data}`);
    });

    // Update metadata when process completes
    process.on("close", async (code) => {
      const endTime = new Date().toISOString();
      logStream.write(`[${endTime}] Process exited with code ${code}\n`);
      // Ensure the stream is fully flushed before reading the log file
      await new Promise((resolve) => logStream.end(resolve));

      let summary = null;
      if (code !== 0) {
        try {
          const logContent = await fs.readFile(logFile, "utf-8");
          summary = logContent.split("\n").slice(-50).join("\n");
        } catch (logError) {
          console.error(`Error reading log file for summary: ${logError}`);
          summary = "Error reading log file for summary.";
        }
      }

      // Update metadata file with completion info
      const updatedMetadata = {
        ...metadata,
        status: code === 0 ? "success" : "error",
        exitCode: code,
        endTime,
        summary: summary || metadata.summary, // Use log summary if error, otherwise keep existing or null
      };

      await fs.writeFile(
        metadataFile,
        JSON.stringify(updatedMetadata, null, 2)
      );
    });

    // Return the run ID immediately
    return runId;
  } catch (error) {
    // Log error and update metadata
    const errorTime = new Date().toISOString();
    logStream.write(`[${errorTime}] Error executing subagent: ${error}\n`);
    // Ensure the stream is fully flushed before reading the log file
    await new Promise((resolve) => logStream.end(resolve));

    let summary = null;
    try {
      const logContent = await fs.readFile(logFile, "utf-8");
      summary = logContent.split("\n").slice(-50).join("\n");
    } catch (logError) {
      console.error(`Error reading log file for summary: ${logError}`);
      summary = "Error reading log file for summary.";
    }

    const errorMetadata = {
      ...metadata,
      status: "error",
      error: String(error),
      endTime: errorTime,
      summary: summary, // Add log summary to metadata
    };

    await fs.writeFile(metadataFile, JSON.stringify(errorMetadata, null, 2));
    console.error(`Error executing subagent ${name}:`, error);
    throw error;
  }
}
