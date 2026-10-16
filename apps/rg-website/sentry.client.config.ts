/**
 * Configuration Sentry pour Next.js
 *
 * Documentation: https://docs.sentry.io/platforms/javascript/guides/nextjs/
 *
 * Pour activer Sentry en production:
 * 1. Créer un projet sur sentry.io
 * 2. Ajouter NEXT_PUBLIC_SENTRY_DSN dans .env.local
 * 3. Optionnel: Ajouter SENTRY_AUTH_TOKEN pour upload source maps
 */

import * as Sentry from "@sentry/nextjs";

// Configuration Sentry seulement si DSN est défini
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Traces pour monitoring performance
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1,

    // Debug mode en développement
    debug: process.env.NODE_ENV === "development",

    // Replay pour session recording (optionnel)
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1,

    // Environnement
    environment: process.env.NODE_ENV || "development",

    // Filtrer les erreurs non pertinentes
    beforeSend(event, _hint) {
      // Ignorer les erreurs d'extension navigateur
      if (event.exception?.values?.[0]?.value?.includes("Extension")) {
        return null;
      }

      // Taguer les erreurs sidebar
      if (event.exception?.values?.[0]?.stacktrace?.frames) {
        const { frames } = event.exception.values[0].stacktrace;
        const isSidebarError = frames.some(frame => frame.filename?.includes("sidebar"));

        if (isSidebarError) {
          event.tags = { ...event.tags, component: "sidebar" };
        }
      }

      return event;
    },

    // Intégrations
    integrations: [
      Sentry.replayIntegration({
        blockAllMedia: true,
        maskAllText: true,
      }),
    ],
  });
}
