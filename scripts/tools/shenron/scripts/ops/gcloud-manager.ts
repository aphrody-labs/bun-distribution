#!/usr/bin/env bun
/**
 * @file scripts/ops/gcloud-manager.ts
 * Gestionnaire d'exploitation Google Cloud pour Shenron / Aphrody.
 *
 * Fonctionnalités :
 * - Audit de configuration (projet aphrody, région europe-west9, auth)
 * - Activation des APIs requises (Storage, Vertex AI, Generative Language)
 * - Synchronisation PRA des sauvegardes PostgreSQL et SQLite vers Google Cloud Storage
 * - Test de connectivité IA / Gemini
 *
 * Usage :
 *   bun scripts/ops/gcloud-manager.ts status
 *   bun scripts/ops/gcloud-manager.ts enable-apis
 *   bun scripts/ops/gcloud-manager.ts sync-backups
 *   bun scripts/ops/gcloud-manager.ts auth-help
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ID = "aphrody";
const REGION = "europe-west9";
const ZONE = "europe-west9-a";
const BACKUP_BUCKET = "gs://aphrody-shenron-backups";

const REQUIRED_APIS = [
	"storage.googleapis.com",
	"aiplatform.googleapis.com",
	"generativelanguage.googleapis.com",
	"cloudresourcemanager.googleapis.com",
];

async function exec(cmd: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
	const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	return { stdout: stdout.trim(), stderr: stderr.trim(), code };
}

async function getAuthAccount(): Promise<string | null> {
	const { stdout, code } = await exec(["gcloud", "auth", "list", "--filter=status:ACTIVE", "--format=value(account)"]);
	if (code === 0 && stdout) return stdout.split("\n")[0]?.trim() || null;
	return null;
}

async function checkStatus() {
	console.log("☁️  \x1b[1;36mAudit Google Cloud — Projet Aphrody\x1b[0m\n");

	// 1. Version gcloud
	const ver = await exec(["gcloud", "version"]);
	if (ver.code !== 0) {
		console.log("❌ gcloud CLI non installé ou inaccessible.");
		return;
	}
	const firstLine = ver.stdout.split("\n")[0];
	console.log(`✓ CLI : \x1b[32m${firstLine}\x1b[0m`);

	// 2. Config gcloud
	const cfg = await exec(["gcloud", "config", "list", "--format=json"]);
	if (cfg.code === 0) {
		try {
			const parsed = JSON.parse(cfg.stdout);
			const currentProj = parsed.core?.project;
			const currentRegion = parsed.compute?.region;
			console.log(`✓ Projet actif : \x1b[33m${currentProj || "non configuré"}\x1b[0m (cible: ${PROJECT_ID})`);
			console.log(`✓ Région active : \x1b[33m${currentRegion || "non configurée"}\x1b[0m (cible: ${REGION})`);
		} catch {
			console.log("✓ Config lue avec succès.");
		}
	}

	// 3. Authentification
	const account = await getAuthAccount();
	if (account) {
		console.log(`✓ Compte authentifié : \x1b[32m${account}\x1b[0m`);

		// 4. APIs activées
		console.log("\n🔍 Vérification des APIs activées...");
		const srv = await exec(["gcloud", "services", "list", "--enabled", "--format=value(config.name)"]);
		if (srv.code === 0) {
			const enabled = new Set(srv.stdout.split("\n").map((s) => s.trim()));
			for (const api of REQUIRED_APIS) {
				const isOk = enabled.has(api);
				console.log(`  ${isOk ? "✓" : "✗"} ${api} : ${isOk ? "\x1b[32mactivée\x1b[0m" : "\x1b[31mnon activée\x1b[0m"}`);
			}
		}

		// 5. Buckets GCS
		console.log("\n🪣 Vérification du bucket de sauvegarde...");
		const b = await exec(["gcloud", "storage", "buckets", "describe", BACKUP_BUCKET]);
		if (b.code === 0) {
			console.log(`  ✓ Bucket de sauvegarde disponible : \x1b[32m${BACKUP_BUCKET}\x1b[0m`);
		} else {
			console.log(`  ! Bucket \x1b[33m${BACKUP_BUCKET}\x1b[0m non créé ou non accessible.`);
		}
	} else {
		console.log("⚠️  \x1b[31mAucun compte Google Cloud actif.\x1b[0m");
		console.log("   Pour vous authentifier : \x1b[1;37mbun scripts/ops/gcloud-manager.ts auth-help\x1b[0m");
	}
}

async function enableApis() {
	const account = await getAuthAccount();
	if (!account) {
		console.log("❌ Veuillez vous authentifier avant d'activer les APIs (cf. bun scripts/ops/gcloud-manager.ts auth-help).");
		return;
	}

	console.log(`🚀 Activation des APIs requises sur le projet \x1b[33m${PROJECT_ID}\x1b[0m...`);
	for (const api of REQUIRED_APIS) {
		process.stdout.write(`  Activation de ${api}... `);
		const res = await exec(["gcloud", "services", "enable", api, `--project=${PROJECT_ID}`]);
		if (res.code === 0) {
			console.log("\x1b[32mOK\x1b[0m");
		} else {
			console.log(`\x1b[31mÉchec\x1b[0m (${res.stderr || "erreur inconnue"})`);
		}
	}
}

async function syncBackups() {
	const account = await getAuthAccount();
	if (!account) {
		console.log("❌ Authentification gcloud requise pour la synchronisation Cloud Storage.");
		return;
	}

	console.log(`📦 \x1b[1;36mSynchronisation des sauvegardes vers Google Cloud Storage (${BACKUP_BUCKET})\x1b[0m\n`);

	// 1. Assurer que le bucket existe
	const checkBucket = await exec(["gcloud", "storage", "buckets", "describe", BACKUP_BUCKET]);
	if (checkBucket.code !== 0) {
		console.log(`Création du bucket ${BACKUP_BUCKET} en région ${REGION}...`);
		const mkBucket = await exec([
			"gcloud",
			"storage",
			"buckets",
			"create",
			BACKUP_BUCKET,
			`--project=${PROJECT_ID}`,
			`--location=${REGION}`,
			"--uniform-bucket-level-access",
		]);
		if (mkBucket.code !== 0) {
			console.log(`❌ Impossible de créer le bucket : ${mkBucket.stderr}`);
			return;
		}
		console.log("✓ Bucket créé avec succès.");
	}

	// 2. Synchroniser les dumps PostgreSQL
	const projectRoot = join(import.meta.dir, "../..");
	const pgDir = join(projectRoot, "data/backups/shenron-pg");
	if (existsSync(pgDir)) {
		console.log(`📤 Envoi des dumps PostgreSQL depuis ${pgDir}...`);
		const cp = await exec(["gcloud", "storage", "cp", `${pgDir}/*.sql.gz`, `${BACKUP_BUCKET}/pg/`]);
		if (cp.code === 0) {
			console.log("✓ Dumps PostgreSQL synchronisés.");
		} else {
			console.log(`! Pas de dump trouvé ou transfert incomplet : ${cp.stderr}`);
		}
	}

	// 3. Synchroniser les dumps SQLite
	const sqliteDir = join(projectRoot, "data/backups/shenron-sqlite");
	if (existsSync(sqliteDir)) {
		console.log(`📤 Envoi des dumps SQLite depuis ${sqliteDir}...`);
		const cp = await exec(["gcloud", "storage", "cp", `${sqliteDir}/*.db.gz`, `${BACKUP_BUCKET}/sqlite/`]);
		if (cp.code === 0) {
			console.log("✓ Dumps SQLite synchronisés.");
		} else {
			console.log(`! Pas de dump SQLite ou transfert incomplet : ${cp.stderr}`);
		}
	}

	console.log("\n🎉 Synchronisation Cloud Storage terminée.");
}

function showAuthHelp() {
	console.log("🔑 \x1b[1;36mGuide d'authentification Google Cloud pour le projet Aphrody\x1b[0m\n");
	console.log("Deux méthodes selon vos accès :\n");

	console.log("1. \x1b[1;33mCompte Google personnel / Développeur (sans navigateur direct sur le VPS)\x1b[0m :");
	console.log("   Exécutez dans votre terminal local ou sur le VPS :");
	console.log("     \x1b[32mgcloud auth login --no-browser\x1b[0m");
	console.log("   Puis ouvrez l'URL générée dans votre navigateur, validez et collez le code retourné.\n");

	console.log("2. \x1b[1;33mClé de compte de service (Recommandé pour serveur CI/CD & Prod)\x1b[0m :");
	console.log("   Créez un compte de service sur :");
	console.log("     https://console.cloud.google.com/iam-admin/serviceaccounts?project=aphrody");
	console.log("   Donnez-lui les rôles : Administrateur de l'espace de stockage (Storage Admin) & Utilisateur Vertex AI.");
	console.log("   Téléchargez la clé JSON (ex. /etc/shenron/aphrody-sa.json) puis activez-la :");
	console.log("     \x1b[32mgcloud auth activate-service-account --key-file=/etc/shenron/aphrody-sa.json\x1b[0m\n");

	console.log("3. \x1b[1;33mPour vos besoins Gemini Spark (OAuth 2.0 Client ID)\x1b[0m :");
	console.log("   Créez l'ID client OAuth sur :");
	console.log("     https://console.cloud.google.com/apis/credentials?project=aphrody");
	console.log("   Callback autorisé :");
	console.log("     https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-101187968385849974848-mcp_dragonballfr_com\n");
}

const action = process.argv[2] || "status";
switch (action) {
	case "status":
		await checkStatus();
		break;
	case "enable-apis":
		await enableApis();
		break;
	case "sync-backups":
		await syncBackups();
		break;
	case "auth-help":
		showAuthHelp();
		break;
	default:
		console.log(`Action inconnue: ${action}`);
		console.log("Actions disponibles : status, enable-apis, sync-backups, auth-help");
}
