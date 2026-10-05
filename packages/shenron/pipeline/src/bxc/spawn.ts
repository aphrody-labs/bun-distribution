import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export class BxcExecutionError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly command: string[]
  ) {
    super(message);
    this.name = "BxcExecutionError";
  }
}

export class BxcTimeoutError extends Error {
  constructor(message: string, public readonly command: string[]) {
    super(message);
    this.name = "BxcTimeoutError";
  }
}

/**
 * Résout le binaire bxc ou l'exécutable local / VPS.
 * Ordre de résolution :
 * 1. process.env.BXC_BIN
 * 2. ~/.local/bin/bxc (binaire standalone récent)
 * 3. ~/bxc/bin/bxc.mjs (source Bun directe)
 * 4. ~/.bun/bin/bxc
 * 5. /usr/local/bin/bxc (VPS Linux de prod)
 * 6. Chemins Windows de dev
 * 7. bxc sur le PATH
 */
export function resolveBxcPath(): string {
  if (process.env.BXC_BIN && existsSync(process.env.BXC_BIN)) {
    return process.env.BXC_BIN;
  }

  const home = homedir();
  const candidates = [
    join(process.cwd(), "..", "aphrody-web", "apps", "bxc", "bin", "bxc.mjs"),
    join(process.cwd(), "..", "..", "aphrody-web", "apps", "bxc", "bin", "bxc.mjs"),
    join(home, ".local", "bin", "bxc"),
    join(home, "bxc", "bin", "bxc.mjs"),
    join(home, ".bun", "bin", "bxc"),
    join(home, ".bun", "bin", "bxc.exe"),
    "/usr/local/bin/bxc",
  ];

  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }

  const aphrodyWeb = Bun.which("aphrody-web") || Bun.which("aphrody");
  if (aphrodyWeb) {
    return aphrodyWeb;
  }

  return "bxc";
}

/** Resolve the one canonical argv prefix used by scripts and the typed client. */
export function resolveBxcCommand(bxcPath?: string): string[] {
	const root =
		process.env.BXC_ROOT?.trim() ||
		process.env.BXC_DIR?.trim() ||
		resolve(import.meta.dir, "..", "..", "..", "..", "..", "aphrody-web", "apps", "bxc");
	const sourceEntry = join(root, "src", "cli", "index.ts");
	if (!bxcPath && existsSync(sourceEntry)) return [process.execPath, sourceEntry];

	const binary = bxcPath || resolveBxcPath();
	if (binary.endsWith("aphrody") || binary.endsWith("aphrody.exe")) return [binary, "web"];
	if (binary.endsWith(".mjs")) return [process.execPath, "run", binary];
	if (binary === "bxc" && !Bun.which(binary)) {
		const aphrodyWeb = Bun.which("aphrody-web") || Bun.which("aphrody");
		if (aphrodyWeb) {
			return aphrodyWeb.endsWith("aphrody") ? [aphrodyWeb, "web"] : [aphrodyWeb];
		}
		throw new Error("BXC is unavailable. Set BXC_BIN or BXC_DIR, or install bxc (or aphrody web).");
	}
	return [binary];
}

export interface ExecBxcOptions {
  bxcPath?: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

/**
 * Exécute le CLI bxc avec Bun.spawn natif, gestion stricte des timeouts, retries et buffering stdout/stderr.
 */
export async function execBxc(
  args: string[],
  options: ExecBxcOptions = {}
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 25000;
  const maxRetries = options.retries ?? 1;
  const retryDelayMs = options.retryDelayMs ?? 800;

  // Si c'est un script .mjs, on invoque bun run
  const command = [...resolveBxcCommand(options.bxcPath), ...args];

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      await Bun.sleep(retryDelayMs * Math.pow(2, attempt - 1));
    }

    try {
      // Bun fetch ne supporte pas le protocole socks5:// direct via HTTP_PROXY/HTTPS_PROXY.
      // Si une variable proxy socks5 est présente, on l'isole pour que le CLI bxc / fetch Bun ne plante pas avec UnsupportedProxyProtocol.
      const cleanEnv: Record<string, string | undefined> = {
        ...process.env,
        BXC_QUIET: "1",
        BXC_FROM_SOURCE: process.env.BXC_FROM_SOURCE ?? "1",
      };
      for (const k of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"]) {
        const val = cleanEnv[k];
        if (val && (val.startsWith("socks") || val.includes("socks5"))) {
          delete cleanEnv[k];
        }
      }

      const proc = Bun.spawn(command, {
        stdout: "pipe",
        stderr: "pipe",
        env: cleanEnv,
      });

      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          try {
            proc.kill(9);
          } catch {}
          reject(new BxcTimeoutError(`bxc execution timed out after ${timeoutMs}ms: ${command.join(" ")}`, command));
        }, timeoutMs);
      });

      const stdoutPromise = new Response(proc.stdout).text();
      const stderrPromise = new Response(proc.stderr).text();

      try {
        const [exitCode, stdout, stderr] = await Promise.race([
          Promise.all([proc.exited, stdoutPromise, stderrPromise]),
          timeoutPromise,
        ]);

        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (exitCode !== 0) {
          throw new BxcExecutionError(
            `bxc exited with code ${exitCode}: ${stderr.trim() || stdout.trim()}`,
            exitCode,
            stderr,
            command
          );
        }

        return stdout.trim();
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Si c'est un timeout ou une erreur 429 explicite, retenter si possible
      if (attempt >= maxRetries) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error("bxc execution failed unexpectedly");
}

/**
 * Exécute une commande bxc et parse le flux JSON en retour.
 */
export async function execBxcJson<T>(
  args: string[],
  options: ExecBxcOptions = {}
): Promise<T> {
  const finalArgs = args.includes("--json") ? args : [...args, "--json"];
  const raw = await execBxc(finalArgs, options);
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Failed to parse bxc JSON output: ${err instanceof Error ? err.message : String(err)}\nRaw output: ${raw.slice(0, 500)}`, { cause: err });
  }
}
