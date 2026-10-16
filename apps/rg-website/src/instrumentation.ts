/**
 * Fichier d'instrumentation Next.js
 * Exécuté au démarrage de l'application
 * ⚠️ Temporairement désactivé pour éviter les erreurs Edge Runtime
 */

export async function register() {
  // Désactivé temporairement - cause des erreurs avec Edge Runtime
  /*
  If (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/env");
    const { logger } = await import("./lib/logger");

    const startTime = Date.now();

    try {
      // 1. Validation des variables d'environnement
      const env = validateEnv();
      logger.info("✓ Environment variables validated");

      // 2. Vérifier les services critiques
      await checkServicesHealth(env);

      // 3. Métriques de performance
      const bootTime = Date.now() - startTime;
      logger.info(`✓ Application initialized in ${bootTime}ms`);

      // 4. Informations sur l'environnement
      logger.info("Environment info", {
        node: process.version,
        env: process.env.NODE_ENV,
        runtime: process.env.NEXT_RUNTIME,
      });
    } catch (error) {
      logger.error("Startup validation failed", error);

      if (process.env.NODE_ENV === "production") {
        console.error("FATAL: Cannot start application");
        process.exit(1);
      }
    }
  }
  */
}

/**
 * Vérifier la santé des services externes
 * (Fonctions désactivées temporairement comme l'appel dans register)
 */
/*
Async function checkServicesHealth(env: Record<string, unknown>) {
  const { logger } = await import("./lib/logger");

  const checks = [checkSupabase(env)];

  const results = await Promise.allSettled(checks);

  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.warn(`Service check ${index} failed`, result.reason);
    }
  });
}
*/

/**
 * Vérifier la connexion Supabase
 */
/*
Async function checkSupabase(env: Record<string, unknown>) {
  const { logger } = await import("./lib/logger");

  try {
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    const response = await fetch(`${url}/rest/v1/`, { method: "HEAD" });

    if (response.ok) {
      logger.info("✓ Supabase connection OK");
    } else {
      logger.warn("⚠ Supabase connection issue", { status: response.status });
    }
  } catch (error) {
    logger.warn("⚠ Could not verify Supabase connection");
  }
}
*/
