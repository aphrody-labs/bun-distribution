import type { RedisOptions } from "ioredis";

import { env } from "@/env";

/**
 * Connexion Redis d'Achilléa.
 *
 * UNE SEULE INSTANCE, DES BASES LOGIQUES DISTINCTES
 * Le cluster n'a qu'un serveur Redis (`127.0.0.1:6379`), partagé par tout le
 * VPS. Ce qui sépare les services, ce sont les bases logiques — et Achilléa
 * écrivait dans la **base 0**, c'est-à-dire la base PAR DÉFAUT, celle où
 * atterrit n'importe quel client qui n'en précise aucune. Elle contenait déjà
 * 900 000 clés appartenant à d'autres projets, et les files d'Achilléa y
 * portaient les noms les plus génériques qui soient : `bull:main`, `bull:clan`,
 * `bull:sanctions`. Une purge décidée par un service voisin emportait les files
 * de celui-ci.
 *
 * Registre des bases (voir `docs/redis.md`) :
 *   0 — base par défaut, à ne plus utiliser pour du neuf
 *   1 — Rose Griffon (bot, site, cron)
 *   2 — Achilléa
 *   3 — index des fichiers CPK d'Inazuma Eleven
 *   4 — atlas de symboles du RE toolkit
 *
 * Le préfixe `achillea` s'ajoute à la base : même si deux services finissaient
 * un jour sur la même base, leurs files ne se mélangeraient pas.
 */

const REDIS_HOST = process.env.REDIS_HOST ?? "127.0.0.1";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? 6379);

/** Base logique d'Achilléa, en production comme en développement. */
const BASE_ACHILLEA = 2;

/**
 * Base de test.
 *
 * Distincte de la base de production : un `bun test` qui vide ses files ne doit
 * pas toucher à celles qui tournent.
 */
const BASE_ACHILLEA_TEST = 9;

/** Préfixe BullMQ — `bull:` par défaut, ce qui ne dit rien de l'émetteur. */
export const PREFIXE_FILES = "achillea";

function connexion(db: number): RedisOptions {
	return {
		host: REDIS_HOST,
		port: REDIS_PORT,
		// BullMQ l'exige : une requête bloquante ne doit pas être réessayée.
		maxRetriesPerRequest: null,
		db,
	};
}

export const redisConnection: RedisOptions = connexion(
	env.isDev ? BASE_ACHILLEA_TEST : BASE_ACHILLEA
);
