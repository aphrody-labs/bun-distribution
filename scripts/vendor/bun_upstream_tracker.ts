/**
 * Bun Upstream Intelligence Engine: PR & Issue Optimization Tracker
 *
 * Analyzes oven-sh/bun upstream pull requests and issues to discover:
 * - High-impact performance optimizations (SIMD, allocator, fast paths, GC)
 * - Critical memory leak & segmentation fault fixes
 * - Aphrody agent synergies (FFI, WebSockets, SQLite, streams)
 * - Upstream regressions to prevent in our fork
 *
 * Generates structured reports and cherry-pick recommendations in memory/BUN_UPSTREAM_TRACKER.md.
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface GitHubItem {
  readonly number: number;
  readonly title: string;
  readonly html_url: string;
  readonly state: string;
  readonly user?: { login: string };
  readonly labels?: readonly { name: string }[];
  readonly merged_at?: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly body?: string;
}

export type OptimizationCategory =
  | "SIMD & Low-Level Perf"
  | "Memory & Garbage Collection"
  | "FFI & Native Interop"
  | "Network & Streams"
  | "Bundler & Transpiler"
  | "Stability & Crash Fix"
  | "General Enhancement";

export interface TrackedOptimization {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly type: "PR" | "Issue";
  readonly state: "merged" | "open" | "closed";
  readonly category: OptimizationCategory;
  readonly impact: "CRITICAL" | "HIGH" | "MEDIUM";
  readonly recommendation: string;
  readonly author: string;
  readonly date: string;
}

export class BunUpstreamTrackerEngine {
  private readonly upstreamRepo: string = "oven-sh/bun";
  private readonly outputPath: string;

  public constructor(
    outputPath: string = resolve(import.meta.dir, "../../docs/BUN_UPSTREAM_TRACKER.md"),
  ) {
    this.outputPath = outputPath;
  }

  /**
   * Executes a GitHub CLI API command.
   */
  private async fetchGitHubApi(endpoint: string): Promise<GitHubItem[]> {
    return new Promise((res) => {
      const proc = spawn("gh", ["api", endpoint, "--paginate=false"], {
        env: { ...process.env, PAGER: "cat" },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          console.warn(`[GitHub API Warning] ${endpoint}: ${stderr.trim()}`);
          res([]);
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          if (Array.isArray(parsed)) {
            res(parsed as GitHubItem[]);
          } else if (parsed && Array.isArray(parsed.items)) {
            res(parsed.items as GitHubItem[]);
          } else {
            res([]);
          }
        } catch {
          res([]);
        }
      });
    });
  }

  /**
   * Categorizes an item based on its title and body keywords.
   */
  private categorizeItem(
    title: string,
    body: string = "",
  ): {
    category: OptimizationCategory;
    impact: "CRITICAL" | "HIGH" | "MEDIUM";
    recommendation: string;
  } {
    const text = `${title} ${body}`.toLowerCase();

    if (
      text.includes("segfault") ||
      text.includes("crash") ||
      text.includes("use-after-free") ||
      text.includes("panic") ||
      text.includes("deadlock")
    ) {
      return {
        category: "Stability & Crash Fix",
        impact: "CRITICAL",
        recommendation: "Proactively adopt or cherry-pick to prevent runtime agent thread crash.",
      };
    }

    if (
      text.includes("simd") ||
      text.includes("avx") ||
      text.includes("neon") ||
      text.includes("vectorize")
    ) {
      return {
        category: "SIMD & Low-Level Perf",
        impact: "HIGH",
        recommendation: "Benchmark and cherry-pick for hardware-accelerated agent pipelines.",
      };
    }

    if (
      text.includes("memory leak") ||
      text.includes("mimalloc") ||
      text.includes("garbage collection") ||
      text.includes("gc heap") ||
      text.includes("alloc")
    ) {
      return {
        category: "Memory & Garbage Collection",
        impact: "HIGH",
        recommendation:
          "Integrate to optimize long-running 24/7 background agent memory footprint.",
      };
    }

    if (
      text.includes("ffi") ||
      text.includes("napi") ||
      text.includes("n-api") ||
      text.includes("c_api") ||
      text.includes("dlopen")
    ) {
      return {
        category: "FFI & Native Interop",
        impact: "HIGH",
        recommendation:
          "High synergy with Aphrody Rust engine and Obscura headless browser bridges.",
      };
    }

    if (
      text.includes("fetch") ||
      text.includes("http") ||
      text.includes("websocket") ||
      text.includes("tls") ||
      text.includes("stream") ||
      text.includes("zlib") ||
      text.includes("deflate")
    ) {
      return {
        category: "Network & Streams",
        impact: "HIGH",
        recommendation: "Optimizes CDP WebSocket streaming and LLM API response throughput.",
      };
    }

    if (
      text.includes("transpiler") ||
      text.includes("bundle") ||
      text.includes("sourcemap") ||
      text.includes("oxc")
    ) {
      return {
        category: "Bundler & Transpiler",
        impact: "MEDIUM",
        recommendation: "Fast cold-start and bundle speedups for dynamically evaluated agent code.",
      };
    }

    return {
      category: "General Enhancement",
      impact: "MEDIUM",
      recommendation: "Evaluate during standard upstream auto-sync cycles.",
    };
  }

  /**
   * Fetches and analyzes recent PRs and issues.
   */
  public async trackUpstream(): Promise<TrackedOptimization[]> {
    console.log(`[Tracker] Querying ${this.upstreamRepo} for optimization PRs and issues...`);

    // Query 1: Recent merged PRs
    const mergedPulls = await this.fetchGitHubApi(
      `repos/${this.upstreamRepo}/pulls?state=closed&sort=updated&direction=desc&per_page=30`,
    );

    // Query 2: Open PRs sorted by recently updated
    const openPulls = await this.fetchGitHubApi(
      `repos/${this.upstreamRepo}/pulls?state=open&sort=updated&direction=desc&per_page=20`,
    );

    // Query 3: Issues labeled with performance, memory, or crash
    const perfIssues = await this.fetchGitHubApi(
      `repos/${this.upstreamRepo}/issues?state=open&labels=performance&per_page=15`,
    );

    const tracked: TrackedOptimization[] = [];
    const seenNumbers = new Set<number>();

    // Process merged PRs
    for (const pr of mergedPulls) {
      if (!pr.merged_at || seenNumbers.has(pr.number)) continue;
      seenNumbers.add(pr.number);

      const { category, impact, recommendation } = this.categorizeItem(pr.title, pr.body || "");
      tracked.push({
        number: pr.number,
        title: pr.title,
        url: pr.html_url,
        type: "PR",
        state: "merged",
        category,
        impact,
        recommendation,
        author: pr.user?.login || "upstream",
        date: pr.merged_at.split("T")[0] || "",
      });
    }

    // Process open PRs
    for (const pr of openPulls) {
      if (seenNumbers.has(pr.number)) continue;
      seenNumbers.add(pr.number);

      const { category, impact, recommendation } = this.categorizeItem(pr.title, pr.body || "");
      if (impact === "HIGH" || impact === "CRITICAL") {
        tracked.push({
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          type: "PR",
          state: "open",
          category,
          impact,
          recommendation,
          author: pr.user?.login || "upstream",
          date: pr.created_at.split("T")[0] || "",
        });
      }
    }

    // Process performance issues
    for (const issue of perfIssues) {
      if (seenNumbers.has(issue.number) || issue.html_url.includes("/pull/")) continue;
      seenNumbers.add(issue.number);

      const { category, impact, recommendation } = this.categorizeItem(
        issue.title,
        issue.body || "",
      );
      tracked.push({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        type: "Issue",
        state: "open",
        category,
        impact,
        recommendation: `Track upstream regression or bottleneck: ${recommendation}`,
        author: issue.user?.login || "upstream",
        date: issue.created_at.split("T")[0] || "",
      });
    }

    return tracked;
  }

  /**
   * Generates comprehensive markdown report.
   */
  public generateReport(items: readonly TrackedOptimization[]): string {
    const criticalItems = items.filter((i) => i.impact === "CRITICAL");
    const highItems = items.filter((i) => i.impact === "HIGH");
    const mediumItems = items.filter((i) => i.impact === "MEDIUM");

    let md = `# Bun Upstream Optimization & Intelligence Tracker\n\n`;
    md += `> **Source**: [oven-sh/bun](https://github.com/oven-sh/bun)  \n`;
    md += `> **Target Fork**: [aphrody-labs/bun](https://github.com/aphrody-labs/bun) (Branch: \`yolo\`)  \n`;
    md += `> **Updated**: ${new Date().toISOString()}  \n`;
    md += `> **Engine**: \`scripts/vendor/bun_upstream_tracker.ts\`\n\n`;

    md += `## 1. Executive Summary & Optimization Strategy\n\n`;
    md += `This intelligence dashboard monitors upstream Bun pull requests and performance issues to optimize **Aphrody Bun Fork** for high-throughput AI agent execution, memory efficiency, and native FFI bridging.\n\n`;
    md += `- **Critical Stability / Crash Fixes Identified**: ${criticalItems.length}\n`;
    md += `- **High-Impact Performance & FFI Optimizations**: ${highItems.length}\n`;
    md += `- **Total Tracked Items**: ${items.length}\n\n`;

    md += `## 2. Priority Cherry-Pick & Backport Candidates\n\n`;
    md += `| PR / Issue | Title | Category | Impact | State | Actionable Recommendation |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- | :--- |\n`;

    for (const item of [...criticalItems, ...highItems]) {
      const stateBadge = item.state === "merged" ? "`MERGED`" : "`OPEN`";
      const impactBadge = item.impact === "CRITICAL" ? "**CRITICAL**" : "*HIGH*";
      md += `| [#${item.number}](${item.url}) | ${item.title.replace(/\|/g, "/")} | ${item.category} | ${impactBadge} | ${stateBadge} | ${item.recommendation} |\n`;
    }

    md += `\n## 3. General Optimizations & Transpiler Improvements\n\n`;
    md += `| PR / Issue | Title | Category | State | Actionable Recommendation |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;

    for (const item of mediumItems) {
      const stateBadge = item.state === "merged" ? "`MERGED`" : "`OPEN`";
      md += `| [#${item.number}](${item.url}) | ${item.title.replace(/\|/g, "/")} | ${item.category} | ${stateBadge} | ${item.recommendation} |\n`;
    }

    md += `\n## 4. How to Cherry-Pick to Aphrody Fork\n\n`;
    md += `To cherry-pick a specific upstream optimization commit into the Aphrody fork:\n\n`;
    md += `\`\`\`bash\n`;
    md += `# 1. Fetch latest upstream\n`;
    md += `git -C vendor/bun fetch upstream\n\n`;
    md += `# 2. Switch to yolo branch\n`;
    md += `git -C vendor/bun checkout yolo\n\n`;
    md += `# 3. Cherry pick the commit (example for PR #33711)\n`;
    md += `git -C vendor/bun cherry-pick <commit-sha>\n\n`;
    md += `# 4. Verify test suite and push\n`;
    md += `bun x tsc --noEmit -p vendor/bun/packages/bun-types\n`;
    md += `git -C vendor/bun push origin yolo\n`;
    md += `\`\`\`\n`;

    return md;
  }

  /**
   * Runs tracking and writes report.
   */
  public async execute(): Promise<void> {
    const items = await this.trackUpstream();
    const report = this.generateReport(items);
    writeFileSync(this.outputPath, report, "utf8");
    console.log(`[Tracker] Report successfully written to ${this.outputPath}`);
    console.log(`[Tracker] Analyzed ${items.length} upstream items.`);
  }
}

// CLI execution
if (import.meta.main) {
  const tracker = new BunUpstreamTrackerEngine();
  tracker
    .execute()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error("Fatal error during upstream tracking:", err);
      process.exit(1);
    });
}
