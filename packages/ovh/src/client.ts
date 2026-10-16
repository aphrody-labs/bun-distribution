// SPDX-License-Identifier: Apache-2.0
/**
 * Pure Bun OVH API Client (Native replacement for node-ovh / @ovh-api).
 *
 * Two authentication modes, chosen at construction:
 *  - `oauth2`: service account (client credentials) -> short-lived Bearer token, cached in memory,
 *    renewed 60 s before expiry and on HTTP 401. Also serves the IAM API v2.
 *  - `application_key`: legacy application key/secret + consumer key SHA-1 request signing, with
 *    automatic server time drift compensation.
 * Secrets never appear in errors, `toString` or `JSON.stringify` output.
 */

import { createHash } from "node:crypto";

export type OvhEndpoint =
  | "ovh-eu"
  | "ovh-ca"
  | "ovh-us"
  | "kimsufi-eu"
  | "kimsufi-ca"
  | "soyoustart-eu"
  | "soyoustart-ca";

export const ENDPOINT_URLS: Record<OvhEndpoint, string> = {
  "ovh-eu": "https://eu.api.ovh.com/1.0",
  "ovh-ca": "https://ca.api.ovh.com/1.0",
  "ovh-us": "https://api.us.ovhcloud.com/1.0",
  "kimsufi-eu": "https://eu.api.kimsufi.com/1.0",
  "kimsufi-ca": "https://ca.api.kimsufi.com/1.0",
  "soyoustart-eu": "https://eu.api.soyoustart.com/1.0",
  "soyoustart-ca": "https://ca.api.soyoustart.com/1.0",
};

/** OAuth2 token endpoints of the official OVHcloud SDKs (python-ovh, go-ovh). */
export const OAUTH2_TOKEN_URLS: Partial<Record<OvhEndpoint, string>> = {
  "ovh-eu": "https://www.ovh.com/auth/oauth2/token",
  "ovh-ca": "https://ca.ovh.com/auth/oauth2/token",
  "ovh-us": "https://us.ovhcloud.com/auth/oauth2/token",
};

/** Refresh the OAuth2 access token this many seconds before it expires. */
export const TOKEN_REFRESH_MARGIN_SEC = 60;

export type OvhAuthMode = "oauth2" | "application_key";

/** Replaces the `/1.0` suffix of a base URL by `/v2` (IAM and other v2 APIs). */
export function v2BaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/1\.0$/, "/v2");
}

/**
 * Picks the authentication mode from what is available: a complete OAuth2 pair wins over the
 * application key triplet. Returns null when neither is complete.
 */
export function selectAuthMode(parts: {
  clientId?: string;
  clientSecret?: string;
  applicationKey?: string;
  applicationSecret?: string;
  consumerKey?: string;
}): OvhAuthMode | null {
  if (parts.clientId && parts.clientSecret) return "oauth2";
  if (parts.applicationKey && parts.applicationSecret && parts.consumerKey)
    return "application_key";
  return null;
}

export interface OvhClientOptions {
  /** OAuth2 service account (client credentials); takes priority over the application triplet. */
  clientId?: string;
  clientSecret?: string;
  applicationKey?: string;
  applicationSecret?: string;
  consumerKey?: string;
  endpoint?: OvhEndpoint | string;
  /** Overrides the OAuth2 token URL (tests, custom endpoints). */
  tokenUrl?: string;
  timeoutMs?: number;
  /** Clock in milliseconds (tests). */
  now?: () => number;
}

export type OvhApiVersion = "1.0" | "v2";
type Method = "GET" | "POST" | "PUT" | "DELETE";
type Query = Record<string, string | number | boolean | undefined>;

export class OvhApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly ovhMessage: string,
    public readonly httpMethod: string,
    public readonly path: string,
    public readonly rawResponse?: unknown,
  ) {
    super(`OVH ${httpMethod} ${path} -> HTTP ${statusCode}: ${ovhMessage}`);
    this.name = "OvhApiError";
  }
}

/**
 * Computes SHA1 hex digest using Bun native hasher when available, or node:crypto fallback.
 */
export function sha1(content: string): string {
  if (
    typeof Bun !== "undefined" &&
    typeof (Bun as { CryptoHasher?: unknown }).CryptoHasher === "function"
  ) {
    const hasher = new Bun.CryptoHasher("sha1");
    hasher.update(content);
    return hasher.digest("hex");
  }
  return createHash("sha1").update(content).digest("hex");
}

export class OvhClient {
  public readonly authMode: OvhAuthMode;
  public readonly applicationKey: string;
  public readonly applicationSecret: string;
  public readonly consumerKey: string;
  public readonly baseUrl: string;
  public readonly baseUrlV2: string;
  public readonly timeoutMs: number;
  public readonly tokenUrl: string;

  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #now: () => number;
  #token: { value: string; expiresAtMs: number } | null = null;
  #tokenInFlight: Promise<string> | null = null;
  private timeDeltaSec: number = 0;
  private timeSynced: boolean = false;

  constructor(options: OvhClientOptions) {
    const mode = selectAuthMode(options);
    if (!mode) {
      throw new Error(
        "OvhClient: missing credentials (clientId+clientSecret, or applicationKey+applicationSecret+consumerKey)",
      );
    }
    this.authMode = mode;
    this.#clientId = (options.clientId ?? "").trim();
    this.#clientSecret = (options.clientSecret ?? "").trim();
    this.applicationKey = (options.applicationKey ?? "").trim();
    this.applicationSecret = (options.applicationSecret ?? "").trim();
    this.consumerKey = (options.consumerKey ?? "").trim();
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.#now = options.now ?? Date.now;

    const endpoint = options.endpoint ?? "ovh-eu";
    this.baseUrl =
      (ENDPOINT_URLS as Record<string, string>)[endpoint] ??
      (endpoint.startsWith("http") ? endpoint : ENDPOINT_URLS["ovh-eu"]);
    this.baseUrlV2 = v2BaseUrl(this.baseUrl);

    const tokenUrl =
      options.tokenUrl ?? OAUTH2_TOKEN_URLS[endpoint as OvhEndpoint];
    if (mode === "oauth2" && !tokenUrl) {
      throw new Error(
        `OvhClient: no OAuth2 token URL for endpoint '${endpoint}'; pass tokenUrl`,
      );
    }
    this.tokenUrl = tokenUrl ?? "";
  }

  /** Never serialise secrets: only the mode and base URL are exposed. */
  public toJSON(): { authMode: OvhAuthMode; baseUrl: string } {
    return { authMode: this.authMode, baseUrl: this.baseUrl };
  }

  /** Cached access token, renewed 60 s before expiry (or when forced). */
  public async accessToken(force = false): Promise<string> {
    if (this.authMode !== "oauth2")
      throw new Error("OvhClient: access tokens need OAuth2 mode");
    if (
      !force &&
      this.#token &&
      this.#now() < this.#token.expiresAtMs - TOKEN_REFRESH_MARGIN_SEC * 1000
    ) {
      return this.#token.value;
    }
    if (!force && this.#tokenInFlight) return this.#tokenInFlight;
    const pending = this.#fetchToken().finally(() => {
      if (this.#tokenInFlight === pending) this.#tokenInFlight = null;
    });
    this.#tokenInFlight = pending;
    return pending;
  }

  /** Drops the cached token (next call fetches a new one). */
  public invalidateToken(): void {
    this.#token = null;
  }

  async #fetchToken(): Promise<string> {
    const response = await fetch(this.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
        scope: "all",
      }).toString(),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    let json: {
      access_token?: unknown;
      expires_in?: unknown;
      error?: unknown;
    } = {};
    try {
      json = JSON.parse(text);
    } catch {
      // handled below
    }
    if (!response.ok || typeof json.access_token !== "string") {
      // Only the OAuth2 error code is surfaced, never the request or the raw body.
      const code =
        typeof json.error === "string" ? json.error : "unexpected_response";
      throw new OvhApiError(
        response.status,
        `OAuth2 token request failed (${code})`,
        "POST",
        "/auth/oauth2/token",
      );
    }
    const ttlSec = Number(json.expires_in);
    this.#token = {
      value: json.access_token,
      expiresAtMs:
        this.#now() +
        (Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 3600) * 1000,
    };
    return json.access_token;
  }

  /**
   * Synchronizes server time drift with OVH API (/auth/time).
   */
  public async syncTime(): Promise<number> {
    try {
      const resp = await fetch(`${this.baseUrl}/auth/time`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (resp.ok) {
        const serverTime = Number(await resp.text());
        if (!Number.isNaN(serverTime) && serverTime > 0) {
          const localTime = Math.floor(Date.now() / 1000);
          this.timeDeltaSec = serverTime - localTime;
          this.timeSynced = true;
          return this.timeDeltaSec;
        }
      }
    } catch {
      // In offline / unit test environments, retain current offset.
    }
    return this.timeDeltaSec;
  }

  /**
   * Computes the current server-aligned timestamp in seconds.
   */
  public getTimestamp(): number {
    return Math.floor(Date.now() / 1000) + this.timeDeltaSec;
  }

  /**
   * Generates signature string for an OVH API request.
   * Format: $1$ + SHA1(applicationSecret + "+" + consumerKey + "+" + method + "+" + url + "+" + body + "+" + timestamp)
   */
  public sign(
    method: string,
    url: string,
    bodyStr: string,
    timestamp: number,
  ): string {
    const raw = `${this.applicationSecret}+${this.consumerKey}+${method.toUpperCase()}+${url}+${bodyStr}+${timestamp}`;
    return `$1$${sha1(raw)}`;
  }

  /**
   * Dispatches an HTTP request with OVH signature authentication.
   */
  public async request<T = unknown>(
    method: Method,
    path: string,
    body?: unknown,
    query?: Query,
    version: OvhApiVersion = "1.0",
  ): Promise<T> {
    if (method === "GET" && body !== undefined)
      throw new TypeError("OVH GET requests cannot have a body");
    if (this.authMode === "application_key" && !this.timeSynced) {
      await this.syncTime();
    }

    return this.executeWithRetry<T>(method, path, body, query, true, version);
  }

  private async executeWithRetry<T>(
    method: Method,
    path: string,
    body?: unknown,
    query?: Query,
    allowRetry: boolean = true,
    version: OvhApiVersion = "1.0",
  ): Promise<T> {
    let normalizedPath = path.startsWith("/") ? path : `/${path}`;
    if (query) {
      const searchParams = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined) {
          searchParams.append(k, String(v));
        }
      }
      const qs = searchParams.toString();
      if (qs) {
        normalizedPath += (normalizedPath.includes("?") ? "&" : "?") + qs;
      }
    }

    const fullUrl = `${version === "v2" ? this.baseUrlV2 : this.baseUrl}${normalizedPath}`;
    const bodyStr = body === undefined ? "" : JSON.stringify(body);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.authMode === "oauth2") {
      headers.Authorization = `Bearer ${await this.accessToken()}`;
    } else {
      const timestamp = this.getTimestamp();
      headers["X-Ovh-Application"] = this.applicationKey;
      headers["X-Ovh-Consumer"] = this.consumerKey;
      headers["X-Ovh-Timestamp"] = String(timestamp);
      headers["X-Ovh-Signature"] = this.sign(
        method,
        fullUrl,
        bodyStr,
        timestamp,
      );
    }

    if (bodyStr) {
      headers["Content-Type"] = "application/json";
    }

    const request: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (method !== "GET" && body !== undefined) request.body = bodyStr;
    const response = await fetch(fullUrl, request);

    const text = await response.text();

    if (!response.ok) {
      // Check for timestamp drift (HTTP 400 Invalid timestamp)
      if (
        this.authMode === "application_key" &&
        response.status === 400 &&
        allowRetry &&
        text.toLowerCase().includes("timestamp")
      ) {
        await this.syncTime();
        return this.executeWithRetry<T>(
          method,
          path,
          body,
          query,
          false,
          version,
        );
      }
      // Expired or revoked access token: fetch a new one once.
      if (this.authMode === "oauth2" && response.status === 401 && allowRetry) {
        this.invalidateToken();
        await this.accessToken(true);
        return this.executeWithRetry<T>(
          method,
          path,
          body,
          query,
          false,
          version,
        );
      }

      let parsedMessage = text;
      try {
        const errJson = JSON.parse(text);
        if (errJson && typeof errJson.message === "string") {
          parsedMessage = errJson.message;
        }
      } catch {
        // use raw text
      }

      throw new OvhApiError(response.status, parsedMessage, method, path, text);
    }

    if (!text || text.trim() === "") {
      return null as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  public get<T = unknown>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, undefined, query);
  }

  public post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  public put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  public delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  /** IAM and other API v2 calls (`/v2` base). */
  public getV2<T = unknown>(path: string, query?: Query): Promise<T> {
    return this.request<T>("GET", path, undefined, query, "v2");
  }

  public postV2<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body, undefined, "v2");
  }

  public putV2<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body, undefined, "v2");
  }

  public deleteV2<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path, undefined, undefined, "v2");
  }
}
