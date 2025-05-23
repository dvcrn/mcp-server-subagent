import { promises as fs } from "fs";
import { join } from "path";

// Get logs for a subagent run
export async function getSubagentLogs(
  runId: string,
  logDir: string
): Promise<string> {
  try {
    const logFile = join(logDir, `${runId}.log`);

    try {
      return await fs.readFile(logFile, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return `No logs found for run ID: ${runId}`;
      }
      throw error;
    }
  } catch (error) {
    console.error(`Error getting logs for run ${runId}:`, error);
    throw error;
  }
}
