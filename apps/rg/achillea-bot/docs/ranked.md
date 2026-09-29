# Achillea Ranked — serveur Colyseus

Module Colyseus 0.17 + Postgres — **lancé comme sub-process Bun ESM par le service `achillea-bot.service`** au démarrage du bot (cf `src/main.ts`). Le bot tourne en CJS compilé (cycles Mikro-ORM), le sub-process tourne en ESM Bun direct (Colyseus + `@colyseus/schema` ESM-only).

Pas de service systemd séparé : le ranked vit/meurt avec le bot. Logs streamés sur le journal `achillea-bot`.

## Démarrer en local

```bash
# Variables : héritées du .env du bot (DATABASE_*, JWT_SECRET_KEY)
# Override possible via .env.ranked

cd ~/vps/apps/achillea-bot
bun src/ranked/main.ts                  # standalone (sans le bot)
# Logs : [ranked] Colyseus server listening on :4002

# Lancement complet (bot Discord + REST + Socket.IO + ranked sub-process) :
bun run dev
```

## Architecture

```
                    ┌─────────────────┐
   wss://ranked     │  Bun.serve      │
   .rosegriffon.fr  │ + BunWebSockets │
   ───────────────► │ + Express compat│
                    │  port :4002     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
         QueueRoom       MatchRoom      REST routes
         (matchmaking) (state schema)  /api/ranked/*
                                       /api/admin/*
                             │
                             ▼
                    ┌────────────────┐
                    │  Postgres      │
                    │  (Mikro-ORM    │
                    │   tables)      │
                    └────────────────┘
```

## Tables touchées (raw SQL via `Bun.SQL`)

- `event` (RANKED perpétuel — créé à la volée)
- `lobby` / `lobby_user` / `lobby_match` (snapshots des matches)
- `user_elo` (rating par mode + season)
- `season` (lecture seule, kFactor + baseRating)
- `rank` (lecture seule, paliers + gradients)
- `user` (lecture seule, displayName + avatar + role admin)

## Endpoints

### WebSocket (Colyseus protocole)

- `joinOrCreate("queue", { mode })` — entre dans la file matchmaking
- `joinById(roomCode)` — rejoint une MatchRoom existante (reconnect)

### REST

| Méthode | Path                              | Auth           | Description                                                     |
| ------- | --------------------------------- | -------------- | --------------------------------------------------------------- |
| GET     | `/api/health`                     | none           | Healthcheck                                                     |
| GET     | `/api/ranked/me?mode=2`           | cookie `token` | Profil ELO + tier courant                                       |
| POST    | `/api/ranked/:lobbyId/dispute`    | cookie `token` | Upload multipart `screenshot` (max 5MB)                         |
| GET     | `/api/admin/lobbies/disputes`     | role ≥ Admin   | Liste matches contestés                                         |
| POST    | `/api/admin/lobbies/:id/validate` | role ≥ Admin   | Tranche un match : `{ scoreTeam1, scoreTeam2, forfeitUserId? }` |
| GET     | `/storage/disputes/...`           | none           | Static screenshots                                              |

## Variables d'environnement

Héritées de `.env` du bot :

- `DATABASE_*` (host, port, user, password, name)
- `JWT_SECRET_KEY` — secret serveur partagé par l’API, Socket.IO et le process ranked ; il ne doit
  jamais être exposé au frontend

Spécifiques (avec défauts) :

- `RANKED_PORT` (4002)
- `RANKED_STORAGE_DIR` (`./storage/disputes`)
- `RANKED_ALLOWED_ORIGINS` (CSV : domaines achillea/test)
- `RANKED_PERPETUAL_EVENT_ID` (forçage event id, sinon résolu en DB)
- `BUN_SQL_MAX` (10), `BUN_SQL_IDLE_TIMEOUT` (30), `BUN_SQL_CONNECT_TIMEOUT` (10)

## Déploiement

L'infrastructure historique (systemd, nginx, certificats et configuration VPS) n'est pas
incluse dans le workspace `apps/achillea-bot`. Elle devra être conçue et validée séparément
avant tout déploiement ; ce portage ne fournit aucune commande d'installation ou de
redémarrage de service.

## Flow d'un match (1v1)

1. Client A et B → `joinOrCreate("queue", { mode: 2 })`
2. `QueueRoom.tryMatch()` apparie A et B (elo±200, fenêtre élargie après 5s)
3. `matchMaker.createRoom("match", { mode, players })` → MatchRoom créée
4. A et B reçoivent `matched: { reservation }` → `consumeSeatReservation`
5. Status `waiting → playing` quand les 2 joueurs sont connectés
6. Chat en temps réel via `room.send("chat", { text })`
7. Bouton "Match fini" → `room.send("finish")` ; quand les 2 ont confirmé → status `scoring`
8. Saisie score `room.send("submitScore", { score })` ; quand les 2 ont saisi :
   - scores différents → status `finished`, persist `Lobby` + `LobbyMatch` + update `UserElo`, broadcast `matchEnded`
   - scores identiques → status `disputed`, persist `Lobby state=Contested`, popup screenshot
9. Si disputed : admin via REST `/api/admin/lobbies/:id/validate` tranche → status `Finished`, recalcul ELO

## Timeout

Si un joueur ne saisit pas son score dans les **5min** après passage en `scoring`, son score est forcé à 0 (forfait implicite) et le match est résolu.

## TODO post-MVP

- Mode 2v2 (state schema déjà multi-joueurs ready)
- Reconnect handling (`allowReconnection`)
- ETA matchmaking calculé (moyenne mobile temps de queue)
- Worker séparé pour calcul ELO si charge
- Replays / historique côté frontend (`/api/ranked/history`)
