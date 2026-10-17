// SPDX-License-Identifier: Apache-2.0
// Sonde VNC de bout en bout via l'outil MCP `aphrody_remote_vnc` (client RFB natif), serveur MCP en stdio.
// Usage : bun scripts/tools/infra/vnc-probe.ts <cible>... [--out dir] [--act] [--wait [secondes]] [--json]
//   <cible>  membre du tunnel (omar, vps, dbfr, aphro-pc), host[:port] ou vnc://host:port
//   --act    ajoute déplacement, clic, saisie, défilement, glisser et raccourci (bureau neutre uniquement)
//   --wait   réessaie la capture toutes les 60 s (défaut 6 h) jusqu'au premier succès ; code 0 dès qu'elle passe
// Les mots de passe viennent du magasin d'identifiants (aphrody infra remote token), jamais d'un argument.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Step = {
  target: string;
  action: string;
  ok: boolean;
  detail: string;
  ms: number;
};

const argv = Bun.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const opt = (name: string) => {
  const i = argv.indexOf(name);
  const v = i >= 0 ? argv[i + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
};
const valueIndexes = new Set(
  ["--out", "--wait"].flatMap(n => {
    const i = argv.indexOf(n);
    return i >= 0 && argv[i + 1] && !argv[i + 1]!.startsWith("--") ? [i + 1] : [];
  }),
);
const targets = argv.filter((a, i) => !a.startsWith("--") && !valueIndexes.has(i));
const out = opt("--out") ?? join(process.env.TEMP ?? process.env.TMPDIR ?? "/tmp", "aphrody-vnc");
const act = flag("--act");
const wait = flag("--wait");
const waitSeconds = Number(opt("--wait") ?? 6 * 3600);
if (targets.length === 0) {
  console.error("usage: vnc-probe.ts <cible>... [--out dir] [--act] [--wait [s]] [--json]");
  process.exit(2);
}
mkdirSync(out, { recursive: true });

const bin =
  process.env.APHRODY_BIN ??
  (process.platform === "win32" ? `${process.env.LOCALAPPDATA}\\Aphrody\\bin\\aphrody.exe` : "aphrody");

class Mcp {
  private id = 0;
  private pending = new Map<number, (m: any) => void>();
  private proc = Bun.spawn([bin, "mcp-server"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  constructor() {
    void this.pump();
  }
  private async pump() {
    let buf = "";
    const dec = new TextDecoder();
    for await (const chunk of this.proc.stdout as any) {
      buf += dec.decode(chunk);
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        try {
          const m = JSON.parse(line);
          this.pending.get(m.id)?.(m);
        } catch {}
      }
    }
  }
  private send(o: object) {
    (this.proc.stdin as any).write(JSON.stringify(o) + "\n");
    (this.proc.stdin as any).flush();
  }
  request(method: string, params: object, timeoutMs = 60_000): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${method}: délai dépassé`)), timeoutMs);
      this.pending.set(id, m => {
        clearTimeout(t);
        resolve(m);
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }
  async init() {
    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vnc-probe", version: "1" },
    });
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }
  close() {
    this.proc.kill();
  }
}

async function call(mcp: Mcp, args: Record<string, unknown>, shot?: string): Promise<Step> {
  const t0 = performance.now();
  const target = String(args.target);
  const action = String(args.action);
  try {
    const m = await mcp.request("tools/call", {
      name: "aphrody_remote_vnc",
      arguments: args,
    });
    const r = m.result ?? {};
    const text = (r.content ?? []).find((c: any) => c.type === "text")?.text ?? m.error?.message ?? "";
    const img = (r.content ?? []).find((c: any) => c.type === "image");
    if (img && shot) writeFileSync(shot, Buffer.from(img.data, "base64"));
    return {
      target,
      action,
      ok: !r.isError && !m.error,
      detail: String(text).slice(0, 200),
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    return {
      target,
      action,
      ok: false,
      detail: String(e).slice(0, 200),
      ms: Math.round(performance.now() - t0),
    };
  }
}

const safe = (t: string) => t.replace(/[^a-z0-9]+/gi, "-");
const steps: Step[] = [];
const mcp = new Mcp();
await mcp.init();

for (const target of targets) {
  const base = join(out, safe(target));
  const s0 = await call(mcp, { target, action: "screenshot" }, `${base}-0.jpg`);
  if (wait && !s0.ok) {
    const deadline = Date.now() + waitSeconds * 1000;
    let ok = false;
    while (Date.now() < deadline && !ok) {
      await Bun.sleep(60_000);
      ok = (await call(mcp, { target, action: "screenshot" }, `${base}-0.jpg`)).ok;
    }
    steps.push({
      ...s0,
      ok,
      detail: ok ? "accès VNC validé après réessai" : "délai dépassé",
    });
    if (!ok) continue;
  } else steps.push(s0);
  if (!act || !(wait ? true : s0.ok)) continue;
  const plan: Record<string, unknown>[] = [
    { action: "move", x: 200, y: 200 },
    { action: "click", x: 200, y: 200 },
    { action: "double_click", x: 220, y: 220 },
    { action: "type", text: "aphrody-vnc-probe" },
    { action: "keypress", key: "ctrl+a" },
    { action: "keypress", key: "Enter" },
    { action: "scroll", delta_y: 3 },
    { action: "scroll", delta_y: -3 },
    { action: "drag", x: 300, y: 300, end_x: 500, end_y: 400 },
    { action: "click", x: 400, y: 400, button: "right" },
    { action: "keypress", key: "Escape" },
    { action: "wait", duration_ms: 500 },
  ];
  for (const p of plan) steps.push(await call(mcp, { target, ...p }));
  steps.push(await call(mcp, { target, action: "screenshot" }, `${base}-1.jpg`));
  await call(mcp, { target, action: "close" });
}
mcp.close();

if (flag("--json")) console.log(JSON.stringify(steps, null, 2));
else
  for (const s of steps)
    console.log(`${s.ok ? "ok  " : "FAIL"} ${s.target} ${s.action} (${s.ms} ms) ${s.ok ? "" : s.detail}`);
console.error(`captures : ${out}`);
process.exit(steps.every(s => s.ok) ? 0 : 1);
