# Design Document: Bi-Directional Communication for MCP Subagent Server

**Date:** May 23, 2025  
**Author:** Cline (AI Assistant)  
**Status:** Proposed

## 1. Introduction

This document outlines the design for a new feature enabling bi-directional communication between a parent agent and a subagent managed by the `mcp-server-subagent`. This will allow subagents to proactively ask questions or send messages to the parent and receive replies, enhancing their interactive capabilities.

## 2. Goals

- Enable subagents to send messages/questions to the parent agent.
- Enable the parent agent to reply to specific messages from a subagent.
- Maintain communication state and history within the existing `.meta.json` file structure.
- Provide clear MCP tools for both subagent and parent to facilitate this communication.
- Ensure the subagent can poll for replies and that the system status reflects the communication flow.

## 3. Proposed Solution

The solution involves introducing two new MCP tools, `ask_parent` and `reply_subagent`, and extending the `.meta.json` file schema to accommodate message exchanges.

### 3.1. Changes to `.meta.json` Structure

The `MetaFileContent` schema (currently defined in `src/tools/schemas.ts`) will be updated to include an optional `messages` array.

- **`messages`: `CommunicationMessage[]` (optional)**

  - Each `CommunicationMessage` object will have the following structure:

    ```typescript
    interface CommunicationMessage {
      messageId: string; // Unique ID for this specific communication exchange
      questionContent: string; // The question/message from the subagent
      questionTimestamp: string; // ISO timestamp of when the question was asked
      answerContent?: string | null; // The reply from the parent
      answerTimestamp?: string | null; // ISO timestamp of when the reply was given
      messageStatus:
        | "pending_parent_reply"
        | "parent_replied"
        | "acknowledged_by_subagent";
      // Status of this specific message
    }
    ```

- **New Main Statuses in `.meta.json` (for `meta.status`):**
  - `"waiting_parent_reply"`: Indicates the subagent has asked a question and is awaiting a reply from the parent.
  - `"parent_replied"`: Indicates the parent has replied, and the subagent can now fetch the response.

### 3.2. New MCP Tool: `ask_parent`

- **Purpose:** Enables the subagent to ask a question to the parent.
- **Implementation File:** A new file, e.g., `src/tools/askParent.ts`.
- **Parameters (Input Schema):**
  - `runId`: string (The subagent's current run ID)
  - `question`: string (The question/message content)
- **Actions:**
  1. Reads the `.meta.json` file for the given `runId`.
  2. Generates a new unique `messageId` (e.g., using a UUID library).
  3. Adds a new `CommunicationMessage` object to the `meta.messages` array with `messageStatus: "pending_parent_reply"`.
  4. Updates the main `meta.status` to `"waiting_parent_reply"`.
  5. Writes the updated `meta` object back to the `.meta.json` file.
- **Returns (Output Schema):**
  ```json
  {
    "messageId": "unique-message-id",
    "instructions": "Poll status using 'check_subagent_<agent_name>_status' tool with your runId to check for a reply."
  }
  ```

### 3.3. New MCP Tool: `reply_subagent`

- **Purpose:** Enables the parent to reply to a specific question from a subagent.
- **Implementation File:** A new file, e.g., `src/tools/replySubagent.ts`.
- **Parameters (Input Schema):**
  - `runId`: string (The subagent's run ID)
  - `messageId`: string (The ID of the message being replied to)
  - `answer`: string (The parent's reply content)
- **Actions:**
  1. Reads the `.meta.json` file for the `runId`.
  2. Finds the `CommunicationMessage` by `messageId`.
  3. If found and `messageStatus` is `"pending_parent_reply"`:
     - Updates `answerContent`, `answerTimestamp`, and sets `messageStatus` to `"parent_replied"`.
  4. Updates the main `meta.status` to `"parent_replied"`.
  5. Writes the updated `meta` object back to the `.meta.json` file.
- **Returns (Output Schema):**
  ```json
  {
    "success": true,
    "message": "Reply successfully recorded.",
    "updatedMetadata": {
      /* current meta.json content */
    }
  }
  ```

### 3.4. Modifications to `check_subagent_<agent_name>_status` Tool

The existing tool (handler in `src/tools/status.ts`) will be enhanced:

- **When `meta.status` is `"waiting_parent_reply"`:**
  - The response will include the `messages` array.
  - It will provide instructions to the parent on how to use `reply_subagent` for pending messages.
- **When `meta.status` is `"parent_replied"`:**
  - The response will include the `messages` array, allowing the subagent to retrieve the `answerContent`.
  - **Automatic Status Transition:** After preparing the response for the subagent (containing the reply), the tool will:
    1. Update the main `meta.status` in `.meta.json` back to `"running"`.
    2. Update the `messageStatus` of the replied message to `"acknowledged_by_subagent"`.
    3. Save these changes to `.meta.json`.
    4. Return the prepared response (which reflects the "parent_replied" state and includes the answer) to the subagent.

### 3.5. Updates to `src/index.ts`

- New tool handler functions from `src/tools/askParent.ts` and `src/tools/replySubagent.ts` will be imported.
- The `ask_parent` and `reply_subagent` tools (with their schemas and handlers) will be registered once for the server. The handlers will use the provided `runId` to operate on the correct subagent's context.

## 4. Testing Strategy

**Robust unit testing is paramount for this feature due to its interactive nature and multiple state transitions.** New unit tests will be created (e.g., in `src/test.spec.ts` or a new `src/communication.spec.ts`) to **comprehensively** cover:

- Correct creation of messages by `ask_parent`.
- Correct retrieval of status and instructions by `check_subagent_<agent_name>_status` when waiting for a reply.
- Correct recording of replies by `reply_subagent`.
- Correct retrieval of answers by `check_subagent_<agent_name>_status` when a reply is available.
- Verification of the automatic status transition back to `"running"` and message status to `"acknowledged_by_subagent"` after a subagent retrieves a reply.
- **Thorough testing of all state transitions** in `.meta.json` (main status and message status).
- **Edge cases:** e.g., parent replying to an already acknowledged message, subagent asking multiple questions before a reply, etc.
- Error handling for invalid inputs (e.g., incorrect `runId`, `messageId`).

## 5. Open Questions / Considerations

- (None at this time, but can be added as development progresses)

## 6. Future Enhancements

- Support for multiple pending questions from a subagent.
- Timeouts for parent replies.

---

## 7. Implementation Plan

- [x] Update `MetaFileContent` schema in `src/tools/schemas.ts`
- [x] Implement `ask_parent` tool in `src/tools/askParent.ts`
- [x] Implement `reply_subagent` tool in `src/tools/replySubagent.ts`
- [ ] Extend the `check_subagent_<agent_name>_status` handler in `src/tools/status.ts`
- [ ] Register new tools in `src/index.ts`
- [ ] Write unit tests in `src/communication.spec.ts`
- [ ] Refactor existing tool names to generic forms

## Refactor Note (Not Part of This Design Doc)

**Additionally, all other tool names should be refactored to remove the `<agent_name>` part for any tool that is not `run_`.**  
This means tools like `check_subagent_<agent_name>_status`, `get_subagent_<agent_name>_logs`, and `update_subagent_<agent_name>_status` should be renamed to generic forms such as `check_status`, `get_logs`, and `update_status`, respectively.  
These tools should rely solely on the `runId` parameter to identify the relevant subagent session.  
This refactor should be performed in the same style as described above for the new communication tools.

This document will serve as the guide for implementing the feature.
