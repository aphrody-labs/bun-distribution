# @rosegriffon/auth

Logique d'authentification et gardes de sécurité partagés.

## Contenu

- **Bridge Profil :** Réconciliation entre les IDs d'utilisateurs `Better Auth` et les profils `Supabase`.
- **RBAC :** Helpers pour vérifier les rôles (`isAdmin`, `isStaff`).
- **Garde Serveur :** `createAdminGuard` pour sécuriser les routes et Server Actions.

## Utilisation

```typescript
import { resolveProfile } from "@rosegriffon/auth";

// Dans un Server Action
const user = await requireAuth();
const profile = await resolveProfile(supabase, user);
```

## Architecture

- Le package dépend de `better-auth` pour la gestion des sessions.
- Il utilise `@rosegriffon/db` pour la lecture des profils et des comptes liés (Discord, GitHub, Twitch, Google, etc.).
- La configuration Better Auth du site est centralisée dans `createRoseGriffonAuth`.
  `apps/website/src/lib/auth.ts` fournit le pool PostgreSQL (compatible PostgreSQL 17 et 18), l'envoi de
  courriels, les cookies Next.js et l'adaptateur Patreon.
- **Identité d'expédition et automatisation des courriels :**
  L'identité canonique d'envoi et d'authentification transactionnelle est `contact@aphrody.com` (OVH SMTP `ssl0.ovh.net:465` TLS implicite), avec repli applicatif pour Rose Griffon.
- **Fournisseurs OAuth Sociaux :**
  - Discord (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`)
  - GitHub (`GITHUB_CLIENT_ID` / `AUTH_GITHUB_ID`, `GITHUB_CLIENT_SECRET` / `AUTH_GITHUB_SECRET`)
  - Twitch (`TWITCH_AUTH_CLIENT_ID`, `TWITCH_AUTH_CLIENT_SECRET`)
  - Google (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`)
  - Patreon via `genericOAuth`
- **Origines de confiance (`trustedOrigins`) :**
  Couvre les domaines publics de production (`rosegriffon.fr`, `achillea.rosegriffon.fr`, `dragonballfr.com`), les applications locales (:3000, :3001, :5011) et les contextes natifs desktop Tauri (`tauri://localhost`, `http://tauri.localhost`).
- L'instance Elysia de l'API reste séparée dans `@rosegriffon/auth/elysia` :
  elle expose MCP et les capacités Agent Auth, tandis que le site expose le
  provider OAuth navigateur. Les deux partagent `commonAuthOptions` et le
  même modèle de rôles métier.
