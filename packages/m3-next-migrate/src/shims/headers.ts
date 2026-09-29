// SPDX-License-Identifier: Apache-2.0
export interface RequestCookie {
  name: string;
  value: string;
}

export interface ReadonlyRequestCookies {
  get(name: string): RequestCookie | undefined;
  getAll(name?: string): RequestCookie[];
  has(name: string): boolean;
  set?(name: string, value: string, options?: any): void;
  delete?(name: string): void;
}

class ClientCookieStore implements ReadonlyRequestCookies {
  private parseCookies(): Record<string, string> {
    if (typeof document === "undefined") return {};
    const cookies: Record<string, string> = {};
    const raw = document.cookie;
    if (!raw) return cookies;

    const parts = raw.split(";");
    for (const part of parts) {
      const [key, val] = part.trim().split("=");
      if (key) {
        cookies[decodeURIComponent(key)] = decodeURIComponent(val || "");
      }
    }
    return cookies;
  }

  get(name: string): RequestCookie | undefined {
    const cookies = this.parseCookies();
    if (name in cookies) {
      return { name, value: cookies[name] };
    }
    return undefined;
  }

  getAll(name?: string): RequestCookie[] {
    const cookies = this.parseCookies();
    const list: RequestCookie[] = [];
    for (const [k, v] of Object.entries(cookies)) {
      if (!name || k === name) {
        list.push({ name: k, value: v });
      }
    }
    return list;
  }

  has(name: string): boolean {
    const cookies = this.parseCookies();
    return name in cookies;
  }

  set(name: string, value: string, options?: { path?: string; maxAge?: number }): void {
    if (typeof document === "undefined") return;
    let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=${options?.path || "/"}`;
    if (options?.maxAge) {
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
  const headers = new Headers();
  if (typeof window !== "undefined") {
    headers.set("user-agent", window.navigator.userAgent);
    headers.set("host", window.location.host);
  }
  return headers;
}
