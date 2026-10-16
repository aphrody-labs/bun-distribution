/**
 * Transport HTTP du client Achilléa — isomorphe et sans framework.
 *
 * Contraintes tenues par ce module :
 * - aucun import `node:*` / `bun:*`, aucun accès à `window` / `document` /
 *   `localStorage` : le paquet s'importe tel quel dans un React Server
 *   Component, dans un navigateur et dans Bun ;
 * - aucune exception levée sur une erreur réseau, HTTP ou de schéma : tout
 *   sort sous la forme d'un `AchilleaClientResult<T>` discriminé ;
 * - toute réponse est validée par un schéma zod avant d'être rendue, pour
 *   qu'une dérive de contrat côté API se voie tout de suite.
 */

import type { z } from "zod";

/** Origine par défaut de l'API (préfixe `/api` inclus). */
export const DEFAULT_ACHILLEA_API_URL = "https://ranked.rosegriffon.fr/api";

/** Délai au-delà duquel une requête est abandonnée. */
export const DEFAULT_ACHILLEA_TIMEOUT_MS = 8000;

export type AchilleaClientFailure =
  | { ok: false; kind: "unreachable"; detail: string; path: string }
  | { ok: false; kind: "http"; detail: string; path: string; status: number }
  | { ok: false; kind: "invalid_json"; detail: string; path: string }
  | { ok: false; kind: "invalid_response"; detail: string; path: string };

export type AchilleaClientResult<T> = { ok: true; value: T } | AchilleaClientFailure;

export type AchilleaFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * Mode d'envoi des cookies. Recopié de la lib DOM plutôt qu'importé : le
 * paquet doit rester compilable dans un `tsconfig` sans `lib: ["DOM"]`
 * (`apps/bot` n'en a pas), alors que `RequestCredentials` n'y existe pas.
 */
export type AchilleaCredentials = "omit" | "same-origin" | "include";

/**
 * Stockage de jeton injecté — le paquet n'accède jamais lui-même à un stockage
 * de plateforme (`localStorage`, cookies, Keychain…). L'appelant fournit
 * l'implémentation qui convient à son runtime.
 */
export interface AchilleaTokenStore {
  getToken(): string | null | Promise<string | null>;
  setToken?(token: string | null): void | Promise<void>;
}

export interface AchilleaClientOptions {
  /** Origine de l'API, préfixe de chemin inclus. Les `/` finaux sont ignorés. */
  baseUrl?: string;
  /** Abandon de la requête après cette durée. 8 secondes par défaut. */
  timeoutMs?: number;
  /** Implémentation de Fetch injectable (runtimes non-navigateur et tests). */
  fetch?: AchilleaFetch;
  /**
   * Mode d'envoi des cookies (`"include"` pour la session Achilléa servie en
   * cookie HttpOnly depuis un navigateur).
   */
  credentials?: AchilleaCredentials;
  /** Jeton porteur (`Authorization: Bearer …`). Prioritaire sur `tokenStore`. */
  getAuthToken?: () => string | null | Promise<string | null>;
  /** Source de jeton alternative, sous forme d'interface injectée. */
  tokenStore?: AchilleaTokenStore;
  /** En-têtes ajoutés à chaque requête (traçage, langue…). */
  headers?: Readonly<Record<string, string>>;
}

export type QueryPrimitive = string | number | boolean;

export type QueryValue = QueryPrimitive | Date | null | undefined | readonly QueryPrimitive[];

/** Paramètres de query-string : les `undefined` / `null` sont omis. */
export type QueryParams = Readonly<Record<string, QueryValue>>;

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  query?: QueryParams;
  /** Corps sérialisé en JSON. Ignoré si `rawBody` est fourni. */
  body?: unknown;
  /** Corps déjà sérialisé (upload d'une capture encodée en base64). */
  rawBody?: string;
  /** Corps multipart (upload de fichier). Le `Content-Type` est laissé au runtime. */
  formData?: FormData;
  /** `Content-Type` du `rawBody`. */
  contentType?: string;
  /** En-têtes propres à cet appel. */
  headers?: Readonly<Record<string, string>>;
  /** Valeur d'`Accept`. `application/json` par défaut. */
  accept?: string;
  /** Délai spécifique à cet appel. */
  timeoutMs?: number;
  /** Signal d'annulation fourni par l'appelant — remplace le délai interne. */
  signal?: AbortSignal;
}

/** Encode un segment de chemin (jamais de `/` qui s'échapperait de la route). */
export function encodePathSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

/**
 * Sérialise des paramètres de requête. Les tableaux sont répétés
 * (`states=Ongoing&states=Finished`), comme les attend le back TSed.
 */
export function encodeQuery(params?: QueryParams): string {
  if (!params) return "";

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value as readonly QueryPrimitive[]) search.append(key, String(item));
      continue;
    }
    search.append(key, value instanceof Date ? value.toISOString() : String(value));
  }

  const encoded = search.toString();
  return encoded.length > 0 ? `?${encoded}` : "";
}

/** Assemble chemin + query-string. C'est cette valeur qui est reportée dans les échecs. */
export function joinPath(path: string, params?: QueryParams): string {
  return `${path}${encodeQuery(params)}`;
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validationDetail(error: z.ZodError): string {
  const firstIssue = error.issues[0];
  if (!firstIssue) return "unexpected response structure";
  return `${firstIssue.path.join(".") || "(root)"} : ${firstIssue.message}`;
}

/**
 * Client HTTP bas niveau. Les ressources de domaine (`TournamentsResource`,
 * `RankedResource`…) s'appuient toutes dessus et n'ont aucune logique réseau.
 */
export class AchilleaHttp {
  readonly baseUrl: string;
  readonly timeoutMs: number;
  readonly fetch: AchilleaFetch;
  readonly credentials: AchilleaCredentials | undefined;
  readonly defaultHeaders: Readonly<Record<string, string>>;

  private readonly getAuthToken: (() => string | null | Promise<string | null>) | undefined;

  constructor(options: AchilleaClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_ACHILLEA_API_URL).replace(/\/+$/u, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_ACHILLEA_TIMEOUT_MS;
    // Browsers require the native fetch receiver to remain Window. Calling a
    // stored reference as this.fetch(...) otherwise throws Illegal invocation
    // before a request is sent.
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.credentials = options.credentials;
    this.defaultHeaders = options.headers ?? {};

    const store = options.tokenStore;
    this.getAuthToken = options.getAuthToken ?? (store ? () => store.getToken() : undefined);
  }

  /** URL absolue d'une route — utile pour un `<img>`, un PDF ou une redirection OAuth. */
  url(path: string, params?: QueryParams): string {
    return `${this.baseUrl}${joinPath(path, params)}`;
  }

  /**
   * Exécute la requête et rend la `Response` brute si le statut est 2xx.
   * Ni le corps ni le type de contenu ne sont interprétés ici.
   */
  async request(path: string, options: RequestOptions = {}): Promise<AchilleaClientResult<Response>> {
    const fullPath = joinPath(path, options.query);
    const headers: Record<string, string> = {
      Accept: options.accept ?? "application/json",
      ...this.defaultHeaders,
      ...options.headers,
    };

    // Le multipart passe tel quel : c'est le runtime qui pose la frontière
    // (`boundary`) dans le `Content-Type`, jamais nous.
    let payload: string | FormData | undefined;
    if (options.formData !== undefined) {
      payload = options.formData;
    } else if (options.rawBody !== undefined) {
      payload = options.rawBody;
      headers["Content-Type"] = options.contentType ?? "text/plain";
    } else if (options.body !== undefined) {
      payload = JSON.stringify(options.body);
      headers["Content-Type"] = options.contentType ?? "application/json";
    }

    if (this.getAuthToken) {
      try {
        const token = await this.getAuthToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
      } catch (error) {
        return { ok: false, kind: "unreachable", detail: errorDetail(error), path: fullPath };
      }
    }

    const init: RequestInit = {
      method: options.method ?? "GET",
      headers,
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs),
    };
    if (payload !== undefined) init.body = payload;
    if (this.credentials !== undefined) init.credentials = this.credentials;

    let response: Response;
    try {
      response = await this.fetch(`${this.baseUrl}${fullPath}`, init);
    } catch (error) {
      return { ok: false, kind: "unreachable", detail: errorDetail(error), path: fullPath };
    }

    if (!response.ok) {
      return {
        ok: false,
        kind: "http",
        detail: `HTTP ${response.status} for ${fullPath}`,
        path: fullPath,
        status: response.status,
      };
    }

    return { ok: true, value: response };
  }

  /** Exécute la requête, lit le JSON, puis valide la réponse contre `schema`. */
  async requestJson<T>(
    path: string,
    schema: z.ZodType<T>,
    options: RequestOptions = {},
  ): Promise<AchilleaClientResult<T>> {
    const fullPath = joinPath(path, options.query);
    const response = await this.request(path, options);
    if (!response.ok) return response;

    let body: unknown;
    try {
      body = await response.value.json();
    } catch (error) {
      return {
        ok: false,
        kind: "invalid_json",
        detail: `unreadable response: ${errorDetail(error)}`,
        path: fullPath,
      };
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return {
        ok: false,
        kind: "invalid_response",
        detail: validationDetail(parsed.error),
        path: fullPath,
      };
    }

    return { ok: true, value: parsed.data };
  }

  /** Réponses `text/plain` (exposition Prometheus, statut racine de l'API). */
  async requestText(path: string, options: RequestOptions = {}): Promise<AchilleaClientResult<string>> {
    const fullPath = joinPath(path, options.query);
    const response = await this.request(path, { accept: "text/plain", ...options });
    if (!response.ok) return response;

    try {
      return { ok: true, value: await response.value.text() };
    } catch (error) {
      return {
        ok: false,
        kind: "invalid_json",
        detail: `unreadable response: ${errorDetail(error)}`,
        path: fullPath,
      };
    }
  }

  /** Réponses binaires (carte joueur PNG, affiche de clan, PDF de licence). */
  async requestBytes(path: string, options: RequestOptions = {}): Promise<AchilleaClientResult<ArrayBuffer>> {
    const fullPath = joinPath(path, options.query);
    const response = await this.request(path, { accept: "*/*", ...options });
    if (!response.ok) return response;

    try {
      return { ok: true, value: await response.value.arrayBuffer() };
    } catch (error) {
      return {
        ok: false,
        kind: "invalid_json",
        detail: `unreadable response: ${errorDetail(error)}`,
        path: fullPath,
      };
    }
  }

  get<T>(
    path: string,
    schema: z.ZodType<T>,
    options: Omit<RequestOptions, "method" | "body" | "rawBody"> = {},
  ): Promise<AchilleaClientResult<T>> {
    return this.requestJson(path, schema, { ...options, method: "GET" });
  }

  post<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<AchilleaClientResult<T>> {
    return this.requestJson(path, schema, { ...options, method: "POST", body: body ?? {} });
  }

  put<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<AchilleaClientResult<T>> {
    return this.requestJson(path, schema, { ...options, method: "PUT", body: body ?? {} });
  }

  patch<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<AchilleaClientResult<T>> {
    return this.requestJson(path, schema, { ...options, method: "PATCH", body: body ?? {} });
  }

  delete<T>(
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
    options: Omit<RequestOptions, "method" | "body"> = {},
  ): Promise<AchilleaClientResult<T>> {
    const init: RequestOptions = { ...options, method: "DELETE" };
    if (body !== undefined) init.body = body;
    return this.requestJson(path, schema, init);
  }
}

/** Socle commun aux ressources de domaine : elles ne portent que des routes. */
export abstract class AchilleaResource {
  protected readonly http: AchilleaHttp;

  constructor(http: AchilleaHttp) {
    this.http = http;
  }
}
