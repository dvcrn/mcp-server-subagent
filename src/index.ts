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
  SubagentConfig,
} from "./tools/schemas.js";
import { runSubagent } from "./tools/run.js";
import { checkSubagentStatus, updateSubagentStatus } from "./tools/status.js";
import { getSubagentLogs } from "./tools/logs.js";

// Define the log directory
export const LOG_DIR = join(process.cwd(), "logs");

// MCP configuration for Claude CLI
export const mcpConfig = {
  mcpServers: {
    subagent: {
      command: "npx",
      args: ["-y", "mcp-server-subagent"],
    },
  },
};

// Define the subagent configuration
export const SUBAGENTS: Record<string, SubagentConfig> = {
  q: {
    name: "q",
    command: "q",
    getArgs: (input: string) => [
      "chat",
      "--trust-all-tools",
      "--no-interactive",
      input,
    ],
    description: "Run a query through the Amazon Q CLI",
  },
  claude: {
    name: "claude",
    command: "claude",
    getArgs: (input: string) => [
      "--print",
      "--allowedTools",
      "Bash(git*) Edit Write mcp__subagent__update_subagent_claude_status",
      "--mcp-config",
      JSON.stringify(mcpConfig),
      input,
    ],
    description: "Run a query through the Claude CLI",
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
  for (const subagent of Object.values(SUBAGENTS)) {
    // Exclude the 'test' subagent from being exposed
    if (subagent.name === "test") {
      continue;
    }

    tools.push({
      name: `run_subagent_${subagent.name}`,
      description: `Delegates the given task to a ${subagent.name} subagent as an asynchronous sub-task. This creates a new agent instance that will handle the provided input independently and report back its results. The task can be short or long-running. Use check_subagent_${subagent.name}_status with the returned runId to monitor progress, as completion may take some time.\nSynonyms: Run subtask, run sub-agent, delegate task, delegate sub-task.\n${subagent.description}`,
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
      name: `check_subagent_${subagent.name}_status`,
      description: `Check the status of a ${subagent.name} subagent run`,
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
      name: `get_subagent_${subagent.name}_logs`,
      description: `Get the logs of a ${subagent.name} subagent run. This can be VERY long, so only use this tool if instructed.`,
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
      name: `update_subagent_${subagent.name}_status`,
      description: `Update the status and summary of a ${subagent.name} subagent run. This tool is meant to be used from sub-agents, not the main agent.`,
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
      const subagentConfig = SUBAGENTS[subagentName];
      if (!subagentConfig) {
        throw new Error(`Unknown subagent: ${subagentName}`);
      }
      const { input } = RunSubagentArgumentsSchema.parse(args);

      await ensureLogDir();
      const runId = await runSubagent(subagentConfig, input, LOG_DIR);

      return {
        content: [
          {
            type: "text",
            text: `Subagent ${subagentConfig.name} started with run ID: ${runId}.\n\nUse check_subagent_${subagentConfig.name}_status to check the status. As this task can take a while, periodically check status in 30 second intervals or smilar.`,
          },
        ],
      };
    }

    // Handle check_subagent_*_status tools
    if (name.startsWith("check_subagent_") && name.endsWith("_status")) {
      const subagentName = name
        .replace("check_subagent_", "")
        .replace("_status", "");
      const subagentConfig = SUBAGENTS[subagentName];
      if (!subagentConfig) {
        throw new Error(`Unknown subagent: ${subagentName}`);
      }
      const { runId } = CheckSubagentStatusArgumentsSchema.parse(args);

      const status = await checkSubagentStatus(
        subagentConfig.name,
        runId,
        LOG_DIR
      );

      return {
        content: [
          {
            type: "text",
            text: `Status for ${
              subagentConfig.name
            } run ${runId}:\n\n${JSON.stringify(status, null, 2)}`,
          },
        ],
      };
    }

    // Handle get_subagent_*_logs tools
    if (name.startsWith("get_subagent_") && name.endsWith("_logs")) {
      const subagentName = name
        .replace("get_subagent_", "")
        .replace("_logs", "");
      const subagentConfig = SUBAGENTS[subagentName];
      if (!subagentConfig) {
        throw new Error(`Unknown subagent: ${subagentName}`);
      }
      const { runId } = GetSubagentLogsArgumentsSchema.parse(args);

      const logs = await getSubagentLogs(subagentConfig.name, runId, LOG_DIR);

      return {
        content: [
          {
            type: "text",
            text: `Logs for ${subagentConfig.name} run ${runId}:\n\n${logs}`,
          },
        ],
      };
    }

    // Handle update_subagent_*_status tools
    if (name.startsWith("update_subagent_") && name.endsWith("_status")) {
      const subagentName = name
        .replace("update_subagent_", "")
        .replace("_status", "");
      const subagentConfig = SUBAGENTS[subagentName];
      if (!subagentConfig) {
        throw new Error(`Unknown subagent: ${subagentName}`);
      }
      const { runId, status, summary } =
        UpdateSubagentStatusArgumentsSchema.parse(args);

      const updatedStatus = await updateSubagentStatus(
        subagentConfig.name,
        runId,
        status,
        LOG_DIR,
        summary
      );

      return {
        content: [
          {
            type: "text",
            text: `Status for ${
              subagentConfig.name
            } run ${runId} updated:\n\n${JSON.stringify(
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
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
