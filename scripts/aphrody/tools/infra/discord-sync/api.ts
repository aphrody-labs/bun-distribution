// SPDX-License-Identifier: Apache-2.0
/* oxlint-disable eslint/no-await-in-loop -- ordre des messages et limites de débit Discord */
// Client REST Discord minimal (salons, messages, épingles, réactions) avec reprise sur 429. Le jeton ne sort jamais
// de ce module : il n'apparaît ni dans les erreurs ni dans les journaux.
export interface Message {
  id: string;
  channel_id: string;
  type: number;
  content: string;
  timestamp: string;
  author: { id: string; username: string; bot?: boolean };
  attachments: unknown[];
  pinned?: boolean;
}

export interface Channel {
  id: string;
  type: number;
  name: string;
  parent_id?: string | null;
  topic?: string | null;
  permission_overwrites?: {
    id: string;
    type: number;
    allow: string;
    deny: string;
  }[];
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export class DiscordError extends Error {
  constructor(
    readonly status: number,
    method: string,
    path: string,
  ) {
    super(`discord ${method} ${path} -> ${status}`);
  }
}

export class Discord {
  constructor(
    private readonly token: string,
    readonly guildId: string,
    private readonly fetchFn: FetchLike = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await this.fetchFn(`https://discord.com/api/v10${path}`, {
        method,
        headers: {
          Authorization: `Bot ${this.token}`,
          "User-Agent": "DiscordBot (https://aphrody.com, 1)",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429) {
        const j = (await res.json().catch(() => ({}))) as {
          retry_after?: number;
        };
        await this.sleep(
          Math.min(10_000, Math.ceil((j.retry_after ?? 1) * 1000)),
        );
        continue;
      }
      if (!res.ok)
        throw new DiscordError(
          res.status,
          method,
          path.replace(/\d{15,}/g, "#"),
        );
      if (res.status === 204) return undefined as T;
      return (await res.json()) as T;
    }
    throw new DiscordError(429, method, path.replace(/\d{15,}/g, "#"));
  }

  /** Message avec un fichier joint (multipart) ; en édition, le fichier précédent est remplacé. */
  async upload(
    method: "POST" | "PATCH",
    path: string,
    payload: Record<string, unknown>,
    name: string,
    content: string,
  ): Promise<Message> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const form = new FormData();
      form.set(
        "payload_json",
        JSON.stringify({
          ...payload,
          attachments: [{ id: 0, filename: name }],
        }),
      );
      form.set(
        "files[0]",
        new Blob([content], { type: "text/markdown" }),
        name,
      );
      const res = await this.fetchFn(`https://discord.com/api/v10${path}`, {
        method,
        headers: {
          Authorization: `Bot ${this.token}`,
          "User-Agent": "DiscordBot (https://aphrody.com, 1)",
        },
        body: form,
      });
      if (res.status === 429) {
        const j = (await res.json().catch(() => ({}))) as {
          retry_after?: number;
        };
        await this.sleep(
          Math.min(10_000, Math.ceil((j.retry_after ?? 1) * 1000)),
        );
        continue;
      }
      if (!res.ok)
        throw new DiscordError(
          res.status,
          method,
          path.replace(/d{15,}/g, "#"),
        );
      return (await res.json()) as Message;
    }
    throw new DiscordError(429, method, path.replace(/d{15,}/g, "#"));
  }

  me = () => this.req<{ id: string; username: string }>("GET", "/users/@me");
  channels = () =>
    this.req<Channel[]>("GET", `/guilds/${this.guildId}/channels`);
  createChannel = (body: Record<string, unknown>) =>
    this.req<Channel>("POST", `/guilds/${this.guildId}/channels`, body);
  messages = (channel: string, query = "limit=50") =>
    this.req<Message[]>("GET", `/channels/${channel}/messages?${query}`);
  post = (channel: string, body: Record<string, unknown>) =>
    this.req<Message>("POST", `/channels/${channel}/messages`, body);
  edit = (channel: string, id: string, body: Record<string, unknown>) =>
    this.req<Message>("PATCH", `/channels/${channel}/messages/${id}`, body);
  remove = (channel: string, id: string) =>
    this.req<void>("DELETE", `/channels/${channel}/messages/${id}`);
  pin = (channel: string, id: string) =>
    this.req<void>("PUT", `/channels/${channel}/pins/${id}`);
  pins = (channel: string) =>
    this.req<Message[]>("GET", `/channels/${channel}/pins`);
  react = (channel: string, id: string, emoji: string) =>
    this.req<void>(
      "PUT",
      `/channels/${channel}/messages/${id}/reactions/${encodeURIComponent(emoji)}/@me`,
    );
  reactors = (channel: string, id: string, emoji: string) =>
    this.req<{ id: string; username: string; bot?: boolean }[]>(
      "GET",
      `/channels/${channel}/messages/${id}/reactions/${encodeURIComponent(emoji)}?limit=20`,
    );
}
