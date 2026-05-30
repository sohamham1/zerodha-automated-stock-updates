import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildMarkdownReport } from "./markdown.js";
import { writeJson } from "../utils.js";

function runPythonExport(config, reportJsonPath, outputDir, includePdf) {
  const pythonCommand = config.python?.executable || "python";
  const scriptPath = path.resolve(config.cwd, "tools", "export_report.py");

  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonCommand,
      [scriptPath, reportJsonPath, outputDir, includePdf ? "1" : "0"],
      {
        cwd: config.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Python export failed with code ${code}: ${stderr}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export async function exportReportArtifacts({ config, report, outputDir, includePdf }) {
  const reportJsonPath = path.join(outputDir, "report.json");
  const markdownPath = path.join(outputDir, "report.md");

  await writeJson(reportJsonPath, report);
  await writeFile(markdownPath, buildMarkdownReport(report), "utf8");
  await runPythonExport(config, reportJsonPath, outputDir, includePdf);

  return {
    reportJsonPath,
    markdownPath,
    outputDir,
  };
}
