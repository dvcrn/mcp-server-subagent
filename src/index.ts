#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import { promises as fs } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import { createWriteStream } from "fs";

// Define the log directory
const LOG_DIR = join(process.cwd(), "logs");

// Define the subagent configuration
const SUBAGENTS = {
  q: {
    command: "q",
    // Use a function to generate arguments to handle complex inputs properly
    getArgs: (input: string) => [
      "chat",
      input,
      "--trust-all-tools",
      "--no-interactive",
    ],
    description: "Run a query through the Amazon Q CLI",
  },
  test: {
    command: "echo",
    getArgs: (input: string) => [
      `Simulating test subagent with input: ${input}`,
    ],
    description: "Test subagent that just echoes input",
  },
};

// Define Zod schemas for validation
const RunSubagentArgumentsSchema = z.object({
  input: z.string().min(1, "Input cannot be empty"),
});

const CheckSubagentStatusArgumentsSchema = z.object({
  runId: z.string().uuid("Run ID must be a valid UUID"),
});

const GetSubagentLogsArgumentsSchema = z.object({
  runId: z.string().uuid("Run ID must be a valid UUID"),
});

const UpdateSubagentStatusArgumentsSchema = z.object({
  runId: z.string().uuid("Run ID must be a valid UUID"),
  status: z.enum(["success", "error", "running", "completed"]),
  summary: z.string().optional(),
});

// Create server instance
const server = new Server(
  {
    name: "subagent",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [];

  // Add run tools for each subagent
  for (const [name, config] of Object.entries(SUBAGENTS)) {
    // Exclude the 'test' subagent from being exposed
    if (name === "test") {
      continue;
    }

    tools.push({
      name: `run_subagent_${name}`,
      description: `Run the ${name} subagent with the provided input`,
      inputSchema: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "Input to send to the subagent",
          },
        },
        required: ["input"],
      },
    });

    // Add status check tool for each subagent
    tools.push({
      name: `check_subagent_${name}_status`,
      description: `Check the status of a ${name} subagent run`,
      inputSchema: {
        type: "object",
        properties: {
          runId: {
            type: "string",
            description: "Run ID to check status for",
          },
        },
        required: ["runId"],
      },
    });

    // Add logs retrieval tool for each subagent
    tools.push({
      name: `get_subagent_${name}_logs`,
      description: `Get the logs of a ${name} subagent run`,
      inputSchema: {
        type: "object",
        properties: {
          runId: {
            type: "string",
            description: "Run ID to get logs for",
          },
        },
        required: ["runId"],
      },
    });

    // Add update status tool for each subagent
    tools.push({
      name: `update_subagent_${name}_status`,
      description: `Update the status and summary of a ${name} subagent run`,
      inputSchema: {
        type: "object",
        properties: {
          runId: {
            type: "string",
            description: "Run ID to update status for",
          },
          status: {
            type: "string",
            enum: ["success", "error", "running", "completed"],
            description: "New status to set",
          },
          summary: {
            type: "string",
            description:
              "Summary or result message to include with the status update",
          },
        },
        required: ["runId", "status"],
      },
    });
  }

  return { tools };
});

// Ensure log directory exists
export async function ensureLogDir() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (error) {
    console.error("Error creating log directory:", error);
    throw error;
  }
}

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
      logStream.end();

      // Update metadata file with completion info
      const updatedMetadata = {
        ...metadata,
        status: code === 0 ? "success" : "error",
        exitCode: code,
        endTime,
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
    logStream.end();

    const errorMetadata = {
      ...metadata,
      status: "error",
      error: String(error),
      endTime: errorTime,
    };

    await fs.writeFile(metadataFile, JSON.stringify(errorMetadata, null, 2));
    console.error(`Error executing subagent ${name}:`, error);
    throw error;
  }
}

// Check the status of a subagent run
export async function checkSubagentStatus(
  name: string,
  runId: string
): Promise<any> {
  try {
    const metadataFile = join(LOG_DIR, `${name}-${runId}.meta.json`);

    try {
      const metadataContent = await fs.readFile(metadataFile, "utf-8");
      return JSON.parse(metadataContent);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          runId,
          status: "not_found",
          message: "Run ID not found",
        };
      }
      throw error;
    }
  } catch (error) {
    console.error(`Error checking status for ${name} run ${runId}:`, error);
    throw error;
  }
}

// Get logs for a subagent run
export async function getSubagentLogs(
  name: string,
  runId: string
): Promise<string> {
  try {
    const logFile = join(LOG_DIR, `${name}-${runId}.log`);

    try {
      return await fs.readFile(logFile, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return `No logs found for run ID: ${runId}`;
      }
      throw error;
    }
  } catch (error) {
    console.error(`Error getting logs for ${name} run ${runId}:`, error);
    throw error;
  }
}

// Update the status and summary of a subagent run
export async function updateSubagentStatus(
  name: string,
  runId: string,
  status: string,
  summary?: string
): Promise<any> {
  try {
    const metadataFile = join(LOG_DIR, `${name}-${runId}.meta.json`);
    const logFile = join(LOG_DIR, `${name}-${runId}.log`);
    const timestamp = new Date().toISOString();

    try {
      // Read current metadata
      const metadataContent = await fs.readFile(metadataFile, "utf-8");
      const metadata = JSON.parse(metadataContent);

      // Update metadata with new status and summary
      const updatedMetadata = {
        ...metadata,
        status,
        summary: summary || metadata.summary,
        lastUpdated: timestamp,
      };

      // If status is terminal (success/error/completed), set endTime if not already set
      if (
        ["success", "error", "completed"].includes(status) &&
        !updatedMetadata.endTime
      ) {
        updatedMetadata.endTime = timestamp;
      }

      // Write updated metadata back to file
      await fs.writeFile(
        metadataFile,
        JSON.stringify(updatedMetadata, null, 2)
      );

      // Also log the status update to the log file
      try {
        const logStream = createWriteStream(logFile, { flags: "a" });
        logStream.write(`[${timestamp}] Status updated to: ${status}\n`);
        if (summary) {
          logStream.write(`[${timestamp}] Summary: ${summary}\n`);
        }
        logStream.end();
      } catch (error) {
        console.error(
          `Error writing to log file for ${name} run ${runId}:`,
          error
        );
      }

      return updatedMetadata;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          runId,
          status: "not_found",
          message: "Run ID not found",
        };
      }
      throw error;
    }
  } catch (error) {
    console.error(`Error updating status for ${name} run ${runId}:`, error);
    throw error;
  }
}

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Handle run_subagent_* tools
    if (name.startsWith("run_subagent_")) {
      const subagentName = name.replace("run_subagent_", "");
      const { input } = RunSubagentArgumentsSchema.parse(args);

      await ensureLogDir();
      const runId = await runSubagent(subagentName, input);

      return {
        content: [
          {
            type: "text",
            text: `Subagent ${subagentName} started with run ID: ${runId}.\n\nUse check_subagent_${subagentName}_status to check the status.\nUse get_subagent_${subagentName}_logs to view the logs.`,
          },
        ],
      };
    }

    // Handle check_subagent_*_status tools
    if (name.startsWith("check_subagent_") && name.endsWith("_status")) {
      const subagentName = name
        .replace("check_subagent_", "")
        .replace("_status", "");
      const { runId } = CheckSubagentStatusArgumentsSchema.parse(args);

      const status = await checkSubagentStatus(subagentName, runId);

      return {
        content: [
          {
            type: "text",
            text: `Status for ${subagentName} run ${runId}:\n\n${JSON.stringify(
              status,
              null,
              2
            )}`,
          },
        ],
      };
    }

    // Handle get_subagent_*_logs tools
    if (name.startsWith("get_subagent_") && name.endsWith("_logs")) {
      const subagentName = name
        .replace("get_subagent_", "")
        .replace("_logs", "");
      const { runId } = GetSubagentLogsArgumentsSchema.parse(args);

      const logs = await getSubagentLogs(subagentName, runId);

      return {
        content: [
          {
            type: "text",
            text: `Logs for ${subagentName} run ${runId}:\n\n${logs}`,
          },
        ],
      };
    }

    // Handle update_subagent_*_status tools
    if (name.startsWith("update_subagent_") && name.endsWith("_status")) {
      const subagentName = name
        .replace("update_subagent_", "")
        .replace("_status", "");
      const { runId, status, summary } =
        UpdateSubagentStatusArgumentsSchema.parse(args);

      const updatedStatus = await updateSubagentStatus(
        subagentName,
        runId,
        status,
        summary
      );

      return {
        content: [
          {
            type: "text",
            text: `Status for ${subagentName} run ${runId} updated:\n\n${JSON.stringify(
              updatedStatus,
              null,
              2
            )}`,
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid arguments: ${error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`
      );
    }
    throw error;
  }
});

// Start the server
async function main() {
  try {
    await ensureLogDir();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Subagent MCP Server running on stdio");
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
