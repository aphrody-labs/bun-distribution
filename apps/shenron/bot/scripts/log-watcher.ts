#!/usr/bin/env bun
/**
 * Log watcher — ouvre une issue GitHub automatiquement quand le bot log une
 * erreur de prod (ERROR, Unhandled rejection, unhandledPromiseRejection).
 *
 * Déduplication : chaque erreur est hashée (type + message + 1re frame stack).
 * Un hash déjà vu dans une issue ouverte → commentaire (count++ + dernier timestamp).
 * Un hash connu sur issue fermée → skip (ne rouvre pas — l'humain a jugé).
 *
 * Usage :
 *   bun scripts/log-watcher.ts                      # stdin (pipe journalctl -f ou tail -F)
 *   bun scripts/log-watcher.ts logs/shenron.log     # tail -F d'un fichier
 *   bun scripts/log-watcher.ts --systemd shenron    # follow le journald unit
 *
 * Env requises :
 *   GITHUB_TOKEN          PAT ou GITHUB_TOKEN CI avec scope `repo`
 *   GITHUB_REPOSITORY     "owner/repo" (défaut : aphrody-code/shenron)
 *
 * Options :
 *   --dry-run             logge sans créer/commenter sur GitHub
 *   --min-severity error  filtre (error|warn) — défaut : error
 */

import { parseArgs } from "node:util";
import { createHash } from "node:crypto";

const { values: opts, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		systemd: { type: "string" },
		"dry-run": { type: "boolean", default: false },
		"min-severity": { type: "string", default: "error" },
		help: { type: "boolean", short: "h" },
	},
	allowPositionals: true,
});

if (opts.help) {
	console.log(`Usage: bun scripts/log-watcher.ts [FILE | --systemd UNIT] [options]

  FILE                 Fichier à suivre (tail -F)
  --systemd <unit>     Follow journalctl -fu <unit>
  (sinon)              Lit stdin (ex: pipe depuis une autre commande)

  --dry-run            N'ouvre pas d'issue, affiche ce qui serait fait
  --min-severity X     error (défaut) ou warn
  -h, --help           Aide`);
	process.exit(0);
}

const REPO = Bun.env.GITHUB_REPOSITORY ?? "aphrody-code/shenron";
const TOKEN = Bun.env.GITHUB_TOKEN;
const DRY = opts["dry-run"];

if (!DRY && !TOKEN) {
	console.error("✗ GITHUB_TOKEN manquant. Exporte-le ou utilise --dry-run.");
	process.exit(1);
}

// ── Extracteur de stream ────────────────────────────────────────────────
async function* streamLines(): AsyncGenerator<string> {
	if (opts.systemd) {
		const proc = Bun.spawn(["journalctl", "-fu", opts.systemd, "-o", "short-iso"], {
			stdout: "pipe",
		});
		const reader = proc.stdout.getReader();
		const dec = new TextDecoder();
		let buf = "";
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += dec.decode(value, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const l of lines) yield l;
		}
	} else if (positionals.length > 0) {
		const proc = Bun.spawn(["tail", "-F", "-n", "0", positionals[0]!], {
			stdout: "pipe",
		});
		const reader = proc.stdout.getReader();
		const dec = new TextDecoder();
		let buf = "";
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += dec.decode(value, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const l of lines) yield l;
		}
	} else {
		// stdin
		const dec = new TextDecoder();
		let buf = "";
		for await (const chunk of Bun.stdin.stream()) {
			buf += dec.decode(chunk, { stream: true });
			const lines = buf.split("\n");
			buf = lines.pop() ?? "";
			for (const l of lines) yield l;
		}
	}
}

// ── Détection d'erreur (pino JSON + plain text) ─────────────────────────
interface DetectedError {
	severity: "error" | "warn";
	message: string;
	type?: string;
	stackHead?: string; // 1re frame significative
	rawLine: string;
	timestamp: string;
}

function detect(line: string): DetectedError | null {
	const trim = line.trim();
	if (!trim) return null;

	// Pino JSON : {"level":50,"time":..., "msg":"...", "err":{...}}
	if (trim.startsWith("{") && trim.endsWith("}")) {
		try {
			const j = JSON.parse(trim);
			const lvl = typeof j.level === "number" ? j.level : 0;
			if (lvl < 40) return null; // < warn
			const severity = lvl >= 50 ? "error" : "warn";
			if (opts["min-severity"] === "error" && severity !== "error") return null;
			const err = j.err ?? {};
			return {
				severity,
				message: err.message ?? j.msg ?? "(no message)",
				type: err.type ?? err.name,
				stackHead: typeof err.stack === "string" ? extractStackHead(err.stack) : undefined,
				rawLine: trim,
				timestamp: new Date(j.time ?? Date.now()).toISOString(),
			};
		} catch {
			/* not JSON — tombe au texte */
		}
	}

	// Texte pino-pretty : "[HH:MM:SS.mmm] ERROR: message"
	const pretty = trim.match(/\b(ERROR|FATAL|WARN(?:ING)?)\b[:\s]+(.*)/);
	if (pretty) {
		const sev = pretty[1]!.startsWith("W") ? "warn" : "error";
		if (opts["min-severity"] === "error" && sev !== "error") return null;
		return {
			severity: sev,
			message: (pretty[2] ?? "").slice(0, 300),
			rawLine: trim,
			timestamp: new Date().toISOString(),
		};
	}

	// Unhandled rejection / TypeError / etc. en brut
	if (/Unhandled (?:promise )?[Rr]ejection|TypeError|ReferenceError|SyntaxError/.test(trim)) {
		return {
			severity: "error",
			message: trim.slice(0, 300),
			rawLine: trim,
			timestamp: new Date().toISOString(),
		};
	}

	return null;
}

function extractStackHead(stack: string): string {
	const lines = stack.split("\n");
	for (const l of lines) {
		const m = l.match(/\b(at\s+[^(]+\([^)]+\))|(\/[^\s]+:\d+:\d+)/);
		if (m) return m[0].trim();
	}
	return lines[1]?.trim() ?? "";
}

function fingerprint(e: DetectedError): string {
	const key = `${e.type ?? ""}|${normalizeMsg(e.message)}|${e.stackHead ?? ""}`;
	return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function normalizeMsg(s: string): string {
	// Enlève les IDs Discord, timestamps, et nombres pour augmenter le match
	return s
		.replace(/\b\d{17,20}\b/g, "<snowflake>")
		.replace(/\b\d{10,}\b/g, "<ts>")
		.replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
		.replace(/\b[a-f0-9]{8,}\b/g, "<hash>")
		.trim()
		.slice(0, 200);
}

// ── GitHub API (via gh CLI préféré, fallback fetch) ─────────────────────
async function gh<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`https://api.github.com${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			Accept: "application/vnd.github+json",
			"X-GitHub-Api-Version": "2022-11-28",
			...init.headers,
		},
	});
	if (!res.ok) throw new Error(`GH ${path} → ${res.status}: ${await res.text()}`);
	return res.json() as Promise<T>;
}

interface Issue {
	number: number;
	state: "open" | "closed";
	title: string;
	body?: string;
	html_url: string;
}

async function findIssueByFingerprint(fp: string): Promise<Issue | null> {
	// Recherche dans les issues du repo, ouvertes ou fermées
	const q = encodeURIComponent(`repo:${REPO} in:body "fingerprint: ${fp}"`);
	const res = await gh<{ items: Issue[] }>(`/search/issues?q=${q}`);
	return res.items[0] ?? null;
}

async function createIssue(e: DetectedError, fp: string): Promise<Issue> {
	const title = `[auto] ${truncate(e.message.split("\n")[0] ?? e.message, 120)}`;
	const body = `> 🤖 Issue ouverte automatiquement par \`scripts/log-watcher.ts\`.

**Severity** : \`${e.severity}\`
**Premier aperçu** : ${e.timestamp}
**Type** : \`${e.type ?? "—"}\`

## Message

\`\`\`
${e.message}
\`\`\`

${e.stackHead ? `## Stack\n\n\`\`\`\n${e.stackHead}\n\`\`\`\n` : ""}

## Log brut (1re occurrence)

<details><summary>voir</summary>

\`\`\`
${e.rawLine.slice(0, 3500)}
\`\`\`

</details>

---

<sub>fingerprint: ${fp}</sub>`;
	return gh<Issue>(`/repos/${REPO}/issues`, {
		method: "POST",
		body: JSON.stringify({ title, body, labels: ["bug", "auto-detected"] }),
	});
}

async function commentIssue(num: number, e: DetectedError, count: number): Promise<void> {
	const body = `🔁 Occurrence #${count} à ${e.timestamp}\n\n\`\`\`\n${e.rawLine.slice(0, 1500)}\n\`\`\``;
	await gh(`/repos/${REPO}/issues/${num}/comments`, {
		method: "POST",
		body: JSON.stringify({ body }),
	});
}

function truncate(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ── Main loop ───────────────────────────────────────────────────────────
const seen = new Map<string, { issue: number; count: number; lastAt: number }>();
const THROTTLE_MS = 60_000; // max 1 comment / minute par issue

console.log(
	`→ log-watcher actif${DRY ? " [dry-run]" : ""} · repo: ${REPO} · min-severity: ${opts["min-severity"]}`
);

for await (const line of streamLines()) {
	const err = detect(line);
	if (!err) continue;
	const fp = fingerprint(err);

	if (DRY) {
		console.log(`[dry] ${err.severity} · fp=${fp} · ${truncate(err.message, 80)}`);
		continue;
	}

	try {
		const local = seen.get(fp);
		if (local && Date.now() - local.lastAt < THROTTLE_MS) {
			local.count++;
			continue;
		}

		const existing = local
			? ({ number: local.issue, state: "open" } as Issue)
			: await findIssueByFingerprint(fp);

		if (existing && existing.state === "closed") {
			console.log(`[skip] fp=${fp} — issue #${existing.number} fermée`);
			seen.set(fp, {
				issue: existing.number,
				count: (local?.count ?? 0) + 1,
				lastAt: Date.now(),
			});
			continue;
		}

		if (existing) {
			const count = (local?.count ?? 1) + 1;
			await commentIssue(existing.number, err, count);
			seen.set(fp, { issue: existing.number, count, lastAt: Date.now() });
			console.log(`[comment] #${existing.number} · fp=${fp} · count=${count}`);
		} else {
			const issue = await createIssue(err, fp);
			seen.set(fp, { issue: issue.number, count: 1, lastAt: Date.now() });
			console.log(`[create] #${issue.number} · fp=${fp} · ${issue.html_url}`);
		}
	} catch (err) {
		console.error(`[error] GitHub API : ${err}`);
	}
}
