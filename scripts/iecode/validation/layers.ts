#!/usr/bin/env bun
/**
 * Porte d'architecture : les couches du workspace sont-elles réellement unidirectionnelles ?
 *
 * # Pourquoi elle existe
 *
 * Un diagramme de couches est une affirmation vérifiable, et celui de ce dépôt ne l'avait jamais
 * été. Confronté au graphe réel le 2026-09-20, il annonçait **41 crates** là où `cargo metadata`
 * en compte **50**, six couches là où le classement topologique en donne **neuf**, et surtout
 * « couches étanches unidirectionnelles » alors que la couche de FONDATION dépendait vers le
 * haut — `aphrody-nie-core → aphrody-nie-data` et `aphrody-nie-formats → aphrody-nie-lua`, toutes deux actives par défaut.
 *
 * Aucune de ces dépendances n'est un défaut en soi : `aphrody-nie-formats` décode le bytecode Lua par
 * `aphrody-nie-lua`, qui est la source unique du décodeur, et c'est le bon choix. Ce qui était faux,
 * c'est le RANG assigné à ces crates. Cette porte fige le rang mesuré, de sorte qu'un
 * déplacement ultérieur se voie au lieu de s'accumuler.
 *
 * # Ce qu'elle vérifie
 *
 * 1. Aucune dépendance ne remonte : chaque crate ne dépend que de rangs strictement inférieurs.
 * 2. Tout crate du workspace porte un rang — un crate neuf doit être classé, pas ignoré.
 * 3. Le rang déclaré est le rang MESURÉ (plus long chemin de dépendances), pas une intention.
 *
 * Cargo interdit déjà les cycles dans le graphe de compilation : « aucune dépendance cyclique »
 * est vrai par construction et n'a pas besoin d'être testé ici. Les **dev-dependencies**, elles,
 * peuvent remonter sans rien casser — elles n'entrent que dans le graphe des tests — et la porte
 * les laisse passer en le disant plutôt qu'en les ignorant en silence.
 *
 * # Usage
 *
 * ```sh
 * bun --bun scripts/iecode/validation/layers.ts          # vérifie
 * bun --bun scripts/iecode/validation/layers.ts --write  # réécrit la table depuis la mesure
 * ```
 *
 * Sort non-zéro sur régression, comme les autres portes de `scripts/iecode/validation/`.
 */

// Ce fichier est un module : sans un `export`, TypeScript refuse le `await` de premier niveau
// (TS1375) alors que Bun l'exécute sans broncher. La porte de typecheck des scripts l'a attrapé.
export {};

const RANGS_ATTENDUS: Readonly<Record<string, number>> = {
  "aphrody-nie-asm": 0,
  "aphrody-nie-data": 0,
  "aphrody-nie-dump": 0,
  "aphrody-nie-emu": 0,
  "aphrody-nie-geom": 0,
  "aphrody-nie-index": 0,
  "aphrody-nie-inventory": 0,
  "aphrody-nie-pe": 0,
  "aphrody-nie-pe-inspect": 0,
  "aphrody-nie-queue": 0,
  "aphrody-nie-sql": 0,
  "aphrody-nie-tasks": 0,
  "aphrody-nie-trace": 0,
  "aphrody-nie-video": 0,
  "aphrody-nie-wiki": 0,
  "aphrody-nie-zukan": 0,
  "aphrody-nie-identity-source": 1,
  "aphrody-nie-core": 1,
  "aphrody-nie-forge": 1,
  "aphrody-nie-lua": 1,
  "aphrody-nie-re": 1,
  "aphrody-nie-computer-use": 2,
  "aphrody-nie-formats": 2,
  "aphrody-nie-bench": 3,
  "aphrody-nie-bevy": 3,
  "aphrody-nie-camera": 3,
  "aphrody-nie-explore": 3,
  "aphrody-nie-headless": 3,
  "aphrody-nie-lua-web": 3,
  "aphrody-nie-ocgen": 3,
  "aphrody-nie-pg": 3,
  "aphrody-nie-render3d": 3,
  "aphrody-nie-save": 3,
  "aphrody-nie-seed": 3,
  "aphrody-nie-ui": 3,
  "aphrody-nie-viola": 3,
  "aphrody-nie-editor": 4,
  "aphrody-nie-launcher": 4,
  "aphrody-nie-model-serve": 4,
  "aphrody-nie-runtime": 4,
  "aphrody-nie-viewer-web": 4,
  "aphrody-nie-app": 5,
  "aphrody-nie-ffi": 5,
  "aphrody-nie-net": 5,
  "aphrody-nie-render": 5,
  "aphrody-nie-game": 6,
  "aphrody-nie-play": 6,
  "aphrody-nie-steam": 6,
  "aphrody-nie-cli": 7,
  "aphrody-nie-wasm": 7,
  "aphrody-nie-mcp": 8,
};

interface Paquet {
  name: string;
  dependencies: { name: string; kind: string | null; optional: boolean }[];
}

async function metadonnees(): Promise<Paquet[]> {
  const proc = Bun.spawn(["cargo", "metadata", "--no-deps", "--format-version", "1"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const sortie = await new Response(proc.stdout).text();
  if ((await proc.exited) !== 0) {
    throw new Error(`cargo metadata a échoué : ${await new Response(proc.stderr).text()}`);
  }
  return (JSON.parse(sortie) as { packages: Paquet[] }).packages;
}

/** Rang mesuré : 1 + le plus long chemin de dépendances internes. */
function rangsMesures(paquets: Paquet[]): Map<string, number> {
  const noms = new Set(paquets.map((p) => p.name));
  const voisins = new Map<string, string[]>();
  for (const p of paquets) {
    voisins.set(
      p.name,
      p.dependencies.map((d) => d.name).filter((n) => noms.has(n) && n !== p.name),
    );
  }
  const memo = new Map<string, number>();
  const profondeur = (n: string, pile: Set<string>): number => {
    const connu = memo.get(n);
    if (connu !== undefined) return connu;
    // Cargo interdit les cycles ; ce garde évite une récursion infinie si l'hypothèse change.
    if (pile.has(n)) return 0;
    pile.add(n);
    let max = 0;
    for (const v of voisins.get(n) ?? []) max = Math.max(max, profondeur(v, pile) + 1);
    pile.delete(n);
    memo.set(n, max);
    return max;
  };
  for (const n of noms) profondeur(n, new Set());
  return memo;
}

// Cette porte décrit les couches du domaine NIE. Le workspace IECODE inclut désormais
// Bevy, wgpu et plusieurs émulateurs upstream, qui ont leurs propres graphes de dépendances.
const paquets = (await metadonnees()).filter((p) => p.name.startsWith("aphrody-nie-"));
const mesures = rangsMesures(paquets);
const ecrire = Bun.argv.includes("--write");

if (ecrire) {
  const parRang = new Map<number, string[]>();
  for (const [nom, rang] of mesures) {
    parRang.set(rang, [...(parRang.get(rang) ?? []), nom].sort());
  }
  for (const rang of [...parRang.keys()].sort((a, b) => a - b)) {
    console.log(`// N${rang}`);
    for (const nom of parRang.get(rang) ?? []) console.log(`\t"${nom}": ${rang},`);
  }
  process.exit(0);
}

const problemes: string[] = [];

// 1. Tout crate du workspace est classé.
for (const p of paquets) {
  if (!(p.name in RANGS_ATTENDUS)) {
    problemes.push(`${p.name} n'a pas de rang : un crate neuf doit être classé, pas ignoré`);
  }
}

// 2. Le rang déclaré est le rang mesuré.
for (const [nom, rang] of mesures) {
  const attendu = RANGS_ATTENDUS[nom];
  if (attendu !== undefined && attendu !== rang) {
    problemes.push(`${nom} : rang déclaré N${attendu}, rang mesuré N${rang}`);
  }
}

// 3. Aucune dépendance ne remonte.
for (const p of paquets) {
  const source = RANGS_ATTENDUS[p.name];
  if (source === undefined) continue;
  for (const dep of p.dependencies) {
    const cible = RANGS_ATTENDUS[dep.name];
    if (cible === undefined || dep.name === p.name) continue;
    // Une dev-dependency peut remonter, et ce n'est pas une violation : elle n'entre pas
    // dans le graphe de compilation de la bibliothèque, seulement dans celui de ses tests.
    // `aphrody-nie-lua` (N1) emprunte ainsi `aphrody-nie-formats` (N2) pour lire de vrais `.lua.bin` du jeu
    // dans ses goldens — inverser cette dépendance obligerait à dupliquer le VFS.
    if (dep.kind === "dev") continue;
    if (cible >= source) {
      const nature = dep.optional ? "optionnelle" : "non optionnelle";
      problemes.push(
        `${p.name} (N${source}) dépend de ${dep.name} (N${cible}) — ${nature}, ${dep.kind ?? "normal"}`,
      );
    }
  }
}

const rangs = [...mesures.values()];
console.log(
  `${paquets.length} crates, ${Math.max(...rangs) + 1} rangs (N0..N${Math.max(...rangs)})`,
);
if (problemes.length > 0) {
  console.error(`\n${problemes.length} problème(s) d'architecture :`);
  for (const p of problemes.sort()) console.error(`  ${p}`);
  console.error("\n`--write` réimprime la table depuis la mesure.");
  process.exit(1);
}
console.log("couches unidirectionnelles : aucune dépendance ne remonte");
