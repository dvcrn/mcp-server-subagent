import { promises as fs } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { createWriteStream } from "fs";
import { v4 as uuidv4 } from "uuid";
import { SubagentConfig } from "./schemas.js"; // Import SubagentConfig

// Run a subagent and return the run ID
export async function runSubagent(
  subagent: SubagentConfig, // Use SubagentConfig type
  input: string,
  cwd: string,
  logDir: string
): Promise<string> {
  if (!subagent) {
    // This check might be redundant if type guarantees subagent exists
    throw new Error(`Subagent configuration is missing.`);
  }

  const runId = uuidv4();
  const logFile = join(logDir, `${subagent.name}-${runId}.log`);
  const metadataFile = join(logDir, `${subagent.name}-${runId}.meta.json`);

  // Construct the prompt
  const toolName = `update_subagent_${subagent.name}_status`;
  const prompt = `
This is a sub-task executed by an automated agent.
Your unique run ID for this task is: ${runId}.
You MUST report your final status and results using the MCP tool: ${toolName}.
Ensure all necessary information is included in your update via this tool.
Instructions are the following:
---
`;
  const fullInput = prompt + input;

  // Get command and arguments using the function with the modified input
  const command = subagent.command;
  const args = subagent.getArgs(fullInput);

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
      cwd: cwd,
    });

    // Log timestamp at the beginning
    logStream.write(
      `[${new Date().toISOString()}] Starting ${
        subagent.name
      } with input: ${input}\n`
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
      // Ensure the stream is fully flushed before reading/writing metadata
      await new Promise<void>((resolve) => logStream.end(resolve));

      let currentMetadata;
      try {
        const metadataContent = await fs.readFile(metadataFile, "utf-8");
        currentMetadata = JSON.parse(metadataContent);
      } catch (readError) {
        console.error(
          `Error reading metadata file ${metadataFile} on process close:`,
          readError
        );
        // Fallback to the initial metadata if reading fails.
        // This ensures critical fields like runId, command, startTime are preserved.
        currentMetadata = metadata; // 'metadata' is the initial metadata from the outer scope
      }

      let finalSummary = currentMetadata.summary;

      if (code !== 0) {
        // If the process errored and the subagent didn't set a specific summary,
        // provide a fallback summary from the log tail.
        if (!finalSummary) {
          try {
            const logContent = await fs.readFile(logFile, "utf-8");
            finalSummary = logContent.split("\n").slice(-50).join("\n");
          } catch (logError) {
            console.error(`Error reading log file for summary: ${logError}`);
            // If log reading also fails, set a generic error message for the summary.
            finalSummary = "Error reading log file for summary.";
          }
        }
      }

      // Update metadata file with completion info, using currentMetadata as base
      const updatedMetadata = {
        ...currentMetadata,
        status: code === 0 ? "success" : "error",
        exitCode: code,
        endTime,
        summary: finalSummary,
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
    console.error(`Error executing subagent ${subagent.name}:`, error);
    throw error;
  }
}
