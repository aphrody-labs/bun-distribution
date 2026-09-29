// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import type {
  ClickOptions,
  CommandResponse,
  LaunchOptions,
  PdfOptions,
  RefEntry,
  ScreenshotOptions,
  SnapshotResult,
} from "./types.ts";

export const DEFAULT_OBSCURA_CDP_URL = "ws://127.0.0.1:9222/devtools/browser";
const OWN_LAUNCHER = realpathSync(join(import.meta.dir, "../bin/agent-browser.js"));

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
}

function isMetaCommand(args: readonly string[]): boolean {
  return args.some((arg) => arg === "--help" || arg === "-h" || arg === "--version") ||
    ["skills", "install", "doctor", "upgrade", "help", "version"].includes(args[0] ?? "");
}

/** Resolve the installed native Rust CLI, never this package's Bun launcher. */
export function resolveAgentBrowserBinary(): string {
  const override = process.env.APHRODY_AGENT_BROWSER_BIN ??
    process.env.AGENT_BROWSER_BIN ??
    process.env.APHRODY_BROWSER_BIN;
  if (override) {
    const path = existsSync(override) ? override : Bun.which(override);
    if (!path) throw new Error(`agent-browser binary override is unavailable: ${override}`);
    const binary = realpathSync(resolve(path));
    if (binary === OWN_LAUNCHER) throw new Error("agent-browser binary override points to this Bun launcher");
    return binary;
  }

  const ext = process.platform === "win32" ? ".exe" : "";
  const root = join(import.meta.dir, "../../../..");
  const names = [`aphrody-agent-browser${ext}`, `agent-browser${ext}`];
  for (const profile of ["release", "debug"]) {
    for (const name of names) {
      const candidate = join(root, "target", profile, name);
      if (existsSync(candidate)) return realpathSync(candidate);
    }
  }

  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const installed = join(dir, `agent-browser${ext}`);
    if (!existsSync(installed)) continue;
    const binary = realpathSync(installed);
    if (binary !== OWN_LAUNCHER) return binary;
  }
  throw new Error("native agent-browser Rust CLI is unavailable; install it or set APHRODY_AGENT_BROWSER_BIN");
}

/** Build CLI arguments for the externally owned Obscura CDP server. */
export function prepareAgentBrowserArgs(
  args: readonly string[],
  options: LaunchOptions = {},
  json = true,
): string[] {
  const finalArgs = [...args];
  if (options.session && !hasFlag(finalArgs, "--session")) {
    finalArgs.push("--session", options.session);
  }

  if (!isMetaCommand(finalArgs) && !hasFlag(finalArgs, "--cdp")) {
    const cdpUrl = options.cdpUrl ??
      (options.port ? `ws://127.0.0.1:${options.port}/devtools/browser` : undefined) ??
      process.env.APHRODY_BROWSER_CDP_URL ??
      process.env.APHRODY_CDP_URL ??
      DEFAULT_OBSCURA_CDP_URL;
    finalArgs.push("--cdp", cdpUrl);
  }
  if (options.headless === false && !hasFlag(finalArgs, "--headed")) {
    finalArgs.push("--headed");
  }
  if (options.executablePath && !hasFlag(finalArgs, "--executable-path")) {
    finalArgs.push("--executable-path", options.executablePath);
  }
  if (options.proxy && !hasFlag(finalArgs, "--proxy")) {
    finalArgs.push("--proxy", options.proxy);
  }
  if (options.userDataDir && !hasFlag(finalArgs, "--profile")) {
    finalArgs.push("--profile", options.userDataDir);
  }
  if (options.hideScrollbars !== undefined && !hasFlag(finalArgs, "--hide-scrollbars")) {
    finalArgs.push("--hide-scrollbars", String(options.hideScrollbars));
  }
  if (json && !hasFlag(finalArgs, "--json")) finalArgs.push("--json");
  return finalArgs;
}

function parseResponse(stdout: string, stderr: string, status: number): CommandResponse {
  const output = stdout.trim();
  for (const line of output.split("\n").toReversed()) {
    const value = line.trim();
    if (!value.startsWith("{") || !value.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const success = typeof parsed.success === "boolean" ? parsed.success : status === 0;
      return {
        id: typeof parsed.id === "string" ? parsed.id : "",
        success,
        data: parsed.data ?? parsed,
        error: typeof parsed.error === "string" ? parsed.error :
          (success ? undefined : stderr.trim() || `agent-browser exited ${status}`),
      };
    } catch {
      // A diagnostic line can look like JSON; inspect the preceding lines.
    }
  }
  return {
    id: "",
    success: status === 0,
    data: output,
    error: status === 0 ? undefined : stderr.trim() || `agent-browser exited ${status}`,
  };
}

// Public compatibility surface intentionally groups the static browser commands.
// oxlint-disable-next-line typescript/no-extraneous-class
export class AgentBrowser {
  static async open(url?: string, options: LaunchOptions = {}): Promise<AgentPage> {
    const session = options.session ?? `sess-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const page = new AgentPage(session, options);
    if (url) await page.goto(url);
    else await page.open();
    return page;
  }

  /** Compatibility path for callers requiring a synchronous command result. */
  static exec(args: string[], options: LaunchOptions = {}): CommandResponse {
    try {
      const binary = resolveAgentBrowserBinary();
      const result = spawnSync(binary, prepareAgentBrowserArgs(args, options), {
        encoding: "utf8",
        timeout: options.timeoutMs ?? 30_000,
        windowsHide: true,
      });
      if (result.error) return { id: "", success: false, error: result.error.message };
      return parseResponse(result.stdout ?? "", result.stderr ?? "", result.status ?? 1);
    } catch (error) {
      return { id: "", success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Browser actions use this path so a Rust CDP command cannot freeze Bun. */
  static async execAsync(args: string[], options: LaunchOptions = {}): Promise<CommandResponse> {
    try {
      const binary = resolveAgentBrowserBinary();
      const proc = Bun.spawn([binary, ...prepareAgentBrowserArgs(args, options)], {
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      });
      const timeoutMs = options.timeoutMs ?? 30_000;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeoutMs);
      try {
        const [stdout, stderr, status] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        if (timedOut) return { id: "", success: false, error: `agent-browser timed out after ${timeoutMs} ms` };
        return parseResponse(stdout, stderr, status);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      return { id: "", success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}

export class AgentPage {
	readonly session: string;
	readonly options: LaunchOptions;
	private currentUrl = "about:blank";

	constructor(session: string, options: LaunchOptions = {}) {
		this.session = session;
		this.options = { ...options, session };
	}

	url(): string {
		return this.currentUrl;
	}

	async open(): Promise<void> {
		const res = await AgentBrowser.execAsync(["open"], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser open failed: ${res.error}`);
		}
	}

	async goto(url: string): Promise<void> {
		this.currentUrl = url;
		const res = await AgentBrowser.execAsync(["open", url], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser goto "${url}" failed: ${res.error}`);
		}
	}

	async snapshot(): Promise<SnapshotResult> {
		const res = await AgentBrowser.execAsync(["snapshot"], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser snapshot failed: ${res.error}`);
		}

		const raw = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
		const refs = new Map<string, RefEntry>();

		// Parse @e1, @e2 references from the snapshot output
		const refRegex = /\[ref=(@e\d+)\]/g;
		const lineRegex = /^(\s*[-*]?\s*)(\w+)?\s*(?:"([^"]*)")?\s*.*\[ref=(@e\d+)\]/gm;

		let match: RegExpExecArray | null;
		while ((match = lineRegex.exec(raw)) !== null) {
			const role = match[2] || "element";
			const name = match[3] || "";
			const ref = match[4];
			refs.set(ref, { ref, role, name });
		}

		// Fallback for simple refs
		if (refs.size === 0) {
			let simpleMatch: RegExpExecArray | null;
			while ((simpleMatch = refRegex.exec(raw)) !== null) {
				const ref = simpleMatch[1];
				if (!refs.has(ref)) {
					refs.set(ref, { ref, role: "element", name: "" });
				}
			}
		}

		return {
			raw,
			refs,
			url: this.currentUrl,
		};
	}

	async click(target: string, opts?: ClickOptions): Promise<void> {
		const args = ["click", target];
		if (opts?.button) args.push("--button", opts.button);
		if (opts?.clickCount) args.push("--click-count", String(opts.clickCount));
		const res = await AgentBrowser.execAsync(args, this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser click "${target}" failed: ${res.error}`);
		}
	}

	async fill(target: string, text: string): Promise<void> {
		const res = await AgentBrowser.execAsync(["fill", target, text], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser fill "${target}" failed: ${res.error}`);
		}
	}

	async type(target: string, text: string): Promise<void> {
		const res = await AgentBrowser.execAsync(["type", target, text], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser type "${target}" failed: ${res.error}`);
		}
	}

	async press(key: string): Promise<void> {
		const res = await AgentBrowser.execAsync(["press", key], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser press "${key}" failed: ${res.error}`);
		}
	}

	async hover(target: string): Promise<void> {
		const res = await AgentBrowser.execAsync(["hover", target], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser hover "${target}" failed: ${res.error}`);
		}
	}

	async select(target: string, value: string): Promise<void> {
		const res = await AgentBrowser.execAsync(["select", target, value], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser select "${target}" failed: ${res.error}`);
		}
	}

	async screenshot(path?: string, opts?: ScreenshotOptions): Promise<string> {
		const args = ["screenshot"];
		if (path) args.push(path);
		if (opts?.fullPage) args.push("--full-page");
		const res = await AgentBrowser.execAsync(args, this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser screenshot failed: ${res.error}`);
		}
		return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
	}

	async pdf(path?: string, opts?: PdfOptions): Promise<string> {
		const args = ["pdf"];
		if (path) args.push(path);
		if (opts?.landscape) args.push("--landscape");
		const res = await AgentBrowser.execAsync(args, this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser pdf failed: ${res.error}`);
		}
		return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
	}

	async getText(target: string): Promise<string> {
		const res = await AgentBrowser.execAsync(["get", "text", target], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser get text "${target}" failed: ${res.error}`);
		}
		return typeof res.data === "string" ? res.data : String(res.data ?? "");
	}

	async getAttribute(target: string, name: string): Promise<string | null> {
		const res = await AgentBrowser.execAsync(["get", "attribute", target, name], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser get attribute "${target}" "${name}" failed: ${res.error}`);
		}
		return res.data !== undefined ? String(res.data) : null;
	}

	async evaluate<T = unknown>(script: string): Promise<T> {
		const res = await AgentBrowser.execAsync(["eval", script], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser eval failed: ${res.error}`);
		}
		return res.data as T;
	}

	async waitFor(selectorOrMs: string | number): Promise<void> {
		const arg = typeof selectorOrMs === "number" ? String(selectorOrMs) : selectorOrMs;
		const res = await AgentBrowser.execAsync(["wait", arg], this.options);
		if (!res.success && res.error) {
			throw new Error(`agent-browser wait failed: ${res.error}`);
		}
	}

	async close(): Promise<void> {
		const res = await AgentBrowser.execAsync(["close"], this.options);
		if (!res.success && res.error) {
			// Ignore errors on close
		}
	}
}
