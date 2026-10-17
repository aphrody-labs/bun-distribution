import withBundleAnalyzer from "@next/bundle-analyzer";
import { withBun } from "@aphrody/next-bun";
import type { NextConfig } from "next";
import path from "node:path";

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// CDN externe — décharge .next/static/ + assets public/ vers cdn.rosegriffon.fr.
const CDN_URL = process.env.NEXT_PUBLIC_CDN_URL?.trim() || "";
const CDN_LOADER = CDN_URL && process.env.NEXT_PUBLIC_CDN_LOADER === "1";

// Producer archives are installed inside this workspace; tracing stays in Aphrody.
const buildRoot = path.resolve(process.cwd(), "../../");

const nextConfig: NextConfig = {
  reactCompiler: true,

  outputFileTracingRoot: buildRoot,
  // Vercel optimise les images en amont : l'addon natif de sharp n'a rien à faire dans les fonctions.
  outputFileTracingExcludes: { "*": ["node_modules/sharp/**", "node_modules/@img/**"] },
  turbopack: {
    root: buildRoot,
  },
  webpack(config) {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ".js": [".js", ".ts", ".tsx"],
      ".mjs": [".mjs", ".mts"],
      ".cjs": [".cjs", ".cts"],
      ...config.resolve.extensionAlias,
    };
    return config;
  },

  compress: false,
  ...(CDN_URL && { assetPrefix: CDN_URL }),
  transpilePackages: [
    "@rosegriffon/inagle",
    "@rosegriffon/inagle-cross",
    "@rosegriffon/azalee",
    "@rosegriffon/ui",
    "@rosegriffon/app-shell",
    "@rosegriffon/db",
    "@rosegriffon/types",
    "@rosegriffon/config",
    "@rosegriffon/patreon-bun",
    "@rosegriffon/auth",
    "@rosegriffon/assets",
    // Achilléa : paquets consommés en source TypeScript, comme les autres
    // workspaces. Les trois sont isomorphes (aucun import node:/bun:), donc
    // utilisables aussi bien en Server Component qu'en îlot client.
    "@rosegriffon/achillea-types",
    "@rosegriffon/achillea-core",
    "@rosegriffon/achillea-client",
    // Mécanique SQL/Redis/env partagée sous @rosegriffon/db (ADR sql-convergence D7).
    "@aphrody/sql",
    "@aphrody/paths",
  ],

  typescript: {
    ignoreBuildErrors: true,
  },

  productionBrowserSourceMaps: false,

  serverExternalPackages: [
    "@sentry/nextjs",
    "better-auth",
    "@better-auth/kysely-adapter",
    "kysely",
    "discord.js",
    "googleapis",
    "nodemailer",
    "pg",
    "stripe",
    "pica",
    "xlsx",
    "cheerio",
    "bcryptjs",
    "jsonwebtoken",
    "web-push",
    "konva",
    "csv-parse",
  ],

  experimental: {
    cpus: 2,
    optimizePackageImports: [
      "lucide-react",
      "date-fns",
      // Barils de workspace : sans cette entrée, un `import { cn } from
      // "@/lib/utils"` (qui ré-exporte le baril complet) tirait les ~90
      // composants du paquet UI dans le graphe du module appelant.
      "@rosegriffon/ui",
      "@rosegriffon/azalee",
      "motion",
      "react-hook-form",
      "@hookform/resolvers",
      "react-icons",
      "recharts",
      "cmdk",
      "embla-carousel-react",
      "input-otp",
      "react-day-picker",
      "zustand",
      "@tanstack/react-query",
      "@tanstack/react-query-persist-client",
      "@tanstack/react-table",
      "@tiptap/core",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "clsx",
      "tailwind-merge",
      "class-variance-authority",
      "sonner",
      "zod",
    ],
    serverActions: {
      bodySizeLimit: "5mb",
    },
    serverSourceMaps: true,
    turbopackFileSystemCacheForBuild: true,
    turbopackFileSystemCacheForDev: true,
    cssChunking: true,
  },

  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? {
            exclude: ["error", "warn"],
          }
        : false,
  },

  async redirects() {
    return [
      // www → apex : l'auth-client force baseURL=https://rosegriffon.fr (apex) pour
      // que le cookie OAuth `state` et le callback soient sur le même domaine. Sur
      // www.rosegriffon.fr, l'appel /api/auth part donc en cross-origin → bloqué
      // par CORS (« Failed to fetch » au login). On force tout le monde sur l'apex.
      {
        destination: "https://rosegriffon.fr/:path*",
        has: [{ type: "host", value: "www.rosegriffon.fr" }],
        permanent: true,
        source: "/:path*",
      },
      {
        destination: "/wiki",
        permanent: true,
        source: "/azalee",
      },
      // Les pages d'équipe ont fusionné dans `/community`, qui porte
      // désormais l'équipe ET l'annuaire du Discord en deux onglets.
      // Une `redirect()` de composant serveur rend une redirection MOLLE
      // (200 puis bascule côté client) : un moteur d'indexation voit une
      // page qui existe encore, et le jus des anciennes URL n'est pas
      // transféré. Celles-ci sont indexées : il leur faut un vrai 308.
      // Le fil est unifié sous `/news` : `/chroniques` n'était pas un second
      // journal mais un second CORPUS du même, avec sa liste, sa page
      // d'article et son entrée de menu. Les slugs sont uniques sur toute la
      // table : une chronique se sert telle quelle sous `/news/<slug>`.
      { destination: "/news?format=chronique", permanent: true, source: "/chroniques" },
      { destination: "/news/:slug", permanent: true, source: "/chroniques/:slug" },
      // UNE SEULE PAGE DE CONNEXION.
      // `/achillea/auth` proposait un second écran « Connexion Discord »
      // pour le même compte Discord : depuis que la session e-sport dérive
      // de la session Rose Griffon (`/api/achillea/session`), il n'y a plus
      // qu'une porte d'entrée.
      // La page `/notre-equipe` rassemble l'ensemble des pôles de l'association.
      // Les anciens sous-chemins fragmentés redirigent vers `/notre-equipe`.
      { destination: "/notre-equipe", permanent: true, source: "/notre-equipe/:path+" },
      {
        destination: "/nous-soutenir",
        permanent: true,
        source: "/a-propos/soutenir",
      },
      { destination: "/nous-soutenir", permanent: true, source: "/soutenir" },
      { destination: "/charte-engagements", permanent: true, source: "/charte" },
      // Redirections Wiki transparentes (zéro régression sur URLs Azalée)
      { destination: "/wiki/avatar", permanent: true, source: "/avatar" },
      { destination: "/wiki/avatar/:path*", permanent: true, source: "/avatar/:path*" },
      { destination: "/wiki/chara", permanent: true, source: "/chara" },
      { destination: "/wiki/chara/:path*", permanent: true, source: "/chara/:path*" },
      { destination: "/wiki/skill", permanent: true, source: "/skill" },
      { destination: "/wiki/skill/:path*", permanent: true, source: "/skill/:path*" },
      { destination: "/wiki/item", permanent: true, source: "/item" },
      { destination: "/wiki/item/:path*", permanent: true, source: "/item/:path*" },
      { destination: "/wiki/equipe", permanent: true, source: "/equipe" },
      { destination: "/wiki/equipe/:path*", permanent: true, source: "/equipe/:path*" },
      { destination: "/wiki/modeles", permanent: true, source: "/keshin" },
      { destination: "/wiki/modeles/:path*", permanent: true, source: "/keshin/:path*" },
      { destination: "/wiki/tactic", permanent: true, source: "/tactic" },
      { destination: "/wiki/tactic/:path*", permanent: true, source: "/tactic/:path*" },
      { destination: "/wiki/passive", permanent: true, source: "/passive" },
      { destination: "/wiki/passive/:path*", permanent: true, source: "/passive/:path*" },
      { destination: "/wiki/aura", permanent: true, source: "/aura" },
      { destination: "/wiki/aura/:path*", permanent: true, source: "/aura/:path*" },
      { destination: "/wiki/stade", permanent: true, source: "/stade" },
      { destination: "/wiki/stade/:path*", permanent: true, source: "/stade/:path*" },
      { destination: "/wiki/boutique", permanent: true, source: "/boutique" },
      { destination: "/wiki/boutique/:path*", permanent: true, source: "/boutique/:path*" },
      { destination: "/wiki/capsule", permanent: true, source: "/capsule" },
      { destination: "/wiki/capsule/:path*", permanent: true, source: "/capsule/:path*" },
      { destination: "/wiki/drops", permanent: true, source: "/drops" },
      { destination: "/wiki/drops/:path*", permanent: true, source: "/drops/:path*" },
      { destination: "/wiki/quete", permanent: true, source: "/quete" },
      { destination: "/wiki/quete/:path*", permanent: true, source: "/quete/:path*" },
      { destination: "/wiki/succes", permanent: true, source: "/succes" },
      { destination: "/wiki/succes/:path*", permanent: true, source: "/succes/:path*" },
      { destination: "/wiki/niveau", permanent: true, source: "/niveau" },
      { destination: "/wiki/niveau/:path*", permanent: true, source: "/niveau/:path*" },
      { destination: "/wiki/entraineur", permanent: true, source: "/entraineur" },
      { destination: "/wiki/entraineur/:path*", permanent: true, source: "/entraineur/:path*" },
      { destination: "/wiki/cross", permanent: true, source: "/cross" },
      { destination: "/wiki/cross/:path*", permanent: true, source: "/cross/:path*" },
      { destination: "/wiki/cross", permanent: true, source: "/cross/catalogue" },
      { destination: "/wiki/patch-notes", permanent: true, source: "/patch-notes" },
      { destination: "/wiki/patch-notes/:path*", permanent: true, source: "/patch-notes/:path*" },
      { destination: "/wiki/tools", permanent: true, source: "/tools" },
      { destination: "/wiki/tools/:path*", permanent: true, source: "/tools/:path*" },
      { destination: "/wiki/tools/compare", permanent: true, source: "/compare" },
      { destination: "/wiki/tools/random-team", permanent: true, source: "/random-team" },
      { destination: "/wiki/save", permanent: true, source: "/save" },
      { destination: "/wiki/save/:path*", permanent: true, source: "/save/:path*" },
      { destination: "/wiki/modeles", permanent: true, source: "/modeles" },
      { destination: "/wiki/modeles/:path*", permanent: true, source: "/modeles/:path*" },
      { destination: "/wiki/textures", permanent: true, source: "/textures" },
      { destination: "/wiki/textures/:path*", permanent: true, source: "/textures/:path*" },
      { destination: "/wiki/vroid", permanent: true, source: "/vroid" },
      { destination: "/wiki/vroid/:path*", permanent: true, source: "/vroid/:path*" },
      { destination: "/wiki/videos", permanent: true, source: "/videos" },
      { destination: "/wiki/videos/:path*", permanent: true, source: "/videos/:path*" },
      { destination: "/wiki/sons", permanent: true, source: "/sons" },
      { destination: "/wiki/sons/:path*", permanent: true, source: "/sons/:path*" },
      { destination: "/wiki/gallery", permanent: true, source: "/gallery" },
      { destination: "/wiki/gallery/:path*", permanent: true, source: "/gallery/:path*" },
      { destination: "/wiki/demo", permanent: true, source: "/demo" },
      { destination: "/wiki/invocation", permanent: true, source: "/invocation" },
      { destination: "/wiki/mode", permanent: true, source: "/mode" },
      { destination: "/wiki/mode/:path*", permanent: true, source: "/mode/:path*" },
      // Redirections Dashboard Azalée vers Admin Rose Griffon
      { destination: "/admin/news/new", permanent: true, source: "/dashboard/news/new" },
      { destination: "/admin/news/:path*", permanent: true, source: "/dashboard/news/:path*" },
      { destination: "/admin/news", permanent: true, source: "/dashboard/news" },
      {
        destination: "/admin/database/:path*",
        permanent: true,
        source: "/dashboard/database/:path*",
      },
      { destination: "/admin/database", permanent: true, source: "/dashboard/database" },
      { destination: "/admin/tweets/:path*", permanent: true, source: "/dashboard/tweets/:path*" },
      { destination: "/admin/tweets", permanent: true, source: "/dashboard/tweets" },
      { destination: "/admin/audit", permanent: true, source: "/dashboard/audit" },
      { destination: "/admin/import-sheet", permanent: true, source: "/dashboard/import-sheet" },
      {
        destination: "/admin/import-google-doc",
        permanent: true,
        source: "/dashboard/import-google-doc",
      },
      { destination: "/admin/zukan-review", permanent: true, source: "/dashboard/zukan-review" },
      { destination: "/admin/users", permanent: true, source: "/dashboard/admin/users" },
      { destination: "/admin/users", permanent: true, source: "/dashboard/users" },
      // `/dashboard/settings` n'avait AUCUNE redirection alors que la barre du
      // tableau de bord et la barre basse y menaient toutes les deux : 404.
      { destination: "/admin/settings", permanent: true, source: "/dashboard/settings" },
      // Réglages du compte unifiés avec azalee sur `/settings`.
      { destination: "/settings", permanent: true, source: "/dashboard/account" },
      { destination: "/settings", permanent: true, source: "/dashboard/account/:path*" },
      // Le pied de page partagé avec le wiki pointe vers `/contact`, qui
      // n'existait que côté azalee — un lien mort sur chaque page.
      { destination: "/a-propos/contact", permanent: true, source: "/contact" },
      // Forme d'URL de réinitialisation utilisée par azalee : les deux apps
      // partagent le chrome et les courriels, les deux formes doivent aboutir.
      { destination: "/reset-password", permanent: false, source: "/auth/reset-password" },
      // Redirections legacy Achilléa (Angular → Next.js)
      { destination: "/login", permanent: true, source: "/achillea/auth" },
      {
        destination: "/achillea/tournaments",
        permanent: true,
        source: "/achillea/events/list/tournament",
      },
      {
        destination: "/achillea/tournaments/circuit/ranking",
        permanent: true,
        source: "/achillea/events/tournaments/circuit/ranking",
      },
      {
        destination: "/achillea/tournaments/create",
        permanent: true,
        source: "/achillea/events/create/tournament",
      },
      {
        destination: "/achillea/tournaments/:id",
        permanent: true,
        source: "/achillea/events/tournaments/:id",
      },
      {
        destination: "/achillea/leagues/astral",
        permanent: true,
        source: "/achillea/leagues/astral-s1",
      },
      {
        destination: "/achillea/leagues/astral",
        permanent: true,
        source: "/achillea/leagues/asytral",
      },
      {
        destination: "/achillea/leagues/astral",
        permanent: true,
        source: "/achillea/leagues/asytral-s1",
      },
      {
        destination: "/achillea/tournaments/circuit/ranking",
        permanent: true,
        source: "/achillea/tournament-ranking",
      },
      {
        destination: "/achillea/tournaments/:id",
        permanent: true,
        source: "/achillea/tournament-page/:id",
      },
      { destination: "/achillea/clans/:id", permanent: true, source: "/achillea/clan-profile/:id" },
      {
        destination: "/achillea/clans/dashboard",
        permanent: true,
        source: "/achillea/clan-dashboard",
      },
      { destination: "/achillea/clans", permanent: true, source: "/achillea/clans-list" },
      {
        destination: "/achillea/ranked/leaderboard",
        permanent: true,
        source: "/achillea/ranked-leaderboard",
      },
      { destination: "/achillea/ranked/tiers", permanent: true, source: "/achillea/ranked-tiers" },
      { destination: "/achillea/ranked/match", permanent: true, source: "/achillea/ranked-match" },
      {
        destination: "/achillea/ranked/history",
        permanent: true,
        source: "/achillea/ranked-history",
      },
      { destination: "/achillea/users/:id", permanent: true, source: "/achillea/user-profile/:id" },
    ];
  },

  async rewrites() {
    // Les URL relatives `/storage/v1/…` déjà enregistrées en base restent
    // valides : elles sont relayées vers Supabase Storage.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    if (!supabaseUrl?.startsWith("https://")) return [];
    return [{ destination: `${supabaseUrl}/storage/v1/:path*`, source: "/storage/v1/:path*" }];
  },

  async headers() {
    return [
      {
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
        ],
        source: "/(.*)",
      },
      {
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          {
            key: "Access-Control-Allow-Methods",
            value: "GET,OPTIONS,PATCH,DELETE,POST,PUT",
          },
          {
            key: "Access-Control-Allow-Headers",
            value:
              "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
          },
        ],
        source: "/api/public/:path*",
      },
      {
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
        source: "/_next/static/:path*",
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // Next 16 : seules les valeurs `quality` listées ici sont acceptées par
    // l'optimiseur (défaut = [75]). Les composants utilisent q=70/90/95/100 ;
    // sans cette liste l'optimiseur renvoie 400 INVALID_IMAGE_OPTIMIZE_REQUEST
    // (toutes les photos d'équipe cassées). On autorise les qualités employées.
    qualities: [70, 75, 90, 95, 100],
    // Sans ces deux listes, Next génère les 8 `deviceSizes` et 8 `imageSizes`
    // par défaut pour CHAQUE image : autant de variantes à optimiser et à
    // garder en cache pour des largeurs que le site ne demande jamais. Même
    // jeu de largeurs commun au wiki, également pré-chauffé dans
    // le cache disque du CDN.
    deviceSizes: [768, 1024, 1920],
    imageSizes: [96, 256, 384, 512],
    // 24h au lieu des 60s par défaut : le CDN sert des assets versionnés.
    minimumCacheTTL: 86400,
    ...(CDN_LOADER && {
      loader: "custom",
      loaderFile: "./cdn-loader.ts",
    }),
    remotePatterns: [
      { hostname: "cdn.rosegriffon.fr", protocol: "https" },
      { hostname: "*.supabase.co", pathname: "/storage/v1/**", protocol: "https" },
      { hostname: "placehold.co", protocol: "https" },
      { hostname: "rosegriffon.fr", protocol: "https" },
      { hostname: "azalee.rosegriffon.fr", protocol: "https" },
      { hostname: "achillea.rosegriffon.fr", protocol: "https" },
      { hostname: "cdn.discordapp.com", protocol: "https" },
      { hostname: "static-cdn.jtvnw.net", protocol: "https" },
      // Vignettes des VOD et des clips Twitch (`TwitchEnrichedInfo.tsx`) :
      // deux hôtes distincts de celui des avatars, et ils manquaient. Next
      // répondait 400 sur chaque aperçu, la page RGTV affichait des cadres
      // noirs.
      { hostname: "vod-secure.twitch.tv", protocol: "https" },
      { hostname: "clips-media-assets2.twitch.tv", protocol: "https" },
      { hostname: "pbs.twimg.com", protocol: "https" },
      { hostname: "abs.twimg.com", protocol: "https" },
      { hostname: "dxi4wb638ujep.cloudfront.net", protocol: "https" },
      { hostname: "www.inazuma.jp", protocol: "https" },
      { hostname: "zukan.inazuma.jp", protocol: "https" },
      { hostname: "inazuma.jp", protocol: "https" },
      { hostname: "lh3.googleusercontent.com", protocol: "https" },
    ],
    dangerouslyAllowSVG: true,
    contentDispositionType: "attachment",
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default withBun(bundleAnalyzer(nextConfig), {
  projectDir: process.cwd(),
  bundler: "turbopack",
});
