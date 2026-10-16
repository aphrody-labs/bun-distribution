// SPDX-License-Identifier: Apache-2.0
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse } from "../../shared/args.ts";
import { assertOutsideRepo, buildAccessPack, type Tunnel } from "../access.ts";
import type { Command } from "./types.ts";
const pairs = (values: string[] | undefined): Record<string, string> =>
  Object.fromEntries(
    (values ?? []).map((entry) => {
      const at = entry.indexOf("=");
      if (at < 1) throw new Error(`« ${entry} » : forme hôte=valeur attendue`);
      return [entry.slice(0, at), entry.slice(at + 1)] as const;
    }),
  );

async function run(argv: string[]): Promise<number> {
  const { values } = parse(argv, {
    tunnel: { type: "string" },
    peer: { type: "string" },
    "wg-block": { type: "string" },
    "train-host": { type: "string" },
    "host-keys": { type: "string" },
    "repo-dir": { type: "string", multiple: true },
    "aphrody-bin": { type: "string", multiple: true },
    out: { type: "string" },
    help: { type: "boolean", short: "h" },
  });
  if (values.help || !values.out || !values.peer) {
    console.log(
      "usage : make-access.ts --tunnel <aphrody-tunnel.json> --peer omar --wg-block <fichier> --out <fichier hors dépôt> [--train-host <hôte>] [--host-keys <fichier>] [--repo-dir hôte=chemin] [--aphrody-bin hôte=chemin]",
    );
    return values.help ? 0 : 2;
  }
  const repoRoot = resolve(import.meta.dir, "../../../../../docs/aphrody");
  assertOutsideRepo(values.out, repoRoot);
  const tunnelFile = values.tunnel ?? join(repoRoot, "tools/config/host/wireguard/aphrody-tunnel.json");
  const tunnel = JSON.parse(await readFile(tunnelFile, "utf8")) as Tunnel;
  const hostKeys = values["host-keys"]
    ? (await readFile(values["host-keys"], "utf8"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"))
    : [];
  const pack = buildAccessPack(tunnel, {
    peer: values.peer,
    ...(values["wg-block"] ? { wgBlock: await readFile(values["wg-block"], "utf8") } : {}),
    ...(values["train-host"] ? { trainHost: values["train-host"] } : {}),
    hostKeys,
    repoDirs: pairs(values["repo-dir"]),
    aphrodyBins: pairs(values["aphrody-bin"]),
  });
  await mkdir(dirname(resolve(values.out)), { recursive: true });
  await writeFile(values.out, `${JSON.stringify(pack, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `écrit : ${values.out} (hôtes : ${Object.keys(pack.hosts).join(", ")}${pack.wireguard?.block ? ", tunnel WireGuard" : ", SANS tunnel WireGuard"}${pack.hostKeys.length > 0 ? `, ${pack.hostKeys.length} empreintes` : ", SANS empreintes d'hôtes (première connexion non vérifiée)"})`,
  );
  console.log(
    "À envoyer en privé à la personne (jamais dans le dépôt). Il ne contient aucune clé privée.",
  );
  return 0;
}

export default {
  name: "access-pack",
  summary: "Préparer un fichier d’accès privé pour un administrateur",
  run,
} satisfies Command;
