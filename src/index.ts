#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { promises as fs } from "fs";
import { join } from "path";
import {
  RunSubagentArgumentsSchema,
  CheckSubagentStatusArgumentsSchema,
  GetSubagentLogsArgumentsSchema,
  UpdateSubagentStatusArgumentsSchema,
} from "./tools/schemas.js";
import { runSubagent } from "./tools/run.js";
import { checkSubagentStatus, updateSubagentStatus } from "./tools/status.js";
import { getSubagentLogs } from "./tools/logs.js";

// Define the log directory
export const LOG_DIR = join(process.cwd(), "logs");

// Define the subagent configuration
export const SUBAGENTS = {
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
  // test and test_fail agents will be removed from here and added in tests
};

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
