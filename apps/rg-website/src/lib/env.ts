/**
 * Validation des variables d'environnement au démarrage
 * Lance une erreur si une variable requise est manquante
 */

import { z } from "zod";

const envSchema = z.object({
  // Application
  NEXT_PUBLIC_BASE_URL: z.string().url(),
  CRON_SECRET: z.string().min(1).optional(),

  // Better Auth
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),

  // Supabase (DB + Storage)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),

  // Pont interne vers l'API unifiée. Il reste serveur uniquement.
  ACHILLEA_API_URL: z.string().url().optional(),
  API_ADMIN_TOKEN: z.string().min(1).optional(),

  // Postgres (Supabase)
  POSTGRES_DATABASE: z.string().min(1).optional(),
  POSTGRES_HOST: z.string().min(1).optional(),
  POSTGRES_PASSWORD: z.string().min(1).optional(),
  POSTGRES_PRISMA_URL: z.string().url().optional(),
  POSTGRES_URL: z.string().url().optional(),
  POSTGRES_URL_NON_POOLING: z.string().url().optional(),
  POSTGRES_USER: z.string().min(1).optional(),

  // Discord
  DISCORD_BOT_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  DISCORD_PUBLIC_KEY: z.string().min(1),
  DISCORD_SERVER_ID: z.string().min(1),
  DISCORD_STAFF_ROLE_ID: z.string().min(1),

  // Google
  GOOGLE_CLIENT_EMAIL: z.string().email(),
  GOOGLE_PRIVATE_KEY: z.string().min(1),
  GOOGLE_CALENDAR_ID: z.string().min(1),
  GOOGLE_EVENTS_CALENDAR_ID: z.string().min(1).optional(),
  GOOGLE_RGTV_CALENDAR_ID: z.string().min(1).optional(),
  GOOGLE_CALENDAR_API_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: z.string().min(1),

  // Twitch
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),

  // Patreon
  PATREON_CAMPAIGN_ID: z.string().min(1),
  PATREON_CLIENT_ID: z.string().min(1),
  PATREON_CLIENT_SECRET: z.string().min(1),
  PATREON_CREATOR_ACCESS_TOKEN: z.string().min(1),
  PATREON_CREATOR_REFRESH_TOKEN: z.string().min(1),
  PATREON_ENCRYPTION_KEY: z.string().min(1),

  // Stripe
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  // SMTP
  SMTP_USER: z.string().email(),
  SMTP_PASSWORD: z.string().min(1),

  // Storage
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Valide les variables d'environnement
 * À appeler au démarrage de l'application
 */
export function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missing = error.issues.map(e => e.path.join(".")).join(", ");
      throw new Error(
        `❌ Variables d'environnement manquantes ou invalides: ${missing}\n` + `Vérifiez votre fichier .env.local`,
        { cause: error },
      );
    }
    throw error;
  }
}

/**
 * Obtient une variable d'environnement de manière sécurisée
 */
export function getEnv<K extends keyof Env>(key: K): Env[K] {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Variable d'environnement manquante: ${key}`);
  }
  return value as Env[K];
}
