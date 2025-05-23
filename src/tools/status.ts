import { promises as fs } from "fs";
import { join } from "path";
import { createWriteStream } from "fs";
import type { CommunicationMessage } from "./schemas.js";

export async function checkSubagentStatus(
  runId: string,
  logDir: string
): Promise<any> {
  try {
    const metadataFile = join(logDir, `${runId}.meta.json`);
    const logFile = join(logDir, `${runId}.log`);

    try {
      const metadataContent = await fs.readFile(metadataFile, "utf-8");
      const metadata = JSON.parse(metadataContent);

      // Enhanced status handling for bi-directional communication
      if (
        ["waiting_parent_reply", "parent_replied"].includes(metadata.status)
      ) {
        return {
          ...metadata,
          messages: metadata.messages ?? [],
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
    console.error(`Error checking status for run ${runId}:`, error);
    throw error;
  }
}

export async function updateSubagentStatus(
  runId: string,
  status: string,
  logDir: string,
  summary?: string
): Promise<any> {
  try {
    const metadataFile = join(logDir, `${runId}.meta.json`);
    const logFile = join(logDir, `${runId}.log`);
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
        console.error(`Error writing to log file for run ${runId}:`, error);
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
    console.error(`Error updating status for run ${runId}:`, error);
    throw error;
  }
}
