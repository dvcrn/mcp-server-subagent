import { promises as fs } from "fs";
import { join } from "path";
import { createWriteStream } from "fs";
import type { CommunicationMessage } from "./schemas.js";

// Check the status of a subagent run
export async function checkSubagentStatus(
  name: string,
  runId: string,
  logDir: string
): Promise<any> {
  try {
    const metadataFile = join(logDir, `${name}-${runId}.meta.json`);
    const logFile = join(logDir, `${name}-${runId}.log`);

    try {
      const metadataContent = await fs.readFile(metadataFile, "utf-8");
      const metadata = JSON.parse(metadataContent);

      // Enhanced status handling for bi-directional communication
      const meta = metadata.meta || metadata; // fallback for legacy structure

      if (meta.status === "waiting_parent_reply") {
        return {
          ...metadata,
          messages: meta.messages ?? [],
          logFile,
          logDirectory: logDir,
        };
      }

      if (meta.status === "parent_replied") {
        // Update status and acknowledge the latest parent_replied message
        meta.status = "running";
        if (Array.isArray(meta.messages)) {
          // Find the latest message with messageStatus === "parent_replied"
          const idx = [...meta.messages]
            .reverse()
            .findIndex(
              (msg: CommunicationMessage) =>
                msg.messageStatus === "parent_replied"
            );
          if (idx !== -1) {
            // Reverse index to actual index
            const actualIdx = meta.messages.length - 1 - idx;
            meta.messages[actualIdx].messageStatus = "acknowledged_by_subagent";
          }
        }
        // Write back the updated metadata
        await fs.writeFile(metadataFile, JSON.stringify(metadata, null, 2));
        return {
          ...metadata,
          messages: meta.messages ?? [],
          logFile,
          logDirectory: logDir,
        };
      }

      // Default: preserve existing behavior
      return {
        ...metadata,
        logFile,
        logDirectory: logDir,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          runId,
          status: "not_found",
          message: "Run ID not found",
          logDirectory: logDir,
        };
      }
      throw error;
    }
  } catch (error) {
    console.error(`Error checking status for ${name} run ${runId}:`, error);
    throw error;
  }
}

// Update the status and summary of a subagent run
export async function updateSubagentStatus(
  name: string,
  runId: string,
  status: string,
  logDir: string,
  summary?: string
): Promise<any> {
  try {
    const metadataFile = join(logDir, `${name}-${runId}.meta.json`);
    const logFile = join(logDir, `${name}-${runId}.log`);
    const timestamp = new Date().toISOString();

    // Log received summary argument for debugging
    console.log(
      `[${timestamp}] updateSubagentStatus called for ${runId} with status: ${status}, summary argument:`,
      summary
    );

    try {
      // Read current metadata
      const metadataContent = await fs.readFile(metadataFile, "utf-8");
      const metadata = JSON.parse(metadataContent);

      // Update metadata with new status and summary
      const updatedMetadata = {
        ...metadata,
        status,
        summary: summary !== undefined ? summary : metadata.summary,
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
        await fs.appendFile(
          logFile,
          `[${timestamp}] Status updated to: ${status}\n`
        );
        if (summary) {
          await fs.appendFile(logFile, `[${timestamp}] Summary: ${summary}\n`);
        }
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
