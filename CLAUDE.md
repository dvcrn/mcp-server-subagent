---
description: 
globs: 
alwaysApply: true
---
# MCP Subagent Server - Handover Document

This document provides a high-level overview for engineers new to the `mcp-server-subagent` project.

## 1. Purpose & Overview

This MCP server enables a planning agent to delegate tasks to CLI-based executor sub-agents. It manages sub-agent execution, status tracking, logging, and result/summary reporting via MCP tools.

## 2. Core Architecture & Flow

*   **Technology**: Node.js, TypeScript, `@modelcontextprotocol/sdk`.
*   **Main Logic**: `src/index.ts` orchestrates sub-agent definitions and serves as the main entry point. MCP tool handlers and core functions for process spawning, logging, status management, and their related schemas are now modularized under `src/tools/` (see `src/tools/run.ts`, `src/tools/status.ts`, `src/tools/logs.ts`, and `src/tools/schemas.ts`).
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
    *   Test agents (e.g., for echoing or intentional failures) are defined and instantiated directly within test files (e.g., `src/test.spec.ts`) using the `SubagentConfig` interface. This keeps production subagent configurations in `src/index.ts` clean and avoids modifying shared state during tests.
    *   Tests directly call exported functions from `src/index.ts` (or more commonly, the refactored tool functions from `src/tools/*.ts` directly).
*   **Local Run**: `npm start` (or `npm run dev` for watch mode).
*   **Adding Production Sub-agents**: Modify the `SUBAGENTS` object in `src/index.ts`.

### Task Completion & Testing

- **Mandatory Testing:** Before any development task (new feature, refactor, bug fix) is considered complete, all project tests MUST be executed.
- **Passing State:** The task is only complete if all tests pass. If tests fail, the issues MUST be addressed and tests re-run until they pass.
- **Test Command:** The standard command for running tests is `npm test`.

### Git Commit Workflow

1.  **Task Completion:** Once a logical unit of work is considered complete (including all verifications like passing tests), a Git commit should be initiated by the assistant.
2.  **Propose Commit:** The assistant will propose creating a Git commit for the completed unit of work.
3.  **If Commit Confirmed:**
    a.  Run `git status` to confirm the changed files.
    b.  The assistant will identify and propose the set of files related to the completed logical unit of work to be included in the commit. The user will confirm or adjust this set.
    c.  Stage the specified files using `git add <file1> <file2> ...` or `git add .` if all changes in the working directory are to be staged for this logical unit.
    d.  The assistant will propose a concise and descriptive commit message adhering to the project's convention (see below). The user will confirm or adjust the message.
    e.  Create the commit using `git commit -m "Proposed descriptive commit message"`.

#### Commit Message Convention
*   Start the message with a verb, capitalized, describing the primary action of the commit (e.g., "Add", "Update", "Fix", "Refactor", "Remove").
*   The message should be phrased so that it completes the sentence: "When this commit is applied, it will <commit message>".
*   Do not use prefixes like "feat:", "fix:", "chore:", etc.
*   Keep messages concise but descriptive.

## 4. Key Conventions

*   **Logging**: Server status to console; detailed run logs to `logs/<agent-name>-<run-id>.log` and metadata to `logs/<agent-name>-<run-id>.meta.json`.
*   **Modules**: ES Modules.

Refer to `README.md` for end-user installation/usage and `package.json` for detailed scripts and dependencies. 