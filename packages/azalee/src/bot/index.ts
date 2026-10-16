/**
 * @file bot/index.ts
 * @description Discord bot, slash commands, webhook notifications and community automation models.
 * Dedicated non-IEVR module tailored for Rose Griffon bot integrations.
 */

export type BotCommandOptionType =
  "string" | "integer" | "boolean" | "user" | "channel" | "role" | "mentionable" | "number";

export interface BotCommandOptionChoice {
  name: string;
  value: string | number;
}

export interface BotCommandOption {
  name: string;
  description: string;
  type: BotCommandOptionType;
  required?: boolean;
  choices?: BotCommandOptionChoice[];
}

export interface BotCommand {
  name: string;
  description: string;
  options?: BotCommandOption[];
  dmPermission?: boolean;
  category?: "general" | "game" | "wiki" | "admin" | "news";
}

export interface BotEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface BotEmbedAuthor {
  name: string;
  url?: string;
  icon_url?: string;
}

export interface BotEmbedFooter {
  text: string;
  icon_url?: string;
}

export interface BotEmbedImage {
  url: string;
  height?: number;
  width?: number;
}

export interface BotEmbed {
  title?: string;
  description?: string;
  url?: string;
  timestamp?: string; // ISO 8601
  color?: number; // Integer RGB
  footer?: BotEmbedFooter;
  image?: BotEmbedImage;
  thumbnail?: BotEmbedImage;
  author?: BotEmbedAuthor;
  fields?: BotEmbedField[];
}

export interface DiscordWebhookPayload {
  content?: string;
  username?: string;
  avatar_url?: string;
  tts?: boolean;
  embeds?: BotEmbed[];
}

export type NotificationPriority = "low" | "normal" | "high" | "urgent";

export interface BotNotification {
  id: string;
  title: string;
  message: string;
  priority: NotificationPriority;
  targetChannel?: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface BotGuildConfig {
  guildId: string;
  prefix: string;
  announcementChannelId?: string;
  newsChannelId?: string;
  locale: "fr" | "en" | "ja";
  featuresEnabled: string[];
}

/** Standard brand colors for Rose Griffon embeds */
export const EMBED_COLORS = {
  primary: 0x9333ea, // Rose Griffon purple
  gold: 0xf59e0b, // Trophy / Victory gold
  blue: 0x3b82f6, // Info / Announcement
  green: 0x10b981, // Success / Available
  red: 0xef4444, // Error / Alert
  dark: 0x1f2937, // Neutral dark
} as const;

/** Create a formatted bot embed with default brand styling */
export function createBotEmbed(fields: Partial<BotEmbed>): BotEmbed {
  return {
    color: EMBED_COLORS.primary,
    timestamp: new Date().toISOString(),
    footer: {
      text: "Rose Griffon Bot • Azalée",
    },
    ...fields,
  };
}

/** Format a Date or timestamp as a Discord dynamic relative or full timestamp tag: <t:timestamp:style> */
export function formatDiscordTimestamp(
  date: Date | string | number,
  style: "t" | "T" | "d" | "D" | "f" | "F" | "R" = "R",
): string {
  const unixSeconds = Math.floor(new Date(date).getTime() / 1000);
  return `<t:${unixSeconds}:${style}>`;
}

/** Build a webhook payload from notification data */
export function buildNotificationWebhook(
  notification: BotNotification,
  botName = "Rose Griffon Alerts",
): DiscordWebhookPayload {
  const colorMap: Record<NotificationPriority, number> = {
    low: EMBED_COLORS.dark,
    normal: EMBED_COLORS.blue,
    high: EMBED_COLORS.gold,
    urgent: EMBED_COLORS.red,
  };

  return {
    username: botName,
    embeds: [
      {
        title: notification.title,
        description: notification.message,
        color: colorMap[notification.priority] ?? EMBED_COLORS.primary,
        timestamp: notification.createdAt,
        fields: notification.metadata
          ? Object.entries(notification.metadata).map(([k, v]) => ({
              name: k,
              value: String(v),
              inline: true,
            }))
          : undefined,
        footer: {
          text: `Priority: ${notification.priority.toUpperCase()}`,
        },
      },
    ],
  };
}
