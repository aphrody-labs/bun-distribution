// SPDX-License-Identifier: Apache-2.0
export interface RequestCookie {
  name: string;
  value: string;
}

export interface ReadonlyRequestCookies {
  get(name: string): RequestCookie | undefined;
  getAll(name?: string): RequestCookie[];
  has(name: string): boolean;
  set?(name: string, value: string, options?: { path?: string; maxAge?: number }): void;
  delete?(name: string): void;
}

function decodeCookiePart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

class ClientCookieStore implements ReadonlyRequestCookies {
  private parseCookies(): Record<string, string> {
    if (typeof document === "undefined") return {};
    const parsed: Record<string, string> = Object.create(null);
    const raw = document.cookie;
    if (!raw) return parsed;

    const parts = raw.split(";");
    for (const part of parts) {
      const token = part.trim();
      const separator = token.indexOf("=");
      if (separator < 1) continue;
      parsed[decodeCookiePart(token.slice(0, separator))] = decodeCookiePart(
        token.slice(separator + 1),
      );
    }
    return parsed;
  }

  get(name: string): RequestCookie | undefined {
    const parsed = this.parseCookies();
    if (Object.hasOwn(parsed, name)) {
      return { name, value: parsed[name] };
    }
    return undefined;
  }

  getAll(name?: string): RequestCookie[] {
    const parsed = this.parseCookies();
    const list: RequestCookie[] = [];
    for (const [k, v] of Object.entries(parsed)) {
      if (!name || k === name) {
        list.push({ name: k, value: v });
      }
    }
    return list;
  }

  has(name: string): boolean {
    const parsed = this.parseCookies();
    return Object.hasOwn(parsed, name);
  }

  set(name: string, value: string, options?: { path?: string; maxAge?: number }): void {
    if (typeof document === "undefined") return;
    let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=${options?.path || "/"}`;
    if (options?.maxAge !== undefined) {
      cookie += `; max-age=${options.maxAge}`;
    }
    document.cookie = cookie;
  }

  delete(name: string): void {
    if (typeof document === "undefined") return;
    document.cookie = `${encodeURIComponent(name)}=; path=/; max-age=0`;
  }
}

const cookieStoreInstance = new ClientCookieStore();

/**
 * Next.js 16 cookies() helper — returns a Promise for Next 16 async compatibility
 */
export async function cookies(): Promise<ReadonlyRequestCookies> {
  return cookieStoreInstance;
}

/**
 * Next.js 16 headers() helper — returns a Promise for Next 16 async compatibility
 */
export async function headers(): Promise<Headers> {
  const requestHeaders = new Headers();
  if (typeof window !== "undefined") {
    requestHeaders.set("user-agent", window.navigator.userAgent);
    requestHeaders.set("host", window.location.host);
  }
  return requestHeaders;
}
