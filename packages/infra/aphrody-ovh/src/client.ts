// SPDX-License-Identifier: Apache-2.0
/**
 * Pure Bun OVH API Client (Native replacement for node-ovh / @ovh-api).
 *
 * Implements cryptographic SHA1 HMAC-style request signing, automatic server time drift
 * compensation, query serialization, and typed request methods with zero external dependencies.
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

export interface OvhClientOptions {
  applicationKey: string;
  applicationSecret: string;
  consumerKey: string;
  endpoint?: OvhEndpoint | string;
  timeoutMs?: number;
}

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
  if (typeof Bun !== "undefined" && typeof (Bun as { CryptoHasher?: unknown }).CryptoHasher === "function") {
    const hasher = new Bun.CryptoHasher("sha1");
    hasher.update(content);
    return hasher.digest("hex");
  }
  return createHash("sha1").update(content).digest("hex");
}

export class OvhClient {
  public readonly applicationKey: string;
  public readonly applicationSecret: string;
  public readonly consumerKey: string;
  public readonly baseUrl: string;
  public readonly timeoutMs: number;

  private timeDeltaSec: number = 0;
  private timeSynced: boolean = false;

  constructor(options: OvhClientOptions) {
    if (!options.applicationKey) throw new Error("OvhClient: missing applicationKey");
    if (!options.applicationSecret) throw new Error("OvhClient: missing applicationSecret");
    if (!options.consumerKey) throw new Error("OvhClient: missing consumerKey");

    this.applicationKey = options.applicationKey.trim();
    this.applicationSecret = options.applicationSecret.trim();
    this.consumerKey = options.consumerKey.trim();
    this.timeoutMs = options.timeoutMs ?? 30_000;

    const endpoint = options.endpoint ?? "ovh-eu";
    this.baseUrl = (ENDPOINT_URLS as Record<string, string>)[endpoint] ?? (endpoint.startsWith("http") ? endpoint : ENDPOINT_URLS["ovh-eu"]);
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
  public sign(method: string, url: string, bodyStr: string, timestamp: number): string {
    const raw = `${this.applicationSecret}+${this.consumerKey}+${method.toUpperCase()}+${url}+${bodyStr}+${timestamp}`;
    return `$1$${sha1(raw)}`;
  }

  /**
   * Dispatches an HTTP request with OVH signature authentication.
   */
  public async request<T = unknown>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    if (!this.timeSynced) {
      await this.syncTime();
    }

    return this.executeWithRetry<T>(method, path, body, query, true);
  }

  private async executeWithRetry<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: unknown,
    query?: Record<string, string | number | boolean | undefined>,
    allowTimeRetry: boolean = true,
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

    const fullUrl = `${this.baseUrl}${normalizedPath}`;
    const bodyStr = body === undefined ? "" : JSON.stringify(body);
    const timestamp = this.getTimestamp();
    const signature = this.sign(method, fullUrl, bodyStr, timestamp);

    const headers: Record<string, string> = {
      "X-Ovh-Application": this.applicationKey,
      "X-Ovh-Consumer": this.consumerKey,
      "X-Ovh-Timestamp": String(timestamp),
      "X-Ovh-Signature": signature,
      "Accept": "application/json",
    };

    if (bodyStr) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(fullUrl, {
      method,
      headers,
      body: bodyStr || undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const text = await response.text();

    if (!response.ok) {
      // Check for timestamp drift (HTTP 400 Invalid timestamp)
      if (response.status === 400 && allowTimeRetry && text.toLowerCase().includes("timestamp")) {
        await this.syncTime();
        return this.executeWithRetry<T>(method, path, body, query, false);
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

  public get<T = unknown>(path: string, query?: Record<string, string | number | boolean | undefined>): Promise<T> {
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
}
