// SPDX-License-Identifier: Apache-2.0
/**
 * Simplified training on the hosts. The kit never trains on the Windows PC: it asks the host's own `aphrody train run`
 * (the owner of the pipeline, see docs/reference/ai/training.md) through SSH, detached from the session, one job at a time.
 * Guard-rails: simulation by default, typed confirmation before a launch, nothing is ever deleted or overwritten
 * (a job lives in its own new directory), no promotion, no registry migration.
 */
import { isSafeRemotePath, type AccessPack, type HostEntry } from "./profile.ts";
import { SCRIPTS } from "./remote.ts";
import { runRemote, SSH_PROBLEM_TEXT, type RemoteResult } from "./ssh.ts";
import type { KitPaths } from "./paths.ts";
import type { System } from "./system.ts";

export type TrainType =
  "test" | "embeddings" | "reranker" | "lora" | "donnees-triplets" | "donnees-rollouts" | "donnees-dpo";

export interface TrainTypeInfo {
  /** Value of `aphrody train run --kind`. */
  kind: string;
  titre: string;
  detail: string;
  needs: ("entree" | "reference" | "modele-base")[];
  /** True when a CUDA GPU is what the job is for (the CPU fallback is slow). */
  gpu: boolean;
}

export const TRAIN_TYPES: Record<TrainType, TrainTypeInfo> = {
  test: {
    kind: "dry-run",
    titre: "Test de l'entraînement",
    detail:
      "Petit essai de quelques minutes sur le processeur : vérifie que tout fonctionne, ne produit aucun vrai modèle.",
    needs: [],
    gpu: false,
  },
  embeddings: {
    kind: "embed",
    titre: "Modèle d'embeddings (recherche)",
    detail: "Affine le modèle qui comprend le sens des textes, à partir d'un fichier de triplets.",
    needs: ["entree"],
    gpu: true,
  },
  reranker: {
    kind: "rerank",
    titre: "Modèle de reclassement (reranker)",
    detail: "Affine le modèle qui trie les résultats de recherche, à partir d'un fichier de triplets.",
    needs: ["entree"],
    gpu: true,
  },
  lora: {
    kind: "lora",
    titre: "Adaptateur LoRA d'un modèle de code",
    detail:
      "Entraîne un petit adaptateur à partir de sessions d'agent préparées, sur un modèle de base présent sur le serveur.",
    needs: ["entree", "reference", "modele-base"],
    gpu: true,
  },
  "donnees-triplets": {
    kind: "triples",
    titre: "Préparer des triplets",
    detail:
      "Fabrique les exemples d'entraînement (question, bon passage, mauvais passage) à partir de morceaux de texte.",
    needs: ["entree"],
    gpu: false,
  },
  "donnees-rollouts": {
    kind: "dataset-rollouts",
    titre: "Préparer les sessions d'agent",
    detail:
      "Extrait les sessions réussies d'un dossier de journaux, en masquant les secrets et en excluant la référence.",
    needs: ["entree", "reference"],
    gpu: false,
  },
  "donnees-dpo": {
    kind: "dataset-dpo",
    titre: "Préparer les paires de correction",
    detail: "Extrait les appels d'outils refusés puis corrigés dans un dossier de journaux.",
    needs: ["entree", "reference"],
    gpu: false,
  },
};

export const TRAIN_TYPE_IDS = Object.keys(TRAIN_TYPES) as TrainType[];

export const JOB_ID_RE = /^[a-z0-9][a-z0-9-]{2,60}$/;
export const DOMAIN_RE = /^[a-z][a-z0-9-]{0,30}$/;
const BASE_MODEL_RE =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,80}\/[A-Za-z0-9._-]{1,100}|(?:~\/|\/)?[A-Za-z0-9_.+@%=,-]+(?:\/[A-Za-z0-9_.+@%=,-]+)*\/?)$/;

export interface TrainRequest {
  type: TrainType;
  host: string;
  id: string;
  steps: number;
  entree?: string;
  reference?: string;
  modeleBase?: string;
  domaine?: string;
  allowCpu: boolean;
}

export function newJobId(type: TrainType, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `kit-${stamp}-${type}`.toLowerCase();
}

export function isTrainType(value: string): value is TrainType {
  return Object.hasOwn(TRAIN_TYPES, value);
}

/** Problems that forbid the launch, in plain French. Empty means the request is acceptable. */
export function validateRequest(request: TrainRequest, hosts: AccessPack["hosts"]): string[] {
  const problems: string[] = [];
  const info = TRAIN_TYPES[request.type];
  const host = hosts[request.host];
  if (host && !host.roles.includes("train")) problems.push("ce serveur n’est pas autorisé pour l’entraînement");
  if (!hosts[request.host]) problems.push(`serveur inconnu : ${request.host}`);
  if (!JOB_ID_RE.test(request.id))
    problems.push("numéro d'entraînement invalide (lettres minuscules, chiffres et tirets)");
  if (!Number.isInteger(request.steps) || request.steps < 1 || request.steps > 1_000_000)
    problems.push("le nombre d'étapes doit être un entier entre 1 et 1 000 000");
  for (const need of info.needs) {
    const value = need === "entree" ? request.entree : need === "reference" ? request.reference : request.modeleBase;
    const label =
      need === "entree"
        ? "le fichier ou dossier d'entrée (--entree)"
        : need === "reference"
          ? "le fichier de référence (--reference)"
          : "le modèle de base (--modele-base)";
    if (!value) problems.push(`il manque ${label}`);
  }
  for (const [label, value] of [
    ["entrée", request.entree],
    ["référence", request.reference],
  ] as const) {
    if (value !== undefined && !isSafeRemotePath(value))
      problems.push(`chemin de ${label} non autorisé (lettres, chiffres, . _ - / seulement)`);
  }
  if (
    request.modeleBase !== undefined &&
    (!BASE_MODEL_RE.test(request.modeleBase) || request.modeleBase.split("/").includes(".."))
  )
    problems.push("nom ou chemin du modèle de base non autorisé");
  if (request.domaine !== undefined && !DOMAIN_RE.test(request.domaine)) problems.push("nom de domaine invalide");
  return problems;
}

/** Flags of `aphrody train run` (the supervisor adds its own `--out-dir` inside the job folder). */
export function trainFlags(request: TrainRequest): string[] {
  const info = TRAIN_TYPES[request.type];
  const flags = ["--kind", info.kind, "--id", request.id, "--steps", String(request.steps)];
  if (request.entree) flags.push("--input", request.entree);
  if (request.reference) flags.push("--gold", request.reference);
  if (request.modeleBase) flags.push("--base-model", request.modeleBase);
  if (request.allowCpu || request.type === "test") flags.push("--allow-cpu");
  return flags;
}

export function planLines(request: TrainRequest, host: HostEntry): string[] {
  const info = TRAIN_TYPES[request.type];
  const lines = [
    `Entraînement : ${info.titre}`,
    `Serveur      : ${request.host} (${host.user}@${host.address})`,
    `Numéro       : ${request.id}`,
    `Étapes       : ${request.steps}`,
  ];
  if (request.entree) lines.push(`Entrée       : ${request.entree}`);
  if (request.reference) lines.push(`Référence    : ${request.reference}`);
  if (request.modeleBase) lines.push(`Modèle       : ${request.modeleBase}`);
  if (request.domaine) lines.push(`Domaine      : ${request.domaine}`);
  lines.push(`Commande     : ${host.aphrodyBin} train run ${trainFlags(request).join(" ")}`);
  lines.push(`Résultats    : ~/.aphrody/omar-train/${request.id}/ sur le serveur (rien n'est supprimé ni écrasé)`);
  if (info.gpu)
    lines.push(
      "Attention    : un entraînement réserve la carte graphique : les modèles d'inférence du serveur sont suspendus le temps du travail.",
    );
  return lines;
}

export interface JobLine {
  id: string;
  type: string;
  state: "en-cours" | "termine" | "echec" | "interrompu" | "arrete";
  started: string;
  last: string;
}

export const STATE_TEXT: Record<JobLine["state"], string> = {
  "en-cours": "en cours",
  termine: "terminé",
  echec: "échoué",
  interrompu: "interrompu",
  arrete: "arrêté",
};

export function parseJobs(stdout: string): { host?: string; jobs: JobLine[] } {
  const jobs: JobLine[] = [];
  let host: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("HOTE|")) host = line.slice(5);
    if (!line.startsWith("JOB|")) continue;
    const [, id = "", type = "", state = "", started = "", ...rest] = line.split("|");
    if (!["en-cours", "termine", "echec", "interrompu", "arrete"].includes(state)) continue;
    jobs.push({
      id,
      type,
      state: state as JobLine["state"],
      started,
      last: rest.join("|"),
    });
  }
  return { ...(host ? { host } : {}), jobs };
}

export interface ScriptOutcome {
  ok: boolean;
  /** `ERR|code|message` of the remote script, or the ssh problem in plain words. */
  message?: string;
  stdout: string;
}

/** Interpret an `OK|...` / `ERR|code|message` / `STOPPED|...` answer, or the ssh failure that came first. */
export function outcomeOf(result: RemoteResult, okPrefix: string[]): ScriptOutcome {
  if (result.problem)
    return {
      ok: false,
      message: SSH_PROBLEM_TEXT[result.problem],
      stdout: result.stdout,
    };
  const err = /^ERR\|\d+\|(.*)$/m.exec(result.stdout);
  if (err) return { ok: false, message: err[1]!, stdout: result.stdout };
  if (okPrefix.some(prefix => result.stdout.includes(`${prefix}|`))) return { ok: true, stdout: result.stdout };
  if (result.code !== 0)
    return {
      ok: false,
      message: result.stderr.trim().slice(0, 200) || `échec (code ${result.code})`,
      stdout: result.stdout,
    };
  return { ok: true, stdout: result.stdout };
}

export async function listJobs(
  sys: System,
  paths: KitPaths,
  host: string,
): Promise<{ outcome: ScriptOutcome; jobs: JobLine[] }> {
  const result = await runRemote(sys, paths, host, SCRIPTS.etat, {
    timeoutMs: 30_000,
  });
  const outcome = outcomeOf(result, ["HOTE"]);
  return { outcome, jobs: outcome.ok ? parseJobs(result.stdout).jobs : [] };
}

export async function launchJob(
  sys: System,
  paths: KitPaths,
  request: TrainRequest,
  host: HostEntry,
): Promise<ScriptOutcome & { pid?: string }> {
  const info = TRAIN_TYPES[request.type];
  const problems = validateRequest(request, { [request.host]: host });
  if (problems.length > 0) return { ok: false, message: problems.join(" ; "), stdout: "" };
  const result = await runRemote(sys, paths, request.host, SCRIPTS.demarrer, {
    timeoutMs: 60_000,
    args: [
      request.id,
      host.aphrodyBin,
      host.repoDir,
      request.domaine ?? "-",
      request.type,
      info.kind,
      ...trainFlags(request),
    ],
  });
  const outcome = outcomeOf(result, ["OK"]);
  const pid = /^OK\|[^|]*\|(\d+)$/m.exec(result.stdout)?.[1];
  return { ...outcome, ...(pid ? { pid } : {}) };
}

export async function readLog(
  sys: System,
  paths: KitPaths,
  host: string,
  id: string | undefined,
  lines: number,
): Promise<ScriptOutcome> {
  if (id !== undefined && !JOB_ID_RE.test(id))
    return { ok: false, message: "numéro d'entraînement invalide", stdout: "" };
  const result = await runRemote(sys, paths, host, SCRIPTS.journal, {
    timeoutMs: 30_000,
    args: [id ?? "-", String(Math.min(Math.max(lines, 1), 2000)), "0"],
  });
  return outcomeOf(result, ["JOURNAL"]);
}

export async function stopJob(
  sys: System,
  paths: KitPaths,
  host: string,
  id: string,
  force: boolean,
): Promise<ScriptOutcome & { stillRunning?: boolean }> {
  if (!JOB_ID_RE.test(id)) return { ok: false, message: "numéro d'entraînement invalide", stdout: "" };
  const result = await runRemote(sys, paths, host, SCRIPTS.arreter, {
    timeoutMs: 60_000,
    args: [id, force ? "1" : "0"],
  });
  const outcome = outcomeOf(result, ["STOPPED", "STILL"]);
  return { ...outcome, stillRunning: result.stdout.includes("STILL|") };
}
