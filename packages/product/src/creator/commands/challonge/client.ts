import {
  backoffMs,
  drain,
  errorText,
  type Fetch,
  realSleep,
  redact,
  retryAfterMs,
  type Sleep,
} from "./http.ts";

/** API Challonge v2.1 (JSON:API). Les versions v1 et v2.0 sont dépréciées (doc consultée le 2026-10-06). */
export const API_BASE = "https://api.challonge.com/v2.1";
export const USER_AGENT = "creator-kit-challonge/0.1";

export type Auth =
  { kind: "key"; key: string } | { kind: "oauth"; token: string };
export type Method = "GET" | "POST" | "PUT" | "DELETE";
export type Query = Record<string, string | number | boolean | undefined>;

export interface RequestSpec {
  method: Method;
  path: string;
  query?: Query;
  body?: unknown;
}

export interface PlanEntry {
  method: Method;
  url: string;
  body?: unknown;
}

export interface ApiErrorDetail {
  detail?: string;
  pointer?: string;
  status?: number;
}

export class ChallongeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: ApiErrorDetail[] = [],
  ) {
    super(message);
    this.name = "ChallongeError";
  }
}

export interface Resource<A> {
  id: string;
  type?: string;
  attributes: A;
}

export interface TournamentAttrs {
  name?: string;
  url?: string;
  state?: string;
  tournament_type?: string;
  game_name?: string;
  full_challonge_url?: string;
  [key: string]: unknown;
}

export interface ParticipantAttrs {
  name?: string;
  seed?: number;
  misc?: string | null;
  username?: string | null;
  final_rank?: number | null;
  [key: string]: unknown;
}

export interface MatchAttrs {
  state?: string;
  round?: number;
  identifier?: string;
  scores?: string;
  winner_id?: number | string | null;
  points_by_participant?: {
    participant_id: number | string;
    scores?: number[];
  }[];
  relationships?: Record<string, { data?: { id: string } | null } | undefined>;
  [key: string]: unknown;
}

export type Tournament = Resource<TournamentAttrs>;
export type Participant = Resource<ParticipantAttrs>;
export type Match = Resource<MatchAttrs>;

export interface ClientOptions {
  auth?: Auth;
  fetch?: Fetch;
  sleep?: Sleep;
  random?: () => number;
  baseUrl?: string;
  /** Communauté propriétaire des tournois (paramètre `community_id`). */
  community?: string;
  maxRetries?: number;
  /** N'appelle pas l'API : enregistre le plan de requêtes via `onPlan` et répond par des valeurs factices. */
  dryRun?: boolean;
  onPlan?: (entry: PlanEntry) => void;
  onRetry?: (info: {
    status: number | "réseau";
    attempt: number;
    waitMs: number;
  }) => void;
}

/** Au-delà, une attente 429 correspond à un quota épuisé (mensuel), pas à un simple pic : inutile d'attendre. */
const MAX_RETRY_WAIT_MS = 60_000;
const PER_PAGE = 100;
const FULL_PAGE = 25;
const MAX_PAGES = 50;

const wrap = (type: string, attributes: unknown) => ({
  data: { type, attributes },
});

export class ChallongeClient {
  /** Taille de page demandée aux listes ; `undefined` = défaut de l'API (25) après un refus. */
  private perPage: number | undefined = PER_PAGE;
  /** Nombre de requêtes HTTP réellement émises (tentatives comprises) : utile face au quota mensuel. */
  requestCount = 0;
  readonly dryRun: boolean;
  private readonly auth?: Auth;
  private readonly fetchImpl: Fetch;
  private readonly sleep: Sleep;
  private readonly random: () => number;
  private readonly baseUrl: string;
  private readonly community?: string;
  private readonly maxRetries: number;
  private readonly onPlan?: (entry: PlanEntry) => void;
  private readonly onRetry?: ClientOptions["onRetry"];

  constructor(options: ClientOptions = {}) {
    this.auth = options.auth;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? realSleep;
    this.random = options.random ?? Math.random;
    this.baseUrl = options.baseUrl ?? API_BASE;
    this.community = options.community;
    this.maxRetries = options.maxRetries ?? 4;
    this.dryRun = options.dryRun ?? false;
    this.onPlan = options.onPlan;
    this.onRetry = options.onRetry;
  }

  private secret(): string | undefined {
    if (!this.auth) return undefined;
    return this.auth.kind === "key" ? this.auth.key : this.auth.token;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/vnd.api+json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
    if (this.auth?.kind === "oauth") {
      headers["Authorization-Type"] = "v2";
      headers.Authorization = `Bearer ${this.auth.token}`;
    } else if (this.auth) {
      headers["Authorization-Type"] = "v1";
      headers.Authorization = this.auth.key;
    }
    return headers;
  }

  url(spec: RequestSpec): string {
    const url = new URL(this.baseUrl + spec.path);
    for (const [key, value] of Object.entries(spec.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    if (this.community && !url.searchParams.has("community_id"))
      url.searchParams.set("community_id", this.community);
    return url.toString();
  }

  async request<T = unknown>(spec: RequestSpec): Promise<T> {
    const url = this.url(spec);
    if (this.dryRun) {
      this.onPlan?.({ method: spec.method, url, body: spec.body });
      return this.fake(spec) as T;
    }
    if (!this.auth)
      throw new ChallongeError(
        "Aucune clé API Challonge configurée (CHALLONGE_API_KEY).",
        401,
      );
    const init: RequestInit = {
      method: spec.method,
      headers: this.headers(),
      body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
    };
    // oxlint-disable no-await-in-loop -- boucle de reprise : tentatives séquentielles avec backoff et Retry-After pour respecter la limite de débit Challonge
    for (let attempt = 0; ; attempt += 1) {
      let res: Response;
      this.requestCount += 1;
      try {
        res = await this.fetchImpl(url, init);
      } catch (cause) {
        // Un POST dont on ignore s'il est arrivé n'est pas rejoué (risque de doublon).
        if (spec.method !== "POST" && attempt < this.maxRetries) {
          await this.wait("réseau", attempt, backoffMs(attempt, this.random));
          continue;
        }
        throw new ChallongeError(
          `Réseau injoignable (${redact(errorText(cause), [this.secret()])}) : vérifiez la connexion.`,
          0,
        );
      }
      if (res.ok) return (await parseJson(res)) as T;

      if (
        this.retryable(spec.method, res.status) &&
        attempt < this.maxRetries
      ) {
        const asked = retryAfterMs(res);
        const waitMs = asked ?? backoffMs(attempt, this.random);
        if (res.status === 429 && waitMs > MAX_RETRY_WAIT_MS)
          throw await this.failure(res, attempt + 1);
        await drain(res);
        await this.wait(res.status, attempt, waitMs);
        continue;
      }
      throw await this.failure(res, attempt + 1);
    }
    // oxlint-enable no-await-in-loop
  }

  private retryable(method: Method, status: number): boolean {
    if (status === 429) return true;
    if (status === 500) return method !== "POST";
    return status === 502 || status === 503 || status === 504;
  }

  private async wait(
    status: number | "réseau",
    attempt: number,
    waitMs: number,
  ): Promise<void> {
    this.onRetry?.({ status, attempt: attempt + 1, waitMs });
    await this.sleep(waitMs);
  }

  private async failure(
    res: Response,
    attempts: number,
  ): Promise<ChallongeError> {
    const details = await readErrors(res);
    return new ChallongeError(
      redact(frenchMessage(res.status, details, attempts), [this.secret()]),
      res.status,
      details,
    );
  }

  private fake(spec: RequestSpec): unknown {
    if (spec.method === "POST" && spec.path === "/tournaments") {
      const attributes = ((
        spec.body as { data?: { attributes?: TournamentAttrs } }
      )?.data?.attributes ?? {}) as TournamentAttrs;
      return {
        data: {
          id: "TOURNAMENT_ID",
          type: "tournament",
          attributes: {
            ...attributes,
            url: attributes.url ?? "TOURNAMENT_URL",
            state: "pending",
          },
        },
      };
    }
    return { data: spec.method === "GET" ? [] : null };
  }

  // --- Tournois -----------------------------------------------------------------------------------------------

  async createTournament(
    attributes: Record<string, unknown>,
  ): Promise<Tournament> {
    const res = await this.request<{ data: Tournament }>({
      method: "POST",
      path: "/tournaments",
      body: wrap("tournament", attributes),
    });
    return res.data;
  }

  async getTournament(id: string): Promise<Tournament> {
    const res = await this.request<{ data: Tournament }>({
      method: "GET",
      path: `/tournaments/${encodeURIComponent(id)}`,
    });
    return res.data;
  }

  async listTournaments(query: Query = {}): Promise<Tournament[]> {
    const res = await this.request<{ data?: Tournament[] }>({
      method: "GET",
      path: "/tournaments",
      query,
    });
    return Array.isArray(res.data) ? res.data : [];
  }

  async updateTournament(
    id: string,
    attributes: Record<string, unknown>,
  ): Promise<Tournament> {
    const res = await this.request<{ data: Tournament }>({
      method: "PUT",
      path: `/tournaments/${encodeURIComponent(id)}`,
      body: wrap("tournament", attributes),
    });
    return res.data;
  }

  /** `state` : process_checkin, abort_checkin, start_group_stage, finalize_group_stage, start, finalize, reset… */
  async changeState(id: string, state: string): Promise<Tournament> {
    const res = await this.request<{ data: Tournament }>({
      method: "PUT",
      path: `/tournaments/${encodeURIComponent(id)}/change_state`,
      body: wrap("TournamentState", { state }),
    });
    return res.data;
  }

  // --- Participants -------------------------------------------------------------------------------------------

  async addParticipant(
    id: string,
    attributes: Record<string, unknown>,
  ): Promise<Participant> {
    const res = await this.request<{ data: Participant }>({
      method: "POST",
      path: `/tournaments/${encodeURIComponent(id)}/participants`,
      body: wrap("participant", attributes),
    });
    return res.data;
  }

  /** Maximum 20 participants par requête (limite de la doc) ; l'appelant découpe. */
  async bulkAddParticipants(
    id: string,
    participants: Record<string, unknown>[],
  ): Promise<Participant[]> {
    if (participants.length === 0 || participants.length > 20)
      throw new RangeError("bulk_add accepte de 1 à 20 participants");
    const res = await this.request<{ data?: Participant[] }>({
      method: "POST",
      path: `/tournaments/${encodeURIComponent(id)}/participants/bulk_add`,
      body: wrap("Participants", { participants }),
    });
    return Array.isArray(res.data) ? res.data : [];
  }

  async randomizeParticipants(id: string): Promise<void> {
    await this.request({
      method: "PUT",
      path: `/tournaments/${encodeURIComponent(id)}/participants/randomize`,
    });
  }

  listParticipants(id: string): Promise<Participant[]> {
    return this.listAll<Participant>(
      `/tournaments/${encodeURIComponent(id)}/participants`,
    );
  }

  // --- Matchs -------------------------------------------------------------------------------------------------

  listMatches(
    id: string,
    state?: "pending" | "open" | "complete",
  ): Promise<Match[]> {
    return this.listAll<Match>(
      `/tournaments/${encodeURIComponent(id)}/matches`,
      { state },
    );
  }

  async getMatch(id: string, matchId: string): Promise<Match> {
    const res = await this.request<{ data: Match }>({
      method: "GET",
      path: `/tournaments/${encodeURIComponent(id)}/matches/${encodeURIComponent(matchId)}`,
    });
    return res.data;
  }

  async updateMatch(
    id: string,
    matchId: string,
    attributes: Record<string, unknown>,
  ): Promise<Match> {
    const res = await this.request<{ data: Match }>({
      method: "PUT",
      path: `/tournaments/${encodeURIComponent(id)}/matches/${encodeURIComponent(matchId)}`,
      body: wrap("match", attributes),
    });
    return res.data;
  }

  /**
   * Parcourt toutes les pages. Le changelog Challonge du 2026-09-14 signale que les pointeurs de pagination des
   * matchs « continuaient à l'infini » avant correction : on s'arrête sur page vide, page courte ou page déjà vue.
   */
  private async listAll<T extends { id: string }>(
    path: string,
    query: Query = {},
  ): Promise<T[]> {
    const out: T[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      let res: { data?: T[] };
      try {
        // oxlint-disable-next-line no-await-in-loop -- pagination séquentielle : la page suivante dépend de l'arrêt (page vide, courte ou déjà vue) et de la limite de débit
        res = await this.request<{ data?: T[] }>({
          method: "GET",
          path,
          query: { ...query, page, per_page: this.perPage },
        });
      } catch (error) {
        // La borne maximale de per_page n'est pas documentée : si elle est refusée, on revient à la taille par défaut (25).
        if (
          this.perPage !== undefined &&
          error instanceof ChallongeError &&
          (error.status === 400 || error.status === 422)
        ) {
          this.perPage = undefined;
          page -= 1;
          continue;
        }
        throw error;
      }
      const items = Array.isArray(res.data) ? res.data : [];
      const fresh = items.filter((item) => !seen.has(String(item.id)));
      for (const item of fresh) {
        seen.add(String(item.id));
        out.push(item);
      }
      if (this.dryRun || fresh.length === 0 || items.length < FULL_PAGE) break;
    }
    return out;
  }
}

async function parseJson(res: Response): Promise<unknown> {
  if (res.status === 204) return {};
  const text = await res.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ChallongeError(
      "Réponse Challonge illisible (JSON attendu).",
      res.status,
    );
  }
}

async function readErrors(res: Response): Promise<ApiErrorDetail[]> {
  let body: unknown;
  try {
    body = JSON.parse(await res.text());
  } catch {
    return [];
  }
  const errors = (body as { errors?: unknown })?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 10).map((entry): ApiErrorDetail => {
    if (typeof entry === "string") return { detail: entry.slice(0, 300) };
    const item = entry as {
      detail?: unknown;
      status?: unknown;
      source?: { pointer?: unknown };
    };
    return {
      detail:
        typeof item.detail === "string" ? item.detail.slice(0, 300) : undefined,
      status: typeof item.status === "number" ? item.status : undefined,
      pointer:
        typeof item.source?.pointer === "string"
          ? item.source.pointer
          : undefined,
    };
  });
}

function field(pointer: string): string {
  return pointer.replace(/^\/data\/attributes\//, "").replace(/\//g, ".");
}

function describeDetails(details: ApiErrorDetail[]): string {
  return details
    .map(
      (d) =>
        `${d.pointer ? `${field(d.pointer)} : ` : ""}${d.detail ?? "erreur sans détail"}`,
    )
    .join(" ; ");
}

/** Messages d'erreur en français. L'éventuel détail renvoyé par l'API est conservé tel quel (en anglais). */
export function frenchMessage(
  status: number,
  details: ApiErrorDetail[],
  attempts: number,
): string {
  const extra = details.length
    ? ` Détail API : ${describeDetails(details)}.`
    : "";
  switch (status) {
    case 400:
      return `Requête refusée par Challonge (400).${extra}`;
    case 401:
      return (
        "Clé API refusée (401) : vérifiez CHALLONGE_API_KEY (clé à créer sur https://challonge.com/settings/developer, " +
        "compte à e-mail vérifié) ou le jeton OAuth, puis réessayez."
      );
    case 403:
      return "Accès refusé (403) : ce compte ou jeton n'a pas les droits sur cette ressource (portée OAuth manquante, ou tournoi d'une communauté : essayez --community).";
    case 404:
      return "Introuvable (404) : tournoi, match ou participant inconnu pour ce compte (identifiant faux, ou tournoi de communauté : essayez --community).";
    case 406:
    case 415:
      return `Format refusé (${status}) : l'API rejette les en-têtes Accept/Content-Type (bug de creator-kit, à signaler).`;
    case 422: {
      const slug = details.some(
        (d) =>
          /url|permalink/i.test(`${d.pointer ?? ""} ${d.detail ?? ""}`) &&
          /taken|already|exist|unique/i.test(d.detail ?? ""),
      );
      return `Données refusées (422).${extra}${slug ? " L'URL (slug) demandée est déjà prise : choisissez une autre valeur pour --url." : ""}`;
    }
    case 429:
      return (
        `Limite de requêtes atteinte (429) après ${attempts} tentative(s). L'offre gratuite de Challonge est plafonnée à ` +
        "500 requêtes par mois et par application (doc du 2026-10-06) : consultez l'usage sur https://connect.challonge.com " +
        "ou réessayez plus tard."
      );
    default:
      if (status >= 500)
        return `Erreur côté Challonge (${status}) après ${attempts} tentative(s) : réessayez plus tard.${extra}`;
      return `Erreur HTTP ${status} renvoyée par Challonge.${extra}`;
  }
}
