// SPDX-License-Identifier: Apache-2.0
// Cursor pages and Discord rate limits require sequential requests; AbortSignal changes externally.
/* oxlint-disable no-await-in-loop, no-unmodified-loop-condition */
import {
  DiscordAPIError,
  HTTPError,
  REST,
  type ResponseLike,
} from "@discordjs/rest";

export type ParseMode = "Markdown" | "Html";

declare const Bun: {
  file(path: string): {
    exists(): Promise<boolean>;
    arrayBuffer(): Promise<ArrayBuffer>;
  };
  env: Record<string, string | undefined>;
};

export interface MessageRef {
  id: string;
  room: string;
  channelId: string;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  url: string | null;
  sizeBytes: number | null;
}

export interface InboundMessage {
  id: string;
  room: string;
  sender: string;
  text: string;
  attachments: Attachment[];
  timestamp: Date;
}

export type RoomKind =
  "channel" | "direct_message" | "group_direct" | "thread" | "other";

export interface RoomInfo {
  id: string;
  name: string;
  kind: RoomKind;
  memberCount: number | null;
}

export class ChannelError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ChannelError";
  }
}

export interface DiscordChannelOptions {
  token: string;
  fetch?: typeof fetch;
  rest?: REST;
  apiBase?: string;
  userAgent?: string;
  pollIntervalMs?: number;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
}

interface DiscordAttachment {
  id: string;
  filename: string;
  content_type?: string | null;
  url: string;
  size: number;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  author?: DiscordUser | null;
  timestamp?: string | null;
  attachments?: DiscordAttachment[] | null;
}

interface DiscordGuild {
  id: string;
  name: string;
}

interface DiscordGuildChannel {
  id: string;
  name?: string | null;
  type: number;
}

const DEFAULT_API_BASE = "https://discord.com/api/v10/";
const DEFAULT_USER_AGENT = "aphrody-messaging/0.1.0";

function channelKind(type: number): RoomKind {
  switch (type) {
    case 1:
      return "direct_message";
    case 3:
      return "group_direct";
    case 10:
    case 11:
    case 12:
      return "thread";
    case 0:
    case 2:
    case 5:
    case 13:
    case 15:
    case 16:
      return "channel";
    default:
      return "other";
  }
}

function timestamp(value?: string | null): Date {
  if (value === undefined || value === null) return new Date(0);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

export class DiscordChannel {
  readonly id = "discord";
  private readonly rest: REST;
  private readonly pollIntervalMs: number;

  constructor(options: DiscordChannelOptions | string) {
    const config = typeof options === "string" ? { token: options } : options;
    if (!config.token) throw new ChannelError("DISCORD_BOT_TOKEN is required");
    const base = new URL(config.apiBase ?? DEFAULT_API_BASE);
    const match = /^(.*)\/v(\d+)\/?$/.exec(base.pathname);
    if (!match)
      throw new ChannelError("apiBase must end with a Discord API version");
    const fetchImpl = config.fetch;
    this.rest =
      config.rest ??
      new REST({
        api: `${base.origin}${match[1]}`,
        version: match[2],
        userAgentAppendix: config.userAgent ?? DEFAULT_USER_AGENT,
        ...(fetchImpl
          ? {
              makeRequest: async (url, init): Promise<ResponseLike> =>
                (await fetchImpl(
                  url,
                  init as globalThis.RequestInit,
                )) as unknown as ResponseLike,
            }
          : {}),
      });
    this.rest.setToken(config.token);
    this.pollIntervalMs = config.pollIntervalMs ?? 1_000;
  }

  static fromEnv(
    env: Record<string, string | undefined> = Bun.env,
  ): DiscordChannel {
    const token = env.DISCORD_BOT_TOKEN;
    if (!token)
      throw new ChannelError("missing environment variable: DISCORD_BOT_TOKEN");
    return new DiscordChannel(token);
  }

  async sendText(room: string, text: string): Promise<MessageRef> {
    const msg = await this.request<DiscordMessage>(
      `channels/${encodeURIComponent(room)}/messages`,
      {
        method: "POST",
        body: { content: text },
      },
    );
    return { id: msg.id, room: msg.channel_id, channelId: this.id };
  }

  async sendFile(
    room: string,
    file: Blob | File | string,
    mime: string,
  ): Promise<MessageRef> {
    let upload: Blob;
    let filename: string;
    if (typeof file === "string") {
      const bunFile = Bun.file(file);
      if (!(await bunFile.exists()))
        throw new ChannelError(`file does not exist: ${file}`);
      upload = new Blob([await bunFile.arrayBuffer()], { type: mime });
      filename = file.split(/[\\/]/).at(-1) || "file";
    } else {
      upload = file;
      filename = "name" in file && file.name ? file.name : "file";
    }
    const msg = await this.request<DiscordMessage>(
      `channels/${encodeURIComponent(room)}/messages`,
      {
        method: "POST",
        body: {},
        files: [
          {
            data: new Uint8Array(await upload.arrayBuffer()),
            name: filename,
            contentType: mime,
          },
        ],
      },
    );
    return { id: msg.id, room: msg.channel_id, channelId: this.id };
  }

  async openDm(userId: string): Promise<string> {
    const result = await this.request<{ id: string }>("users/@me/channels", {
      method: "POST",
      body: { recipient_id: userId },
    });
    return result.id;
  }

  async rooms(options: { signal?: AbortSignal } = {}): Promise<RoomInfo[]> {
    const signal = options.signal;
    if (signal?.aborted) return [];
    let guilds: DiscordGuild[];
    try {
      guilds = await this.request<DiscordGuild[]>("users/@me/guilds", {
        signal,
      });
    } catch (error) {
      if (signal?.aborted) return [];
      throw error;
    }
    const rooms: RoomInfo[] = [];
    for (const guild of guilds) {
      if (signal?.aborted) return rooms;
      try {
        const channels = await this.request<DiscordGuildChannel[]>(
          `guilds/${encodeURIComponent(guild.id)}/channels`,
          {
            signal,
          },
        );
        if (signal?.aborted) return rooms;
        for (const channel of channels) {
          rooms.push({
            id: channel.id,
            name: channel.name ?? "",
            kind: channelKind(channel.type),
            memberCount: null,
          });
        }
      } catch (error) {
        if (signal?.aborted) return rooms;
        console.warn(
          `Discord list-channels failed for guild ${guild.id}: ${errorMessage(error)}`,
        );
      }
    }
    return rooms;
  }

  async *streamInbox(
    options: { signal?: AbortSignal } = {},
  ): AsyncGenerator<InboundMessage, void, void> {
    const signal = options.signal;
    if (signal?.aborted) return;
    const rooms = await this.rooms({ signal });
    if (signal?.aborted) return;
    const roomIds = rooms
      .filter((room) => room.kind === "channel" || room.kind === "thread")
      .map((room) => room.id);
    const cursors = new Map(roomIds.map((id) => [id, "0"]));

    while (!signal?.aborted) {
      for (const channelId of roomIds) {
        if (signal?.aborted) return;
        const after = cursors.get(channelId) ?? "0";
        try {
          const messages = await this.messagesSince(channelId, after, signal);
          let newest = after;
          for (const message of messages) {
            if (signal?.aborted) return;
            if (compareSnowflakes(message.id, newest) > 0) newest = message.id;
            yield this.toInbound(message);
          }
          cursors.set(channelId, newest);
        } catch (error) {
          if (signal?.aborted) return;
          console.warn(
            `Discord message poll failed for channel ${channelId}: ${errorMessage(error)}`,
          );
        }
      }
      await delay(this.pollIntervalMs, signal);
    }
  }

  private async messagesSince(
    channelId: string,
    after: string,
    signal?: AbortSignal,
  ): Promise<DiscordMessage[]> {
    const path = `channels/${encodeURIComponent(channelId)}/messages`;
    let page = await this.request<DiscordMessage[]>(path, {
      query: { after, limit: "100" },
      signal,
    });
    const messages = [...page];
    // Preserve the legacy initial snapshot of the latest page, then backfill later polls to the saved cursor.
    while (after !== "0" && page.length === 100 && !signal?.aborted) {
      const oldest = page.at(-1)!.id;
      if (compareSnowflakes(oldest, after) <= 0) break;
      page = await this.request<DiscordMessage[]>(path, {
        query: { before: oldest, limit: "100" },
        signal,
      });
      messages.push(...page);
      if (page.length === 0 || compareSnowflakes(page.at(-1)!.id, oldest) >= 0)
        break;
    }
    return messages
      .filter((message) => compareSnowflakes(message.id, after) > 0)
      .toSorted((left, right) => compareSnowflakes(left.id, right.id));
  }

  private async request<T>(
    path: string,
    options: {
      method?: "GET" | "POST";
      body?: unknown;
      files?: { data: Uint8Array; name: string; contentType?: string }[];
      query?: Record<string, string>;
      signal?: AbortSignal;
    } = {},
  ): Promise<T> {
    try {
      const route = `/${path}` as const;
      const requestOptions = {
        body: options.body,
        files: options.files,
        query: options.query ? new URLSearchParams(options.query) : undefined,
        signal: options.signal,
      };
      return (await (options.method === "POST"
        ? this.rest.post(route, requestOptions)
        : this.rest.get(route, requestOptions))) as T;
    } catch (error) {
      if (error instanceof DiscordAPIError) {
        throw new ChannelError(error.message, String(error.code), {
          cause: error,
        });
      }
      if (error instanceof HTTPError) {
        throw new ChannelError(
          `Discord HTTP ${error.status}: ${error.message}`,
          String(error.status),
          {
            cause: error,
          },
        );
      }
      throw new ChannelError(
        `Discord HTTP transport error: ${errorMessage(error)}`,
        undefined,
        {
          cause: error,
        },
      );
    }
  }

  private toInbound(message: DiscordMessage): InboundMessage {
    return {
      id: message.id,
      room: message.channel_id,
      sender:
        message.author?.global_name ||
        message.author?.username ||
        message.author?.id ||
        "unknown",
      text: message.content,
      attachments: (message.attachments ?? []).map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.content_type ?? "application/octet-stream",
        url: attachment.url,
        sizeBytes: attachment.size,
      })),
      timestamp: timestamp(message.timestamp),
    };
  }
}

function compareSnowflakes(left: string, right: string): number {
  try {
    const a = BigInt(left);
    const b = BigInt(right);
    return a === b ? 0 : a > b ? 1 : -1;
  } catch {
    return left.localeCompare(right);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
