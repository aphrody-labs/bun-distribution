import { checkoutRoot } from "@aphrody/paths";
import { $ } from "bun";

/**
 * Chemin du binaire Bun **courant**, utilisé au lieu d'un `bun` nu.
 *
 * Ces tâches échouaient avec le code 127 à chaque exécution nocturne :
 * `bun run --filter <paquet> <script>` exécute le script du paquet **via
 * `/usr/bin/bash`**, et ce shell hérite du `PATH` du service — qui ne
 * contenait pas `~/.bun/bin`. Le message n'apparaissait que dans la
 * sortie standard de la commande imbriquée (`bun: command not found`), jamais
 * dans l'erreur remontée, d'où six semaines de sauvegardes muettes.
 *
 * Le correctif de fond est le `PATH` de l'unité systemd (cf.
 * `infra/systemd/rg-cron.service`), sans lequel la commande imbriquée
 * resterait cassée. `process.execPath` sécurise en plus l'appel externe :
 * il vaut le binaire qui fait tourner ce processus, quel que soit
 * l'environnement.
 */
const BUN = process.execPath;

/**
 * Racine du dépôt qui porte le pipeline de données du jeu.
 *
 * Depuis la fusion, tout ce qui touche aux fichiers d'Inazuma Eleven vit dans `niers` :
 * le parseur `inagle` et le décodage des CPK. Le wiki, les news
 * et le site de l'association restent ici, mais **l'extraction, elle, est là-bas**. Ces
 * la commande doit donc partir de `niers`, pas du dépôt qui la planifie.
 *
 * `NIERS_ROOT` permet de le déplacer sans toucher au code ; le repli est le chemin de
 * la machine, seul endroit où il reste écrit.
 */
const RACINE_JEU = process.env.NIERS_ROOT ?? checkoutRoot("iecode");

/**
 * Exécute la commande de push d'Inagle pour synchroniser la base de données
 * PostgreSQL avec les fichiers de données du jeu les plus récents.
 */
export async function runInaglePush(): Promise<{ success: boolean; error?: string }> {
	console.log("[Cron DB] Démarrage de la synchronisation Inagle avec la base de données...");
	try {
		await $`${BUN} run --filter @rosegriffon/inagle push`.cwd(RACINE_JEU);
		console.log("[Cron DB] Synchronisation réussie.");
		return { success: true };
	} catch (err: unknown) {
		console.error("[Cron DB] Erreur lors du push d'Inagle :", err);
		return { success: false, error: describeShellError(err) };
	}
}

/**
 * Message d'erreur exploitable pour une commande shell.
 *
 * `Bun.$` lève un objet dont le `message` se réduit à « Failed with exit code
 * N » : sans la sortie d'erreur ni l'explication du code, un échec nocturne
 * était indiagnosticable dans le journal.
 */
function describeShellError(err: unknown): string {
	if (typeof err !== "object" || err === null) return String(err);
	const shell = err as { exitCode?: number; stderr?: { toString(): string }; message?: string };
	const base = shell.message ?? String(err);
	const details: string[] = [];
	if (shell.exitCode === 127) {
		details.push("commande introuvable — vérifier le PATH du service (le binaire Bun n'y est pas par défaut)");
	}
	const stderr = shell.stderr?.toString().trim();
	if (stderr) details.push(stderr.slice(0, 500));
	return details.length > 0 ? `${base} : ${details.join(" | ")}` : base;
}
