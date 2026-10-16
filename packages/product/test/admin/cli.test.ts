// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable no-await-in-loop -- sequential by design: ordered steps, polling and one host after the other */
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { guarded, help, main } from "../../src/admin/cli.ts";
import { aliases, registry, summaries } from "../../src/admin/commands/index.ts";
import { MAIN_MENU, TRAIN_MENU, mainMenu, renderMenu } from "../../src/admin/menu.ts";
import { saveProfile } from "../../src/admin/lib/profile.ts";
import { samplePack, testContext, type TestContext } from "./helpers.ts";

const SONDE = [
  "user|omar",
  "cpu|16",
  "disk|412000000|500000000",
  "gpu|NVIDIA RTX 4090, 24564, 1200, 3",
  "aphrody|aphrody 1.0.0",
  "repo|oui",
  'train|{ "gpu_lock_active": false, "python_train_project": true }',
  "jobs|0",
].join("\n");

async function withPack(options: Parameters<typeof testContext>[0] = {}): Promise<TestContext> {
  const t = testContext(options);
  await saveProfile(t.ctx.paths, samplePack());
  return t;
}

const sshCalls = (t: TestContext) => t.sys.calls.filter((call) => call.argv[0] === "ssh");
const launches = (t: TestContext) =>
  sshCalls(t).filter((call) => call.options.input?.includes("setsid"));

test("version, help and unknown commands", async () => {
  const { ctx, ui } = testContext();
  expect(await main(["--version"], ctx)).toBe(0);
  expect(ui.lines).toEqual(["0.1.0"]);
  expect(await main([], ctx)).toBe(0);
  expect(help()).toContain("entrainement");
  for (const name of Object.keys(summaries)) expect(registry[name]).toBeDefined();
  expect(registry.interne).toBeDefined();
  expect(summaries.interne).toBeUndefined();
  expect(Object.values(aliases).every((target) => registry[target])).toBe(true);
  const original = console.error;
  console.error = () => undefined;
  try {
    expect(await main(["nope"], ctx)).toBe(2);
    expect(await guarded(["nope"], ctx)).toBe(2);
    expect(await main(["entrainement", "--bogus"], ctx)).toBe(2);
  } finally {
    console.error = original;
  }
});

test("training without an access file explains what to do first", async () => {
  const { ctx, ui, sys } = testContext();
  expect(await main(["entrainement", "etat"], ctx)).toBe(1);
  expect(ui.lines.join("\n")).toContain("Tout installer ou réparer");
  expect(sys.calls).toEqual([]);
});

test("start is a simulation by default: plan printed, nothing sent to the host", async () => {
  const t = await withPack();
  expect(await main(["entrainement", "demarrer", "--type", "test"], t.ctx)).toBe(0);
  const said = t.ui.lines.join("\n");
  expect(said).toContain("SIMULATION : rien n'a été lancé");
  expect(said).toContain("Test de l'entraînement");
  expect(said).toContain("Serveur      : gpu (omar@198.51.100.2)");
  expect(sshCalls(t)).toEqual([]);
});

test("start validates before anything else", async () => {
  const t = await withPack();
  expect(await main(["entrainement", "demarrer", "--type", "lora", "--etapes", "5"], t.ctx)).toBe(
    2,
  );
  expect(t.ui.lines.join("\n")).toContain("il manque");
  const original = console.error;
  console.error = () => undefined;
  try {
    expect(await main(["entrainement", "demarrer", "--type", "promote"], t.ctx)).toBe(2);
    expect(await main(["entrainement", "demarrer", "--type", "embeddings"], t.ctx)).toBe(2);
    expect(
      await main(["entrainement", "demarrer", "--type", "embeddings", "--etapes", "abc"], t.ctx),
    ).toBe(2);
  } finally {
    console.error = original;
  }
  expect(sshCalls(t)).toEqual([]);
});

function hostScripts(t: TestContext, sonde = SONDE) {
  t.sys.handlers.push({
    match: /^ssh /,
    result: (_argv, options) => {
      const input = options.input ?? "";
      if (input.includes("setsid")) return { stdout: "OK|kit-x|4242\n" };
      if (input.includes('echo "user|')) return { stdout: sonde };
      if (input.includes("kill -s")) return { stdout: "STOPPED|4242\n" };
      if (input.includes("JOURNAL|")) return { stdout: "JOURNAL|kit-x\nline one\nline two\n" };
      return {
        stdout: [
          "HOTE|gpu-1",
          'JOB|kit-20261006-100000-test|test|termine|2026-10-06T10:00:00Z|{"event":"done"}',
          'JOB|kit-20261006-110000-embeddings|embeddings|en-cours|2026-10-06T11:00:00Z|{"event":"progress"}',
        ].join("\n"),
      };
    },
  });
}

test("a real launch needs the host to be ready AND a typed OUI", async () => {
  const t = await withPack({ answers: ["non"] });
  hostScripts(t);
  expect(
    await main(
      [
        "entrainement",
        "demarrer",
        "--type",
        "test",
        "--id",
        "kit-20261006-120000-test",
        "--lancer",
      ],
      t.ctx,
    ),
  ).toBe(0);
  expect(launches(t)).toEqual([]);
  expect(t.ui.lines.join("\n")).toContain("Annulé");
  expect(t.ui.questions.at(-1)).toContain("tape OUI");

  const yes = await withPack({ answers: ["OUI"] });
  hostScripts(yes);
  expect(
    await main(
      [
        "entrainement",
        "demarrer",
        "--type",
        "test",
        "--id",
        "kit-20261006-120000-test",
        "--lancer",
      ],
      yes.ctx,
    ),
  ).toBe(0);
  expect(launches(yes)).toHaveLength(1);
  const launch = launches(yes)[0]!;
  expect(launch.argv.at(-1)).toContain(
    "'kit-20261006-120000-test' '/usr/local/bin/aphrody' '/home/ubuntu/apps/aphrody' '-' 'test' 'dry-run'",
  );
  expect(yes.ui.lines.join("\n")).toContain("Lancé : kit-20261006-120000-test (processus 4242)");
  expect(yes.ui.lines.join("\n")).toContain("Tu peux fermer cette fenêtre");
});

test("--oui confirms in advance; without a terminal and without --oui nothing is launched", async () => {
  const batch = await withPack({ interactive: false });
  hostScripts(batch);
  expect(await main(["entrainement", "demarrer", "--type", "test", "--lancer"], batch.ctx)).toBe(2);
  expect(launches(batch)).toEqual([]);
  expect(batch.ui.lines.join("\n")).toContain("--oui");
  const scripted = await withPack({ interactive: false });
  hostScripts(scripted);
  expect(
    await main(["entrainement", "demarrer", "--type", "test", "--lancer", "--oui"], scripted.ctx),
  ).toBe(0);
  expect(launches(scripted)).toHaveLength(1);
});

test("the pre-flight check refuses to launch on a full disk, a busy GPU, a missing feature or no GPU", async () => {
  const cases: [string, string, string[]][] = [
    ["disk", SONDE.replace("412000000", "3000000"), ["presque plein"]],
    ["jobs", SONDE.replace("jobs|0", "jobs|1"), ["déjà en cours"]],
    [
      "feature",
      SONDE.replace(/train\|.*/, "train|× `aphrody train` requires --features train"),
      ["pas disponible"],
    ],
    ["busy", SONDE.replace("false", "true"), ["déjà réservée"]],
    ["nogpu", SONDE.replace(/gpu\|.*/, "gpu|aucun"), ["pas de carte graphique"]],
    ["noaphrody", SONDE.replace(/aphrody\|.*/, "aphrody|absent"), ["pas installé"]],
  ];
  for (const [name, sonde, expected] of cases) {
    const t = await withPack({ answers: ["OUI"] });
    hostScripts(t, sonde);
    const code = await main(
      [
        "entrainement",
        "demarrer",
        "--type",
        name === "nogpu" ? "embeddings" : "embeddings",
        "--entree",
        "data/t.jsonl",
        "--etapes",
        "10",
        "--lancer",
      ],
      t.ctx,
    );
    expect(code, name).toBe(1);
    expect(t.ui.lines.join("\n"), name).toContain(expected[0]!);
    expect(launches(t), name).toEqual([]);
  }
  const cpuOk = await withPack({ answers: ["OUI"] });
  hostScripts(cpuOk, SONDE.replace(/gpu\|.*/, "gpu|aucun"));
  expect(
    await main(
      [
        "entrainement",
        "demarrer",
        "--type",
        "embeddings",
        "--entree",
        "data/t.jsonl",
        "--etapes",
        "10",
        "--lancer",
        "--cpu",
      ],
      cpuOk.ctx,
    ),
  ).toBe(0);
  expect(launches(cpuOk)).toHaveLength(1);
});

test("ssh failures during launch are explained, not shown raw", async () => {
  const t = await withPack({ answers: ["OUI"] });
  t.sys.handlers.push({
    match: /^ssh /,
    result: { code: 255, stderr: "omar@x: Permission denied (publickey)." },
  });
  expect(await main(["entrainement", "demarrer", "--type", "test", "--lancer"], t.ctx)).toBe(1);
  expect(t.ui.lines.join("\n")).toContain("refuse ta clé");
  expect(launches(t)).toEqual([]);
});

test("status, log and aliases", async () => {
  const t = await withPack();
  hostScripts(t);
  expect(await main(["entrainement", "etat"], t.ctx)).toBe(0);
  const said = t.ui.lines.join("\n");
  expect(said).toContain("[terminé] kit-20261006-100000-test - Test de l'entraînement");
  expect(said).toContain("[en cours] kit-20261006-110000-embeddings");
  expect(said).toContain('dernier message : {"event":"progress"}');
  expect(await main(["train", "status", "--hote", "vps"], t.ctx)).toBe(0);
  expect(await main(["entrainement", "journal", "kit-x", "--lignes", "5"], t.ctx)).toBe(0);
  expect(t.ui.lines.join("\n")).toContain("Journal de kit-x :\nline one");
  expect(await main(["entrainement", "etat", "--hote", "ghost"], t.ctx)).toBe(1);
});

test("stop asks for a typed OUI, says what happens, and keeps the files", async () => {
  const t = await withPack({ answers: ["pas sûr"] });
  hostScripts(t);
  expect(await main(["entrainement", "arreter", "kit-20261006-110000-embeddings"], t.ctx)).toBe(0);
  expect(sshCalls(t).filter((call) => call.options.input?.includes("kill -s"))).toEqual([]);
  const said = t.ui.lines.join("\n");
  expect(said).toContain("arrêt poli");
  expect(said).toContain("Annulé : rien n'a été arrêté");

  const yes = await withPack({ answers: ["OUI"] });
  hostScripts(yes);
  expect(await main(["entrainement", "stop"], yes.ctx)).toBe(0);
  const stop = sshCalls(yes).find((call) => call.options.input?.includes("kill -s"))!;
  expect(stop.argv.at(-1)).toBe("sh -s -- 'kit-20261006-110000-embeddings' '0'");
  expect(yes.ui.lines.join("\n")).toContain("fichiers déjà produits sont conservés");

  const forced = await withPack({ answers: ["OUI"] });
  hostScripts(forced);
  await main(["entrainement", "arreter", "kit-20261006-110000-embeddings", "--force"], forced.ctx);
  expect(forced.ui.lines.join("\n")).toContain("ARRÊT FORCÉ");
  expect(
    sshCalls(forced)
      .find((call) => call.options.input?.includes("kill -s"))!
      .argv.at(-1),
  ).toContain("'1'");
});

test("the training wizard walks through type, host, steps and inputs, then simulates and asks for OUI", async () => {
  const t = await withPack({ answers: ["2", "", "50", "data/triples.jsonl", "", "n", "OUI"] });
  hostScripts(t);
  expect(await main(["entrainement"], t.ctx)).toBe(0);
  const said = t.ui.lines.join("\n");
  expect(said).toContain("1. Test de l'entraînement");
  expect(said).toContain("7. Préparer les paires de correction");
  expect(said).toContain("Entrée       : data/triples.jsonl");
  expect(launches(t)).toHaveLength(1);
  expect(launches(t)[0]!.argv.at(-1)).toContain("'embeddings' 'embed'");
  const cancelled = await withPack({ answers: [""] });
  expect(await main(["entrainement"], cancelled.ctx)).toBe(0);
  expect(cancelled.ui.lines.join("\n")).toContain("Annulé");
});

test("access commands print only public keys and report the import state", async () => {
  const t = testContext({ platform: "linux" });
  expect(await main(["acces", "etat"], t.ctx)).toBe(0);
  expect(t.ui.lines.join("\n")).toContain("Aucun fichier d'accès");
  const withProfile = await withPack();
  expect(await main(["acces", "etat"], withProfile.ctx)).toBe(0);
  expect(withProfile.ui.lines.join("\n")).toContain("Serveurs : vps, gpu");
  expect(await main(["acces", "bogus"], withProfile.ctx)).toBe(2);
});

test("internal elevated entry refuses anything but its own arguments", async () => {
  const { ctx, ui } = testContext();
  expect(await main(["interne"], ctx)).toBe(2);
  expect(await main(["interne", "wg-installer", "C:\\x.conf", "../bad"], ctx)).toBe(2);
  expect(await main(["interne", "other", "C:\\x.conf", "aphrody"], ctx)).toBe(2);
  expect(ui.lines.join("\n")).toContain("usage interne");
});

test("the menu lists French choices, survives errors and unknown input, and quits on 0", async () => {
  const t = testContext({ answers: ["9", "x", "6", "", "0"] });
  await mainMenu(t.ctx);
  const said = t.ui.lines.join("\n");
  expect(said).toContain("Aphrody - kit administrateur (version 0.1.0)");
  for (const item of MAIN_MENU) expect(said).toContain(`${item.key}. ${item.title}`);
  expect(said).toContain("Je n'ai pas compris");
  expect(said).toContain("Le guide n'est pas à côté du programme");
  expect(MAIN_MENU.map((item) => item.title)).toEqual([
    "Tout installer ou réparer",
    "Vérifier que tout est prêt",
    "Entraîner un modèle",
    "Envoyer mes clés à l'équipe (première fois)",
    "Préparer le message d'aide pour l'équipe",
    "Ouvrir le guide",
    "Mon PC et mes serveurs (état, mémoire, WSL, diagnostic)",
    "Mettre ce programme à jour",
  ]);
  expect(TRAIN_MENU.map((item) => item.key)).toEqual(["1", "2", "3", "4"]);
  expect(renderMenu("T", TRAIN_MENU, "Retour").at(-1)).toBe("  0. Retour");
  const closed = testContext({ answers: [] });
  await mainMenu(closed.ctx);
  expect(closed.ui.lines.length).toBeGreaterThan(3);
});

test("the guide opens through the Windows shell, from the installed folder first", async () => {
  const { ctx, sys, ui } = testContext();
  mkdirSync(ctx.paths.installDir, { recursive: true });
  writeFileSync(join(ctx.paths.installDir, "Guide.html"), "<html>");
  sys.handlers.push({ match: "cmd /c start", result: {} });
  expect(await main(["guide"], ctx)).toBe(0);
  expect(sys.calls[0]!.argv).toEqual([
    "cmd",
    "/c",
    "start",
    "",
    join(ctx.paths.installDir, "Guide.html"),
  ]);
  expect(ui.lines).toEqual([]);
});

test("the help message for the team contains the check and the log tail, and never a secret", async () => {
  const t = await withPack();
  mkdirSync(dirname(t.ctx.paths.logFile), { recursive: true });
  writeFileSync(
    t.ctx.paths.logFile,
    "[x] étape cles : fait\nPrivateKey = cNDOxEMQ7rC2DPNdG67aB2XDs8B9mL5jIX3MCHMruEw=\ntoken ghp_abcdefghijklmnopqrstuvwxyz0123456789\n",
  );
  t.sys.handlers.push({ match: "clip", result: {} });
  expect(await main(["diagnostic"], t.ctx)).toBe(0);
  const file = join(t.ctx.paths.desktopDir, "message-pour-l-equipe.txt");
  expect(existsSync(file)).toBe(true);
  const text = readFileSync(file, "utf8");
  expect(text).toContain("== Vérification ==");
  expect(text).toContain("RÉSULTAT");
  expect(text).toContain("étape cles : fait");
  expect(text).not.toContain("cNDOxEMQ7rC2");
  expect(text).not.toContain("ghp_abcdef");
  expect(t.sys.calls.find((call) => call.argv[0] === "clip")!.options.input).toBe(text);
  expect(t.ui.lines.join("\n")).toContain("ni mot de passe ni clé privée");
});

test("verifier prints the French report or JSON and exits non-zero only when not ready", async () => {
  const t = testContext({ platform: "linux" });
  expect(await main(["verifier", "--local"], t.ctx)).toBe(1);
  expect(t.ui.lines.join("\n")).toContain("RÉSULTAT : PAS PRÊT");
  const json = testContext({ platform: "linux" });
  await main(["doctor", "--local", "--json"], json.ctx);
  const parsed = JSON.parse(json.ui.lines.join("\n"));
  expect(parsed.verdict).toBe("pas-pret");
  expect(Array.isArray(parsed.checks)).toBe(true);
});
