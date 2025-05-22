# MCP Subagent Server - Handover Document

This document provides a high-level overview for engineers new to the `mcp-server-subagent` project.

## 1. Purpose & Overview

This MCP server enables a planning agent to delegate tasks to CLI-based executor sub-agents. It manages sub-agent execution, status tracking, logging, and result/summary reporting via MCP tools.

## 2. Core Architecture & Flow

*   **Technology**: Node.js, TypeScript, `@modelcontextprotocol/sdk`.
*   **Main Logic**: `src/index.ts` orchestrates sub-agent definitions (production agents in `SUBAGENTS` object, test agents injected dynamically), MCP tool handlers, and core functions for process spawning, logging, and status management.
*   **Execution**: Spawns sub-agents as child processes. Stdout/stderr are logged to timestamped files in `logs/`. A `.meta.json` file per run tracks ID, command, status, times, exit code, and a summary.
*   **Key MCP Tools Exposed**:
    *   `run_subagent_<name>`: Starts a sub-agent.
    *   `check_subagent_<name>_status`: Gets run metadata (including status & summary).
    *   `get_subagent_<name>_logs`: Retrieves raw logs.
    *   `update_subagent_<name>_status`: Allows external updates to status and summary.
*   **Error Handling**: Sub-agent CLI failures (non-zero exit) automatically set status to "error" and populate the summary with the last 50 log lines. Input validation via Zod.

## 3. Development & Testing

*   **Build**: `npm run build` (compiles TypeScript to `build/`).
*   **Testing**: `npm test` (runs Vitest, `*.spec.ts` files in `src/`).
    *   Test agents are dynamically added to the `SUBAGENTS` configuration within test files (see `src/test.spec.ts`) to keep production code clean.
    *   Tests directly call exported functions from `src/index.ts`.
*   **Local Run**: `npm start` (or `npm run dev` for watch mode).
*   **Adding Production Sub-agents**: Modify the `SUBAGENTS` object in `src/index.ts`.

## 4. Key Conventions

*   **Logging**: Server status to console; detailed run logs to `logs/<agent-name>-<run-id>.log` and metadata to `logs/<agent-name>-<run-id>.meta.json`.
*   **Modules**: ES Modules.

Refer to `README.md` for end-user installation/usage and `package.json` for detailed scripts and dependencies. 