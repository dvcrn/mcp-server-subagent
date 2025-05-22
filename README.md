# MCP Subagent Server

This is a Model Context Protocol (MCP) server that allows configuration and execution of sub-agents through CLI scripts.

## Features

- Configure and run sub-agents through MCP tools
- Each sub-agent exposes three tools:
  - `run_subagent_<name>`: Runs the sub-agent with provided input
  - `check_subagent_<name>_status`: Checks the status of a previous run
  - `get_subagent_<name>_logs`: Retrieves the logs of a previous run
- Currently supports the 'q' sub-agent (Amazon Q CLI)
- Real-time streaming logs for monitoring sub-agent execution

## Installation

```bash
# Install dependencies
npm install

# Build the project
npm run build
```

## Usage

### Running the Server

```bash
npm start
```

### Testing

```bash
# Build and run the test script
npm run build && node build/test.js
```

### Configuring with Amazon Q

Add this to your Amazon Q MCP configuration file (`~/.aws/amazonq/mcp.json`):

```json
{
  "mcpServers": {
    "subagent": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/mcp-server-subagent/build/index.js"
      ]
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

## Adding New Sub-agents

To add a new sub-agent, modify the `SUBAGENTS` object in `src/index.ts`:

```typescript
const SUBAGENTS = {
  q: {
    command: 'q',
    args: ['chat', '{input}', '--trust-all-tools', '--no-interactive'],
    description: 'Run a query through the Amazon Q CLI'
  },
  // Add your new sub-agent here
  newagent: {
    command: 'your-command',
    args: ['{input}', '--other-flags'],
    description: 'Description of your new agent'
  }
};
```

## Logs

All sub-agent runs are logged to the `logs` directory with two files per run:
- `<agent-name>-<run-id>.log`: Contains the real-time output logs
- `<agent-name>-<run-id>.meta.json`: Contains metadata about the run
