// SPDX-License-Identifier: Apache-2.0
// `next/headers`: the request headers and cookies of the current request. Reading them makes the
// route dynamic; cookies can be written from server actions and route handlers.
import { getStore, markDynamic } from "./runtime/store";

export interface RequestCookie {
  name: string;
  value: string;
}

export interface CookieOptions {
  domain?: string;
  path?: string;
  expires?: Date | number;
  maxAge?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
  partitioned?: boolean;
}

export class RequestCookies {
  constructor(private readonly map: Bun.CookieMap) {}

  get(name: string | RequestCookie): RequestCookie | undefined {
    const key = typeof name === "string" ? name : name.name;
    const value = this.map.get(key);
    return value === null ? undefined : { name: key, value };
  }

  getAll(name?: string): RequestCookie[] {
    const out: RequestCookie[] = [];
    for (const [key, value] of this.map) if (name === undefined || key === name) out.push({ name: key, value });
    return out;
  }

  has(name: string): boolean {
    return this.map.has(name);
  }

  get size(): number {
    return this.map.size;
  }

  set(name: string | (RequestCookie & CookieOptions), value?: string, options?: CookieOptions): this {
    if (typeof name === "string") this.map.set({ name, value: value ?? "", path: "/", ...options });
    else this.map.set({ path: "/", ...name });
    return this;
  }

  delete(name: string | { name: string; path?: string; domain?: string }): this {
    if (typeof name === "string") this.map.delete({ name, path: "/" });
    else this.map.delete({ path: "/", ...name });
    return this;
  }

  toString(): string {
    return this.getAll()
      .map(c => `${c.name}=${encodeURIComponent(c.value)}`)
      .join("; ");
  }
}

/** Request headers (read-only). */
export async function headers(): Promise<Headers> {
  return markDynamic("headers()").request.headers;
}

/** Request cookies; `set`/`delete` produce `Set-Cookie` headers on the response. */
export async function cookies(): Promise<RequestCookies> {
  return new RequestCookies(markDynamic("cookies()").cookies);
}

/** `draftMode()`: preview mode is not implemented, it always reports disabled. */
export async function draftMode(): Promise<{ isEnabled: boolean }> {
  getStore("draftMode()");
  return { isEnabled: false };
}
