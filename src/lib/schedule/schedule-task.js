import { exec } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export function triggerSystemNotification(title, message) {
  const escapedTitle = title.replace(/'/g, "''");
  const escapedMessage = message.replace(/'/g, "''");
  const psCommand = `(New-Object -ComObject Wscript.Shell).Popup('${escapedMessage}', 0, '${escapedTitle}', 64)`;
  
  exec(`powershell -Command "${psCommand}"`, (error) => {
    if (error) {
      console.error("[schedule] Failed to trigger notification:", error.message);
    }
  });
}

export async function registerSchedule({ cwd, profile = "default", frequency = "weekly" }) {
  const taskName = `ZerodhaStockUpdates_${profile}`;
  const scriptPath = path.resolve(cwd, "src", "cli.js");
  const nodePath = process.execPath;
  
  // Run command that triggers the report generation
  const actionCommand = `"${nodePath}" "${scriptPath}" report generate --period ${frequency} --include-pdf --profile ${profile} --notify`;
  
  let scheduleType = "weekly";
  let modifier = "";
  
  if (frequency === "weekly") {
    scheduleType = "weekly";
    modifier = "/d SAT"; // Every Saturday
  } else if (frequency === "biweekly") {
    scheduleType = "weekly";
    modifier = "/mo 2 /d SAT"; // Every 2 weeks on Saturday
  } else if (frequency === "monthly") {
    scheduleType = "monthly";
    modifier = "/mo FIRST /d SAT"; // First Saturday of the month
  }

  // Windows schtasks creation command
  const schtasksCmd = `schtasks /create /tn "${taskName}" /tr "${actionCommand}" /sc ${scheduleType} ${modifier} /st 09:00 /f`;

  try {
    const { stdout } = await execAsync(schtasksCmd);
    console.log(`[schedule] schtasks output: ${stdout.trim()}`);
    return {
      success: true,
      taskName,
      command: schtasksCmd,
    };
  } catch (error) {
    console.error(`[schedule] Failed to register task:`, error.message);
    throw new Error(`Failed to create Windows scheduled task: ${error.message}`);
  }
}
