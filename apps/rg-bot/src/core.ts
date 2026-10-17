/**
 * `rg-core` — le service VPS unique de Rose Griffon, en UN processus Bun.
 *
 * Tout ce qui est long, avec état ou lourd vit ici ; le site, Supabase et Vercel ne gardent que
 * le sans-état :
 *   - la passerelle Discord du profil `rg` (discordx, évènements, synchro des membres) et, en
 *     processus enfant supervisé, celle du profil `azalee` : discordx enregistre ses commandes par
 *     décorateurs à l'import, deux profils ne peuvent donc pas partager un même module graph ;
 *   - le serveur Colyseus du ranked Achilléa (rooms + REST `/api/*`), dont le `Bun.serve` est le
 *     SEUL port du service : santé, modèles, API unifiée `/v1/*` et administration des bots y sont
 *     routés avant Colyseus (`demarrerRanked({ intercepter })`) ;
 *   - l'API unifiée Elysia en processus (`app.handle`), qui sert aussi l'ancien préfixe `/api/*` ;
 *   - `aphrody-nie-model-serve` (Rust, serveur HTTP sans point d'entrée FFI) en enfant supervisé
 *     sur la boucle locale, relayé par ce port sans recopier sa logique ;
 *   - les tâches planifiées du registre `@rosegriffon/cron` via `Bun.cron`, même délai, historique
 *     et bail d'unicité que la route `/v1/cron/*`.
 *
 * `rg-core bot` démarre la seule passerelle du profil courant (`RG_PROFIL_BOT`) : c'est la forme
 * de l'enfant `azalee`.
 */
// Avant tout autre module : discordx et tsyringe (via @simplewebauthn → @peculiar/x509, chargé par
// l'API) exigent `Reflect.getMetadata` dès leur évaluation.
import "reflect-metadata";
import packageJson from "../package.json" with { type: "json" };

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  console.log("rg-core — Rose Griffon VPS service (Discord gateway, Colyseus ranked, model serve, cron)\n");
  console.log("Usage: rg-core [bot] [--help] [--version]\n");
  console.log("  (aucun)    service complet sur RG_CORE_PORT (défaut 8810)");
  console.log("  bot        seule la passerelle Discord du profil RG_PROFIL_BOT");
  process.exit(0);
}
if (argv.includes("--version") || argv.includes("-v")) {
  console.log(`rg-core v${packageJson.version} (Bun ${Bun.version}+${Bun.revision.slice(0, 9)})`);
  process.exit(0);
}


// ─── Supervision des enfants ────────────────────────────────────────────────

interface EtatEnfant {
  nom: string;
  pid: number | null;
  redemarrages: number;
  demarreLe: number | null;
  dernierCode: number | null;
}

interface Superviseur {
  etat: EtatEnfant;
  arreter: () => void;
}

/** Relance un enfant qui meurt, avec un délai exponentiel (1 s → 60 s) remis à zéro après 60 s de vie. */
function superviser(nom: string, cmd: string[], options: { env?: Record<string, string | undefined>; cwd?: string }) {
  const etat: EtatEnfant = {
    nom,
    pid: null,
    redemarrages: 0,
    demarreLe: null,
    dernierCode: null,
  };
  let enfant: ReturnType<typeof Bun.spawn> | null = null;
  let arret = false;
  let echecs = 0;
  let minuteur: ReturnType<typeof setTimeout> | null = null;

  const lancer = () => {
    if (arret) return;
    const debut = Date.now();
    enfant = Bun.spawn({
      cmd,
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      onExit(_proc, code, signal) {
        etat.pid = null;
        etat.dernierCode = code;
        enfant = null;
        if (arret) return;
        echecs = Date.now() - debut > 60_000 ? 0 : echecs + 1;
        const attente = Math.min(60_000, 1000 * 2 ** Math.min(echecs, 6));
        console.error(
          `[rg-core] ${nom} arrêté (code ${code ?? "?"}, signal ${signal ?? "-"}) — relance dans ${attente} ms`,
        );
        etat.redemarrages++;
        minuteur = setTimeout(lancer, attente);
      },
    });
    etat.pid = enfant.pid;
    etat.demarreLe = debut;
    console.info(`[rg-core] ${nom} démarré (pid ${enfant.pid})`);
  };

  lancer();
  return {
    etat,
    arreter() {
      arret = true;
      if (minuteur) clearTimeout(minuteur);
      enfant?.kill("SIGTERM");
    },
  } satisfies Superviseur;
}

/** Commande qui relance ce même programme (binaire compilé ou source exécutée par Bun). */
function commandeSoiMeme(...args: string[]): string[] {
  const compile = import.meta.path.startsWith("/$bunfs/") || /^[A-Z]:\\~BUN\\/i.test(import.meta.path);
  return compile ? [process.execPath, ...args] : [process.execPath, Bun.main, ...args];
}

// ─── Relais HTTP ────────────────────────────────────────────────────────────

const ENTETES_SAUT = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "host"];

/** Relaie une requête telle quelle (corps et encodage en flux, sans décompression). */
async function relayer(requete: Request, cible: string): Promise<Response> {
  const headers = new Headers(requete.headers);
  for (const nom of ENTETES_SAUT) headers.delete(nom);
  const avecCorps = requete.method !== "GET" && requete.method !== "HEAD";
  try {
    const reponse = await fetch(cible, {
      method: requete.method,
      headers,
      body: avecCorps ? requete.body : undefined,
      redirect: "manual",
      decompress: false,
    });
    const sortie = new Headers(reponse.headers);
    for (const nom of ENTETES_SAUT) sortie.delete(nom);
    return new Response(reponse.body, {
      status: reponse.status,
      statusText: reponse.statusText,
      headers: sortie,
    });
  } catch (err) {
    console.error(
      `[rg-core] relais vers ${new URL(cible).origin} en échec :`,
      err instanceof Error ? err.message : err,
    );
    return Response.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}

function hotes(variable: string | undefined, defaut: string): Set<string> {
  return new Set(
    (variable ?? defaut)
      .split(",")
      .map(h => h.trim().toLowerCase())
      .filter(Boolean),
  );
}

// ─── Service complet ────────────────────────────────────────────────────────

async function demarrerCoeur(): Promise<void> {
  Bun.env.RG_PROFIL_BOT ??= "rg";
  const port = Number(Bun.env.RG_CORE_PORT ?? 8810);
  const hostname = Bun.env.RG_CORE_HOST ?? "127.0.0.1";
  const enfants: Superviseur[] = [];

  // nie-model-serve : binaire Rust autonome (pas d'entrée FFI), relayé sur la boucle locale.
  const portModeles = Number(Bun.env.NIE_MODEL_SERVE_PORT ?? 8792);
  const binaireModeles = Bun.env.NIE_MODEL_SERVE_BIN ?? Bun.which("aphrody-nie-model-serve");
  const jeuIevr = Bun.env.NIE_GAME_DIR;
  let modeles: Superviseur | null = null;
  if (Bun.env.RG_CORE_MODELES !== "0" && binaireModeles && jeuIevr) {
    const args = ["--game-dir", jeuIevr, "--port", String(portModeles)];
    if (Bun.env.NIE_MODEL_CACHE_DIR) args.push("--cache-dir", Bun.env.NIE_MODEL_CACHE_DIR);
    args.push("--threads", Bun.env.NIE_MODEL_SERVE_THREADS ?? "8");
    args.push(...(Bun.env.NIE_MODEL_SERVE_ARGS ?? "").split(/\s+/).filter(Boolean));
    modeles = superviser("nie-model-serve", [binaireModeles, ...args], {
      cwd: Bun.env.NIE_MODEL_SERVE_CWD,
    });
    enfants.push(modeles);
  } else {
    console.warn(
      "[rg-core] nie-model-serve désactivé (NIE_MODEL_SERVE_BIN ou NIE_GAME_DIR absent, ou RG_CORE_MODELES=0)",
    );
  }

  // Passerelle Azalée : même binaire, autre profil, autre processus.
  const { PROFILS_BOT } = await import("@rosegriffon/types/bot");
  let azalee: Superviseur | null = null;
  if (Bun.env.RG_CORE_AZALEE !== "0" && Bun.env.AZALEE_DISCORD_BOT_TOKEN && Bun.env.RG_PROFIL_BOT !== "azalee") {
    azalee = superviser("bot-azalee", commandeSoiMeme("bot"), {
      env: { RG_PROFIL_BOT: "azalee" },
    });
    enfants.push(azalee);
  }

  const arreterEnfants = () => {
    for (const enfant of enfants) enfant.arreter();
  };
  // Avant l'écouteur du bot (`index.ts`), qui termine le processus après la passerelle.
  process.on("SIGTERM", arreterEnfants);
  process.on("SIGINT", arreterEnfants);

  const { app } = await import("./api/server");
  const { clientActif } = await import("./lib/client-actif");
  const hotesModeles = hotes(Bun.env.RG_CORE_MODEL_HOSTS, "cdn.rosegriffon.fr,nie.aphrody.app");
  const hotesBot = hotes(Bun.env.RG_CORE_BOT_HOSTS, "bot.rosegriffon.fr");
  const origineModeles = `http://127.0.0.1:${portModeles}`;
  let planifiees: string[] = [];

  const sante = () => ({
    status: "ok",
    service: "rg-core",
    version: packageJson.version,
    bun: Bun.version,
    uptime: Math.round(process.uptime()),
    rssMiB: Math.round(process.memoryUsage.rss() / 1048576),
    bot: {
      profil: Bun.env.RG_PROFIL_BOT,
      pret: clientActif()?.isReady() ?? false,
    },
    enfants: enfants.map(e => e.etat),
    cron: planifiees,
  });

  const { demarrerRanked, definirRelaisPreuveRanked } = await import("./api/ranked/main");
  await demarrerRanked({
    port,
    hostname,
    api: requete => app.handle(requete),
    intercepter(requete) {
      const url = new URL(requete.url);
      const hote = (requete.headers.get("host") ?? url.host).split(":")[0]!.toLowerCase();
      if (hotesModeles.has(hote)) {
        return url.pathname === "/health"
          ? relayer(requete, `${origineModeles}/health`)
          : relayer(requete, `${origineModeles}${url.pathname}${url.search}`);
      }
      if (url.pathname.startsWith("/models/")) {
        return relayer(requete, `${origineModeles}${url.pathname.slice("/models".length)}${url.search}`);
      }
      if (url.pathname === "/health") return Response.json(sante());
      if (url.pathname.startsWith("/v1/")) return app.handle(requete);
      if (hotesBot.has(hote)) {
        // bot.rosegriffon.fr/<profil>/… → serveur d'administration loopback de ce profil.
        const [, profil = "", ...reste] = url.pathname.split("/");
        const cible = PROFILS_BOT[profil as keyof typeof PROFILS_BOT];
        if (!cible) return Response.json({ error: "profil inconnu" }, { status: 404 });
        return relayer(requete, `http://127.0.0.1:${cible.portAdmin}/${reste.join("/")}${url.search}`);
      }
      return undefined;
    },
  });

  planifiees = await planifierTaches();

  // Passerelle du profil courant, en dernier : `index.ts` attend `login()`.
  if (!process.argv.includes("bot")) process.argv.push("bot");
  const brancher = brancherPasserelle(definirRelaisPreuveRanked);
  try {
    await import("./index");
  } catch (err) {
    // Colyseus, l'API, les modèles et le cron restent servis : `/health` rend `bot.pret = false`.
    console.error("[rg-core] passerelle Discord indisponible :", err instanceof Error ? (err.stack ?? err.message) : err);
    return;
  }
  await brancher;
}

type ClientPasserelle = import("@rosegriffon/cron").ClientPasserelle;

/** Branche la veille temps réel et le relais des preuves dès que la passerelle existe. */
async function brancherPasserelle(
  definirRelais: (relais: ((lobbyId: number, userId: string, url: string) => Promise<void>) | null) => void,
): Promise<void> {
  const { attendreClientActif } = await import("./lib/client-actif");
  const client = await attendreClientActif();

  const salonPreuves = Bun.env.RANKED_PROOF_CHANNEL_ID;
  if (salonPreuves) {
    definirRelais(async (lobbyId, userId, url) => {
      const salon = await client.channels.fetch(salonPreuves);
      if (!salon?.isSendable()) throw new Error(`salon ${salonPreuves} injoignable`);
      await salon.send({
        content: `Preuve de litige — lobby #${lobbyId}, joueur <@${userId}> : ${url}`,
      });
    });
  }

  if (Bun.env.RG_PROFIL_BOT === "rg" && Bun.env.RG_CORE_VEILLE_MESSAGES !== "0") {
    const { brancherVeilleMessagesTempsReel } = await import("@rosegriffon/cron");
    // `ClientPasserelle` est le sous-ensemble structurel `on`/`off` que discord.js surcharge par évènement.
    await brancherVeilleMessagesTempsReel(client as unknown as ClientPasserelle);
  }
}

/**
 * Planifie en processus toutes les tâches périodiques du registre (`Bun.cron`, heure système).
 * `RG_CORE_CRON=0` coupe tout ; `RG_CORE_CRON_EXCLURE` retire des tâches (défaut : `warm`, qui
 * ne ferait que consommer le quota des pages Vercel — l'ISR se revalide à la demande).
 */
async function planifierTaches(): Promise<string[]> {
  if (Bun.env.RG_CORE_CRON === "0") return [];
  const { REGISTRE_TACHES, PLANIFICATIONS, lancerTache } = await import("@rosegriffon/cron");
  const { signalerCron } = await import("./lib/cron-ipc");
  const exclues = hotes(Bun.env.RG_CORE_CRON_EXCLURE, "warm");
  const planifiees: string[] = [];
  for (const nom of Object.keys(REGISTRE_TACHES)) {
    const expression = (PLANIFICATIONS as Record<string, string | undefined>)[nom];
    if (!expression || expression === "manuel" || exclues.has(nom)) continue;
    try {
      Bun.cron(expression, async () => {
        const resultat = await lancerTache(nom, { origine: "planifie" }).catch(err => ({
          nom,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }));
        signalerCron({
          event: "task.done",
          nom,
          success: resultat.success,
          error: resultat.error,
        });
        if (resultat.success && nom.startsWith("x")) signalerCron({ event: "tweets.signal", nom });
      });
      planifiees.push(`${nom} ${expression}`);
    } catch (err) {
      console.error(`[rg-core] planification « ${nom} » (${expression}) refusée :`, err);
    }
  }
  console.info(`[rg-core] ${planifiees.length} tâche(s) planifiée(s) en processus`);
  return planifiees;
}

// En dernier : les constantes de module ci-dessus doivent être initialisées avant le démarrage.
if (argv.includes("bot")) {
  await import("./index");
} else {
  await demarrerCoeur();
}
