import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface TournamentRef {
  id: string;
  url?: string;
  name?: string;
  bracketUrl?: string;
  community?: string;
}

export interface PlayerRef {
  participantId: string;
  name: string;
}

export interface BotState {
  version: 1;
  /** Dernier tournoi créé ou utilisé par la CLI (évite de répéter --tournament). */
  lastTournament?: TournamentRef;
  /** Tournoi actif par serveur Discord. */
  guilds: Record<string, { tournament?: TournamentRef }>;
  /** tournoi Challonge -> utilisateur Discord -> participant Challonge. */
  players: Record<string, Record<string, PlayerRef>>;
  /** Inscriptions Discord en attente d'envoi groupé (mode batchRegistrations). */
  pending: Record<string, Record<string, { name: string; at?: number }>>;
}

export const STATE_FILE = "challonge-state.json";

export function defaultStatePath(dir: string): string {
  return join(dir, STATE_FILE);
}

function empty(): BotState {
  return { version: 1, guilds: {}, players: {}, pending: {} };
}

/**
 * Petit magasin JSON : lectures-modifications sérialisées en mémoire, écriture atomique
 * (fichier temporaire puis rename) pour qu'un arrêt brutal ne laisse jamais un fichier tronqué.
 */
export class StateStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(readonly path: string) {}

  async read(): Promise<BotState> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return empty();
      throw error;
    }
    let data: Partial<BotState>;
    try {
      data = JSON.parse(text) as Partial<BotState>;
    } catch {
      throw new Error(
        `Fichier d'état illisible : ${this.path} (corrigez-le ou supprimez-le ; les tournois restent sur Challonge).`,
      );
    }
    return { ...empty(), ...data, version: 1 };
  }

  /** Applique `change` sur l'état courant, puis écrit atomiquement ; les appels concurrents sont mis en file. */
  update<T>(change: (state: BotState) => T | Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const state = await this.read();
      const result = await change(state);
      await this.write(state);
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async write(state: BotState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(tmp, this.path);
  }
}
