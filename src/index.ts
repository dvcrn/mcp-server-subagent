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
    getArgs: (input: string) => ["chat", input, "--trust-all-tools", "--no-interactive"],
    description: "Run a query through the Amazon Q CLI",
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
  },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = [];

  // Add run tools for each subagent
  for (const [name, config] of Object.entries(SUBAGENTS)) {
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
  }

  return { tools };
});

// Ensure log directory exists
async function ensureLogDir() {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (error) {
    console.error("Error creating log directory:", error);
    throw error;
  }
}

// Run a subagent and return the run ID
async function runSubagent(name: string, input: string): Promise<string> {
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
      `[${new Date().toISOString()}] Starting ${name} with input: ${input}\n`,
    );
    logStream.write(
      `[${new Date().toISOString()}] Command: ${command} ${args.join(" ")}\n`,
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
        JSON.stringify(updatedMetadata, null, 2),
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
async function checkSubagentStatus(name: string, runId: string): Promise<any> {
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
async function getSubagentLogs(name: string, runId: string): Promise<string> {
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
            text: `Status for ${subagentName} run ${runId}:\n\n${JSON.stringify(status, null, 2)}`,
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

    throw new Error(`Unknown tool: ${name}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `Invalid arguments: ${error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ")}`,
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
