import { tempPath } from "@aphrody/paths";
import { fileURLToPath } from "node:url";

export interface WebsiteQaResult {
  success: boolean;
  reportDir?: string;
  report?: string;
  error?: string;
}

const repositoryRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const workflowScript = fileURLToPath(new URL("../../../../../scripts/qa/agent-browser-rg.sh", import.meta.url));

/** Read-only website crawl/render/API QA. External IE crawling remains disabled. */
export async function runWebsiteQa(): Promise<WebsiteQaResult> {
  const reportDir = Bun.env.RG_BROWSER_CRON_OUT_DIR ?? tempPath("rg-agent-browser");
  const child = Bun.spawn(["bash", workflowScript], {
    cwd: repositoryRoot,
    env: {
      ...Bun.env,
      RG_BROWSER_MODE: "once",
      RG_BROWSER_OUT_DIR: reportDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const report = stdout.match(/^RG_BROWSER_REPORT=(.+)$/m)?.[1];
  if (exitCode !== 0) {
    return {
      success: false,
      reportDir,
      report,
      error: stderr.trim() || `agent-browser QA exit ${exitCode}`,
    };
  }
  return { success: true, reportDir, report };
}
