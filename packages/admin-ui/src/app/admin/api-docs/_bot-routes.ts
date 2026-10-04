/**
 * Routes de l'API du bot — données de documentation extraites de la page.
 *
 * Elles vivent dans un module séparé parce que `/api-docs` est devenue une page
 * PUBLIQUE (documentation de l'API agents) dont ces tableaux ne sont que la
 * partie réservée au staff : les garder dans le composant mélangeait 160 lignes
 * de données avec la mise en page.
 */
export const PUBLIC_ROUTES = [
  {
    method: "GET",
    path: "/api/public/user/:discordId",
    desc: "Profil enrichi user (XP, zéni, niveau, succès, inventaire, fusion, bannière)",
  },
  {
    method: "GET",
    path: "/api/public/shop",
    desc: "Catalogue items boutique (cartes/badges/couleurs/titres/bannières)",
  },
  {
    method: "GET",
    path: "/api/public/leaderboard?limit=100&enrich=1",
    desc: "Top XP avec avatars + usernames Discord",
  },
  {
    method: "GET",
    path: "/api/public/stats",
    desc: "Stats globales : users, totalXp, totalZeni, achievementsUnlocked, shopItems, inventoryItems",
  },
  {
    method: "GET",
    path: "/api/public/personas",
    desc: "6 personas Discord (status, ping, command count)",
  },
  {
    method: "GET",
    path: "/api/public/commands",
    desc: "Liste complète des slash commands groupées par persona",
  },
  {
    method: "GET",
    path: "/api/public/wiki/characters",
    desc: "Personnages DB (filtrable via ?q=)",
  },
  {
    method: "GET",
    path: "/api/public/wiki/characters/:id",
    desc: "Détail personnage + transformations + planète",
  },
  {
    method: "GET",
    path: "/api/public/wiki/planets",
    desc: "Liste planètes DB",
  },
  {
    method: "GET",
    path: "/api/public/wiki/planets/:id",
    desc: "Détail planète",
  },
  {
    method: "GET",
    path: "/api/public/profile/:id/card.png",
    desc: "Image profile card canvas (8 thèmes via ?theme=)",
  },
  {
    method: "GET",
    path: "/api/public/profile/:id/scan.png",
    desc: "Image scouter / scan canvas",
  },
];

export const ADMIN_ROUTES = [
  {
    method: "GET",
    path: "/api/bots",
    desc: "Liste 6 personas + statut détaillé",
  },
  {
    method: "GET",
    path: "/api/bots/:id/commands",
    desc: "Commandes filtrées par persona",
  },
  {
    method: "GET",
    path: "/api/bots/:id/guild/roles",
    desc: "Liste rôles guild (role picker)",
  },
  {
    method: "GET",
    path: "/api/cron",
    desc: "Cron jobs (lastRunAt, intervalMs, runCount, lastError)",
  },
  {
    method: "POST",
    path: "/api/cron/:name/trigger",
    desc: "Déclenche un cron manuellement",
  },
  {
    method: "GET",
    path: "/api/services",
    desc: "Liste services tsyringe exposés",
  },
  {
    method: "POST",
    path: "/api/services/:service/:action",
    desc: "Invoque méthode whitelistée d'un service",
  },
  {
    method: "GET",
    path: "/api/database/tables",
    desc: "Liste 16 tables mutables",
  },
  {
    method: "GET/PUT/DELETE",
    path: "/api/database/:table[/:id]",
    desc: "CRUD générique par table",
  },
  {
    method: "GET",
    path: "/api/economy/leaderboard?limit=50",
    desc: "Top économique (admin enriched)",
  },
  {
    method: "POST",
    path: "/api/economy/give",
    desc: "Crédite Zéni un user (userId, amount, reason)",
  },
  { method: "POST", path: "/api/economy/set", desc: "Définit XP/zéni absolu" },
  {
    method: "GET",
    path: "/api/audit/logs?limit=50",
    desc: "Logs actions modération + admin",
  },
  { method: "GET", path: "/api/giveaways", desc: "Giveaways actifs + finis" },
  {
    method: "POST",
    path: "/api/giveaways/:id/end",
    desc: "Termine un giveaway et tire les gagnants",
  },
  {
    method: "GET",
    path: "/api/discord/{channels,roles,members,guild}",
    desc: "Browse data Discord live",
  },
  {
    method: "GET",
    path: "/api/canvas/profile/:userId",
    desc: "Profile card admin (debug)",
  },
  { method: "GET", path: "/api/canvas/scouter/:userId", desc: "Scouter admin" },
  {
    method: "GET",
    path: "/api/health/{check,usage,host,monitoring,logs,latency}",
    desc: "Métriques host + bot",
  },
  {
    method: "GET",
    path: "/api/a2a/events",
    desc: "SSE stream events temps réel (level-up, achievement…)",
  },
  {
    method: "POST",
    path: "/api/a2a/jsonrpc",
    desc: "JSON-RPC 2.0 endpoint Agent2Agent",
  },
];
