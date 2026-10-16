import { backoffMs, errorText, realSleep, type Sleep } from "./http.ts";

/**
 * Client minimal de la Gateway Discord v10 (JSON, sans compression) au-dessus du WebSocket de Bun.
 * Vérifié contre la documentation officielle (discord-api-docs, consultée le 2026-10-06) : opcodes 0/1/2/6/7/9/10/11,
 * premier battement après `heartbeat_interval * jitter`, ACK obligatoire, IDENTIFY puis READY, RESUME sur
 * `resume_gateway_url`, codes de fermeture 4004/4010-4014 non reconnectables.
 */
export const GATEWAY_VERSION = 10;
export const FALLBACK_GATEWAY = "wss://gateway.discord.gg";
/** GUILDS (1 << 0) : INTERACTION_CREATE n'est rattaché à aucun intent, aucun intent privilégié n'est requis. */
export const INTENT_GUILDS = 1 << 0;

export const Op = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
} as const;

/** Codes de fermeture après lesquels reconnecter est inutile (doc « Opcodes and Status Codes »). */
const FATAL_CLOSE = new Set([4004, 4010, 4011, 4012, 4013, 4014]);
/** Session perdue : il faut un nouvel IDENTIFY (le RESUME serait refusé). */
const NEW_SESSION_CLOSE = new Set([4003, 4007, 4009]);
/** Fermeture initiée par nous qui garde la session valide (tout code sauf 1000/1001). */
const RESUMABLE_CLOSE = 4000;

export class GatewayFatalError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "GatewayFatalError";
  }
}

export interface GatewayOptions {
  token: string;
  intents?: number;
  /** URL WSS initiale (typiquement `GET /gateway/bot`), mise en cache ; rappelée si la connexion échoue. */
  getUrl: () => Promise<string>;
  onDispatch: (event: string, data: unknown) => void;
  onReady?: (data: {
    session_id: string;
    user?: { id: string };
    application?: { id: string };
  }) => void;
  WebSocketImpl?: typeof WebSocket;
  random?: () => number;
  sleep?: Sleep;
  log?: (message: string) => void;
  signal?: AbortSignal;
  properties?: { os: string; browser: string; device: string };
}

type Outcome =
  | { kind: "stop" }
  | { kind: "fatal"; code: number }
  | { kind: "resume"; delayMs?: number }
  | { kind: "identify"; delayMs?: number };

interface Payload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

export class Gateway {
  private seq: number | null = null;
  private session?: { id: string; resumeUrl: string };
  private cachedUrl?: string;
  /** Vrai une fois READY/RESUMED reçu sur la connexion courante : remet le backoff à zéro. */
  private stable = false;

  constructor(private readonly options: GatewayOptions) {}

  private get random(): () => number {
    return this.options.random ?? Math.random;
  }

  private get sleep(): Sleep {
    return this.options.sleep ?? realSleep;
  }

  private log(message: string): void {
    this.options.log?.(message);
  }

  /** Boucle de connexion : se termine à l'arrêt (`signal`) ou lève `GatewayFatalError` (token/intents invalides). */
  async run(): Promise<void> {
    let attempt = 0;
    while (!this.options.signal?.aborted) {
      let outcome: Outcome;
      this.stable = false;
      try {
        // oxlint-disable-next-line no-await-in-loop -- reconnection loop: the URL is resolved before each connection attempt, after the previous one ended
        const base = await this.connectionBase();
        // oxlint-disable-next-line no-await-in-loop -- reconnection loop: each connection must finish (or be abandoned) before the next one starts
        outcome = await this.connect(withParams(base));
      } catch (error) {
        if (error instanceof GatewayFatalError) throw error;
        this.log(`Connexion Gateway impossible : ${errorText(error)}`);
        this.cachedUrl = undefined;
        outcome = { kind: this.session ? "resume" : "identify" };
      }
      if (outcome.kind === "stop") return;
      if (outcome.kind === "fatal")
        throw new GatewayFatalError(outcome.code, fatalMessage(outcome.code));
      if (outcome.kind === "identify") {
        this.session = undefined;
        this.seq = null;
      }
      if (this.stable) attempt = 0;
      const delay = outcome.delayMs ?? backoffMs(attempt, this.random);
      attempt += 1;
      this.log(`Reconnexion Gateway (${outcome.kind}) dans ${delay} ms.`);
      // oxlint-disable-next-line no-await-in-loop -- reconnection backoff: the next connection waits for this delay
      await this.abortableSleep(delay);
    }
  }

  /** URL de connexion : `resume_gateway_url` pendant une session, sinon l'URL Gateway (récupérée une fois). */
  private async connectionBase(): Promise<string> {
    return this.session ? this.session.resumeUrl : (this.cachedUrl ??= await this.options.getUrl());
  }

  private async abortableSleep(ms: number): Promise<void> {
    const { signal } = this.options;
    if (!signal) return this.sleep(ms);
    if (signal.aborted) return;
    await Promise.race([
      this.sleep(ms),
      new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      ),
    ]);
  }

  private connect(url: string): Promise<Outcome> {
    const WS = this.options.WebSocketImpl ?? WebSocket;
    return new Promise<Outcome>((resolve) => {
      const ws = new WS(url);
      let settled = false;
      let forced: Outcome | undefined;
      let acked = true;
      let firstBeat: ReturnType<typeof setTimeout> | undefined;
      let beat: ReturnType<typeof setInterval> | undefined;
      let fallback: ReturnType<typeof setTimeout> | undefined;

      const finish = (outcome: Outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(firstBeat);
        clearInterval(beat);
        clearTimeout(fallback);
        this.options.signal?.removeEventListener("abort", onAbort);
        resolve(outcome);
      };
      const send = (payload: Payload) => {
        try {
          ws.send(JSON.stringify(payload));
        } catch (error) {
          this.log(`Envoi Gateway impossible : ${errorText(error)}`);
        }
      };
      /** Ferme nous-mêmes la connexion ; la boucle s'appuie sur `outcome` même si l'événement close tarde. */
      const closeWith = (code: number, outcome: Outcome) => {
        forced ??= outcome;
        clearTimeout(fallback);
        try {
          ws.close(code);
        } catch {
          finish(forced);
          return;
        }
        fallback = setTimeout(() => finish(forced!), 3000);
      };
      const heartbeat = () => {
        if (!acked) {
          // Pas d'ACK depuis le dernier battement : connexion « zombie » (doc : fermer avec un code autre que 1000/1001, puis reprendre).
          this.log("Pas d'ACK de heartbeat : connexion zombie, reprise.");
          closeWith(RESUMABLE_CLOSE, { kind: "resume" });
          return;
        }
        acked = false;
        send({ op: Op.Heartbeat, d: this.seq });
      };
      const onAbort = () => {
        forced = { kind: "stop" };
        try {
          ws.close(1000);
        } catch {
          // déjà fermé
        }
        finish({ kind: "stop" });
      };
      this.options.signal?.addEventListener("abort", onAbort, { once: true });

      ws.addEventListener("message", (event: MessageEvent) => {
        let payload: Payload;
        try {
          payload = JSON.parse(String(event.data)) as Payload;
        } catch {
          return;
        }
        if (typeof payload.s === "number") this.seq = payload.s;
        switch (payload.op) {
          case Op.Hello: {
            const interval = Number(
              (payload.d as { heartbeat_interval?: number })?.heartbeat_interval ?? 41_250,
            );
            // Premier battement après interval * jitter (0..1), puis un par intervalle.
            firstBeat = setTimeout(
              () => {
                heartbeat();
                beat = setInterval(heartbeat, interval);
              },
              Math.floor(interval * this.random()),
            );
            if (this.session && this.seq !== null) {
              send({
                op: Op.Resume,
                d: { token: this.options.token, session_id: this.session.id, seq: this.seq },
              });
            } else {
              send({
                op: Op.Identify,
                d: {
                  token: this.options.token,
                  intents: this.options.intents ?? INTENT_GUILDS,
                  properties: this.options.properties ?? {
                    os: process.platform,
                    browser: "creator-kit",
                    device: "creator-kit",
                  },
                },
              });
            }
            break;
          }
          case Op.HeartbeatAck:
            acked = true;
            break;
          case Op.Heartbeat:
            send({ op: Op.Heartbeat, d: this.seq });
            break;
          case Op.Reconnect:
            closeWith(RESUMABLE_CLOSE, { kind: "resume" });
            break;
          case Op.InvalidSession: {
            const resumable = payload.d === true;
            // Pause aléatoire de 1 à 5 s avant de rouvrir (usage recommandé par Discord pour étaler les reconnexions).
            const delayMs = 1000 + Math.floor(this.random() * 4000);
            closeWith(RESUMABLE_CLOSE, {
              kind: resumable && this.session ? "resume" : "identify",
              delayMs,
            });
            break;
          }
          case Op.Dispatch:
            this.dispatch(payload);
            if (payload.t === "READY" || payload.t === "RESUMED") this.stable = true;
            break;
          default:
            break;
        }
      });
      ws.addEventListener("error", () => this.log("Erreur WebSocket Gateway."));
      ws.addEventListener("close", (event: CloseEvent) => {
        if (settled) return;
        finish(forced ?? this.outcomeForClose(event.code));
      });
    });
  }

  private dispatch(payload: Payload): void {
    const name = payload.t ?? "";
    if (name === "READY") {
      const data = payload.d as {
        session_id: string;
        resume_gateway_url: string;
        user?: { id: string };
        application?: { id: string };
      };
      this.session = {
        id: data.session_id,
        resumeUrl: data.resume_gateway_url || this.cachedUrl || FALLBACK_GATEWAY,
      };
      this.options.onReady?.(data);
      return;
    }
    if (name === "RESUMED") return;
    try {
      this.options.onDispatch(name, payload.d);
    } catch (error) {
      this.log(`Erreur dans le gestionnaire ${name} : ${errorText(error)}`);
    }
  }

  private outcomeForClose(code: number): Outcome {
    if (FATAL_CLOSE.has(code)) return { kind: "fatal", code };
    if (NEW_SESSION_CLOSE.has(code)) return { kind: "identify" };
    return { kind: this.session ? "resume" : "identify" };
  }
}

function withParams(base: string): string {
  const url = new URL(base);
  url.searchParams.set("v", String(GATEWAY_VERSION));
  url.searchParams.set("encoding", "json");
  return url.toString();
}

function fatalMessage(code: number): string {
  switch (code) {
    case 4004:
      return "Gateway Discord : token refusé (4004). Vérifiez DISCORD_TOKEN.";
    case 4013:
      return "Gateway Discord : intents invalides (4013).";
    case 4014:
      return "Gateway Discord : intents non autorisés (4014). Activez-les dans le Developer Portal.";
    case 4011:
      return "Gateway Discord : sharding requis (4011) : le bot est présent sur trop de serveurs pour cette version.";
    default:
      return `Gateway Discord : fermeture définitive (code ${code}).`;
  }
}
