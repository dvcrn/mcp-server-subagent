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
import { homedir, tmpdir } from "os";
import {
  RunSubagentArgumentsSchema,
  CheckSubagentStatusArgumentsSchema,
  GetSubagentLogsArgumentsSchema,
  UpdateSubagentStatusArgumentsSchema,
  SubagentConfig,
  CommunicationMessage,
} from "./tools/schemas.js";
import { runSubagent } from "./tools/run.js";
import { checkSubagentStatus, updateSubagentStatus } from "./tools/status.js";
import { getSubagentLogs } from "./tools/logs.js";
import {
  AskParentInputSchema,
  AskParentOutputSchema,
  askParentHandler,
} from "./tools/askParent.js";
import {
  replySubagentInputSchema,
  replySubagentOutputSchema,
  replySubagentHandler,
} from "./tools/replySubagent.js";
import {
  CheckMessageStatusArgumentsSchema,
  CheckMessageStatusOutputSchema,
  checkMessageStatusHandler,
} from "./tools/checkMessage.js";

// Function to determine the log directory with fallbacks
function getLogDir(): string {
  const candidates = [
    join(homedir(), ".config", "mcp-server-subagent", "logs"),
    join(process.cwd(), "logs"),
    join(tmpdir(), "mcp-server-subagent", "logs"),
  ];

  return candidates[0]; // Start with the first candidate
}

// Define the log directory
export let LOG_DIR = getLogDir();

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
    getArgs: () => ["chat", "--trust-all-tools", "--no-interactive"],
    description: "Run a query through the Amazon Q CLI",
  },
  claude: {
    name: "claude",
    command: "claude",
    getArgs: () => [
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
      "--allowedTools",
      "Bash(git*),Bash(make*),Bash(just*),Bash(gh*),Bash(npm*),Bash(node*),Bash(go*),Bash,Edit,Write,mcp__subagent__update_subagent_status,mcp__subagent__ask_parent,mcp__subagent__check_message_status",
      "--mcp-config",
      JSON.stringify(mcpConfig),
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
  },
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
      description: `Delegates the given task to a ${subagent.name} subagent as an asynchronous sub-task. This creates a new agent instance that will handle the provided input independently and report back its results. The task can be short or long-running. Use check_subagent_status with the returned runId to monitor progress, as completion may take some time.\nSynonyms: Run subtask, run sub-agent, delegate task, delegate sub-task.\n${subagent.description}`,
      inputSchema: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "Input to send to the subagent",
          },
          cwd: {
            type: "string",
            description:
              "Working directory path (project root) where the subagent should be executed. Set this to the current working directory, or the current project root, usually the directory with the .git/ folder.",
          },
        },
        required: ["input", "cwd"],
      },
    });
  }

  // Add generic status check tool
  tools.push({
    name: "check_subagent_status",
    description:
      "Check the status of a subagent run. Since sub-agents can take a while it is recommneded to wait at least 30 or 60 seconds (`sleep 30`) in between polling intervals.",
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

  // Add generic logs retrieval tool
  tools.push({
    name: "get_subagent_logs",
    description:
      "Get the logs of a subagent run. This can be VERY long, so only use this tool if instructed. Requires only the runId.",
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

  // Add generic update status tool
  tools.push({
    name: "update_subagent_status",
    description:
      "Update the status and summary of a subagent run. This tool is meant to be used from sub-agents, not the main agent. Requires runId and status.",
    inputSchema: {
      type: "object",
      properties: {
        runId: {
          type: "string",
          description: "Run ID to update status for",
        },
        status: {
          type: "string",
          enum: [
            "success",
            "error",
            "running",
            "completed",
            "waiting_parent_reply",
            "parent_replied",
          ],
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

  // Add bi-directional communication tools
  tools.push({
    name: "ask_parent",
    description: "Enables the subagent to ask a question to the parent agent.",
    inputSchema: {
      type: "object",
      properties: {
        runId: {
          type: "string",
          description: "The subagent's current run ID",
        },
        question: {
          type: "string",
          description: "The question/message content",
        },
      },
      required: ["runId", "question"],
    },
  });

  tools.push({
    name: "reply_subagent",
    description:
      "Enables the parent to reply to a specific question from a subagent.",
    inputSchema: {
      type: "object",
      properties: {
        runId: {
          type: "string",
          description: "The subagent's run ID",
        },
        messageId: {
          type: "string",
          description: "The ID of the message being replied to",
        },
        answer: {
          type: "string",
          description: "The parent's reply content",
        },
      },
      required: ["runId", "messageId", "answer"],
    },
  });

  tools.push({
    name: "check_message_status",
    description:
      "Check the status of a specific message and retrieve the reply if available. This will acknowledge the message if it has been replied to.",
    inputSchema: {
      type: "object",
      properties: {
        runId: {
          type: "string",
          description: "Run ID to check message status for",
        },
        messageId: {
          type: "string",
          description: "Message ID to check status for",
        },
      },
      required: ["runId", "messageId"],
    },
  });

  return { tools };
});

// Ensure log directory exists with fallback paths
export async function ensureLogDir() {
  const candidates = [
    // First try: user config directory (consistent across processes)
    join(homedir(), ".config", "mcp-server-subagent", "logs"),
    // Second try: current working directory
    join(process.cwd(), "logs"),
    // Last resort: temp directory
    join(tmpdir(), "mcp-server-subagent", "logs"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.mkdir(candidate, { recursive: true });
      LOG_DIR = candidate;
      console.error(`Using log directory: ${LOG_DIR}`);
      return;
    } catch (error) {
      console.error(`Failed to create log directory ${candidate}:`, error);
    }
  }

  throw new Error(
    "Unable to create log directory in any of the candidate locations",
  );
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
      const { input, cwd } = RunSubagentArgumentsSchema.parse(args);

      await ensureLogDir();
      const runId = await runSubagent(subagentConfig, input, cwd, LOG_DIR);

      return {
        content: [
          {
            type: "text",
            text: `Subagent ${subagentConfig.name} started in directory ${cwd} with run ID: ${runId}.\n\nUse check_subagent_status to check the status. As this task can take a while, periodically check status in 30 second intervals or similar (use "sleep 30").`,
          },
        ],
      };
    }

    // Handle check_subagent_status tool
    if (name === "check_subagent_status") {
      const { runId } = CheckSubagentStatusArgumentsSchema.parse(args);

      const statusObject = await checkSubagentStatus(runId, LOG_DIR);
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
            .find(
              (m: CommunicationMessage) =>
                m.messageStatus === "pending_parent_reply",
            );
          if (pendingMessage) {
            outputParts.push(``);
            outputParts.push(
              `Question awaiting reply (Message ID: ${pendingMessage.messageId}):`,
            );
            outputParts.push(`  ${pendingMessage.questionContent}`);
            outputParts.push(
              `  (Asked at: ${pendingMessage.questionTimestamp})`,
            );
            outputParts.push(`  To reply, use the 'reply_subagent' tool.`);
            outputParts.push(``);
            outputParts.push(
              `Note: This may take a while for the parent to respond. Use 'sleep 30' between status checks to avoid spamming.`,
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
              (m: CommunicationMessage) =>
                m.answerContent &&
                (m.messageStatus === "acknowledged_by_subagent" ||
                  m.messageStatus === "parent_replied"),
            );
          if (repliedMessage) {
            outputParts.push(``);
            outputParts.push(
              `Last Interaction (Message ID: ${repliedMessage.messageId}):`,
            );
            outputParts.push(`  Question: ${repliedMessage.questionContent}`);
            outputParts.push(
              `  (Asked at: ${repliedMessage.questionTimestamp})`,
            );
            outputParts.push(`  Answer: ${repliedMessage.answerContent}`);
            outputParts.push(
              `  (Answered at: ${repliedMessage.answerTimestamp})`,
            );
          }
        }
      }

      // Add general status-specific notes
      if (statusObject.status === "running") {
        outputParts.push(``);
        outputParts.push(
          `Note: Task is still running. This may take a while. Use 'sleep 30' between status checks to avoid spamming.`,
        );
      } else if (
        statusObject.status === "waiting_parent_reply" &&
        (!Array.isArray(statusObject.messages) ||
          statusObject.messages.length === 0)
      ) {
        outputParts.push(``);
        outputParts.push(
          `Note: Waiting for parent reply. This may take a while. Use 'sleep 30' between status checks to avoid spamming.`,
        );
      }

      const textOutput = outputParts.join("\n");

      return {
        content: [
          {
            type: "text",
            text: textOutput,
          },
        ],
      };
    }

    // Handle get_subagent_logs tool
    if (name === "get_subagent_logs") {
      const { runId } = GetSubagentLogsArgumentsSchema.parse(args);

      const logs = await getSubagentLogs(runId, LOG_DIR);

      return {
        content: [
          {
            type: "text",
            text: `Logs for run ${runId}:\n\n${logs}`,
          },
        ],
      };
    }

    // Handle update_subagent_status tool
    if (name === "update_subagent_status") {
      const { runId, status, summary } =
        UpdateSubagentStatusArgumentsSchema.parse(args);

      const updatedStatus = await updateSubagentStatus(
        runId,
        status,
        LOG_DIR,
        summary,
      );

      return {
        content: [
          {
            type: "text",
            text: `Status for run ${runId} updated:\n\n${JSON.stringify(
              updatedStatus,
              null,
              2,
            )}`,
          },
        ],
      };
    }

    // Handle ask_parent tool
    if (name === "ask_parent") {
      const parsed = AskParentInputSchema.parse(args);
      const result = await askParentHandler(parsed, LOG_DIR);
      AskParentOutputSchema.parse(result); // Validate output
      return {
        content: [
          {
            type: "text",
            text: `Message ID: ${result.messageId}\n\n${result.instructions}`,
          },
        ],
      };
    }

    // Handle reply_subagent tool
    if (name === "reply_subagent") {
      const parsed = replySubagentInputSchema.parse(args);
      const result = await replySubagentHandler(parsed, LOG_DIR);
      replySubagentOutputSchema.parse(result); // Validate output
      return {
        content: [
          {
            type: "text",
            text: result.message,
          },
        ],
      };
    }

    // Handle check_message_status tool
    if (name === "check_message_status") {
      const parsed = CheckMessageStatusArgumentsSchema.parse(args);
      const result = await checkMessageStatusHandler(parsed, LOG_DIR);
      CheckMessageStatusOutputSchema.parse(result); // Validate output

      const outputParts = [];
      outputParts.push(`Message ID: ${result.messageId}`);
      outputParts.push(`Status: ${result.messageStatus}`);
      outputParts.push(`Question: ${result.questionContent}`);
      outputParts.push(`Asked at: ${result.questionTimestamp}`);

      if (result.answerContent) {
        outputParts.push(`Answer: ${result.answerContent}`);
        outputParts.push(`Answered at: ${result.answerTimestamp}`);
      } else {
        outputParts.push(`Answer: Not yet answered`);
      }

      return {
        content: [
          {
            type: "text",
            text: outputParts.join("\n"),
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
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
