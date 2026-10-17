/**
 * Client Discord de la passerelle de CE processus.
 *
 * Sous `rg-core`, le bot, Colyseus et les tâches lourdes partagent un seul processus : les
 * surfaces qui ont besoin de la passerelle (veille temps réel, télémétrie de `/staff cron`, relais
 * des preuves ranked) la lisent ici au lieu de se connecter une seconde fois à Discord.
 */
import type { Client } from "discordx";

let client: Client | null = null;
const enAttente = new Set<(client: Client) => void>();

/** Enregistré par `index.ts` dès la création du client, avant `login()`. */
export function definirClientActif(nouveau: Client): void {
  client = nouveau;
  for (const resoudre of enAttente) resoudre(nouveau);
  enAttente.clear();
}

/** Client de la passerelle, ou `null` si ce processus n'en tient pas. */
export function clientActif(): Client | null {
  return client;
}

/** Résout dès que le client existe (immédiatement s'il existe déjà). */
export function attendreClientActif(): Promise<Client> {
  return client ? Promise.resolve(client) : new Promise(resoudre => enAttente.add(resoudre));
}
