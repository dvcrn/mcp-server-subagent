# MCP Subagent Server

This is a Model Context Protocol (MCP) server that allows dispatching of tasks to sub-agent (like Claude Code, Q or Aider)

The purpose of this MCP is to allow a "planning" agent to delegate tasks to "executor" agents

![screenshot](./screenshot.png)

## Features

- Configure and run sub-agents through MCP tools
- Each sub-agent exposes three tools:
  - `run_subagent_<n>`: Runs the sub-agent with provided input
  - `check_subagent_<n>_status`: Checks the status of a previous run
  - `get_subagent_<n>_logs`: Retrieves the logs of a previous run
  - `update_subagent_<n>_status`: Updates the status and adds a summary of a previous run
- Currently supports the 'q' sub-agent (Amazon Q CLI) and 'claude' sub-agent (Claude CLI)
- Real-time streaming logs for monitoring sub-agent execution

## Installation

### Global Installation (recommended)

```bash
# Install globally using npm
npm install -g mcp-server-subagent

# Or using npx directly
npx mcp-server-subagent
```

### Local Installation

```bash
# Clone the repository
git clone https://github.com/dvcrn/mcp-server-subagent.git
cd mcp-server-subagent

# Install dependencies
npm install

# Build the project
npm run build

# Run the server
npm start
```

## Usage

### Running the Server

If installed globally:

```bash
mcp-server-subagent
```

Using npx:

```bash
npx mcp-server-subagent
```

Local installation:

```bash
npm start
```

### Configuring in your editor

Add this to your Amazon Q MCP configuration file (`~/.aws/amazonq/mcp.json`):

```json
{
  "mcpServers": {
    "subagent": {
      "command": "npx",
      "args": ["-y", "mcp-server-subagent"]
    }
  }
}
```

Or if you installed it locally:

```json
{
  "mcpServers": {
    "subagent": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/mcp-server-subagent/build/index.js"]
    }
  }
}
```

### Available Tools

- `run_subagent_q`: Run a query through the Amazon Q CLI

  - Parameters: `input` (string) - The query to send to Amazon Q
  - Returns: A run ID that can be used to check the status or get logs

- `check_subagent_q_status`: Check the status of a previous Amazon Q run

  - Parameters: `runId` (string) - The UUID of the run to check
  - Returns: The status and metadata of the run

- `get_subagent_q_logs`: Get the logs of a previous Amazon Q run

  - Parameters: `runId` (string) - The UUID of the run to get logs for
  - Returns: The complete logs of the run

- `update_subagent_q_status`: Update the status and add a summary of a previous Amazon Q run

  - Parameters:
    - `runId` (string) - The UUID of the run to update
    - `status` (string) - The new status to set (one of: "success", "error", "running", "completed")
    - `summary` (string, optional) - A summary or result message to include with the status update
  - Returns: The updated status and metadata of the run

- `run_subagent_claude`: Run a query through the Claude CLI

  - Parameters: `input` (string) - The query to send to Claude
  - Returns: A run ID that can be used to check the status or get logs

- `check_subagent_claude_status`: Check the status of a previous Claude run

  - Parameters: `runId` (string) - The UUID of the run to check
  - Returns: The status and metadata of the run

- `get_subagent_claude_logs`: Get the logs of a previous Claude run

  - Parameters: `runId` (string) - The UUID of the run to get logs for
  - Returns: The complete logs of the run

- `update_subagent_claude_status`: Update the status and add a summary of a previous Claude run
  - Parameters:
    - `runId` (string) - The UUID of the run to update
    - `status` (string) - The new status to set (one of: "success", "error", "running", "completed")
    - `summary` (string, optional) - A summary or result message to include with the status update
  - Returns: The updated status and metadata of the run

## Adding New Sub-agents

To add a new sub-agent, modify the `SUBAGENTS` object in `src/index.ts`:

```typescript
const SUBAGENTS = {
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
  // Add your new sub-agent here
  newagent: {
    name: "newagent",
    command: "your-command",
    getArgs: (input: string) => ["--some-flag", input, "--other-flags"],
    description: "Description of your new agent",
  },
};
```

## Logs

All sub-agent runs are logged to the `logs` directory with two files per run:

- `<agent-name>-<run-id>.log`: Contains the real-time output logs
- `<agent-name>-<run-id>.meta.json`: Contains metadata about the run
