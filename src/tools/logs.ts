import { promises as fs } from "fs";
import { join } from "path";
import { LOG_DIR } from "../index.js"; // Assuming LOG_DIR will be exported from index.ts

// Get logs for a subagent run
export async function getSubagentLogs(
  name: string,
  runId: string
): Promise<string> {
  try {
    const logFile = join(LOG_DIR, `${name}-${runId}.log`);

    try {
      return await fs.readFile(logFile, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return `No logs found for run ID: ${runId}`;
      }
      throw error;
    }
  } catch (error) {
    console.error(`Error getting logs for ${name} run ${runId}:`, error);
    throw error;
  }
}
