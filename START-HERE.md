<!-- SPDX-License-Identifier: Apache-2.0 -->
# START HERE — à lire par tout agent avant de coder (Aphrody + Shenron)

Source canonique : `aphrody-labs/aphrody` → `START-HERE.md` (copie identique dans `aphrody-labs/shenron`).
Publié aussi dans Discord `#start-here`. État au 2026-10-08. Les faits datés se vérifient avant usage.

## 1. Équipe et identités
| Qui | GitHub | Discord | Rôle |
|---|---|---|---|
| Propriétaire (yoyo) | `aphrody-dev` | `goku_duo` 281114294152724491 | décide, admin |
| Omar | `KyrioFox` (confirmé par le propriétaire 2026-10-08) | `omlar_` 1527405876695142620 | admin aphrody-labs, compte Unix `omar` sur vps/dbfr |
| Bot Aphrody | — | `Aphrody` 1544463751279812740 | ops, annonces |
| Bot Shenron | — | `Shenron` 1497194276025663680 | dragonballfr.com |

Org GitHub `aphrody-labs` (3 membres, dépôts privés, lecture par défaut). Salon admin : `#admin-console` 1557354144149405806.

## 2. Règles non négociables
- Réponses et docs en français, code en anglais. Aucun humain dans la boucle : on va jusqu'au commit + push.
- Commits `aphrody-dev <contact@aphrody.com>`, **aucune** mention d'IA, aucun co-auteur, aucun trailer.
- `git add <chemins>` uniquement (jamais `-A`), `git pull --rebase --autostash` avant push, jamais de force-push ni `reset --hard`.
- Ne jamais toucher aux modifications non commitées d'une autre session. Revendiquer ses chemins (`.coord/claims`).
- **Aucun secret** (clé privée, token, `.env`, base de données, poids de modèles, build output) stagé, publié ou posté sur Discord. Les jetons passent hors bande.
- Corriger les erreurs préexistantes rencontrées (gate rouge, lint, chemin mort) dans le lot.
- Hôtes : plan avant apply, via Infra (`tools/config/host/`). Ne jamais toucher `wg0`, ni les règles ufw non commentées `aphrody-wg-*`, ni les services Shenron en production sans ordre.
- Fichiers source en LF (attention aux scripts Windows qui écrivent CRLF).

## 3. Lire ensuite
- Aphrody : `AGENTS.md`/`CLAUDE.md`, `PLAN.md`, `MEMORY.md`, `docs/operations/agent-tooling.md`.
- Shenron : `AGENTS.md` (= `CLAUDE.md`), `docs/reference/root/REPRISE.md` (not in repo), `data/home/MEMORY.md` (privé).
- Infra : `docs/operations/infra/PRIVATE-TUNNEL.md`, `docs/operations/infra/OMAR-REMOTE-CONTROL.md`, `docs/operations/container/CONTAINER.md`, `docs/operations/infra/SHENRON-DOCKER.md`.

## 4. Outils (ordre de préférence)
1. `aphrody` (Rust, binaire multi-call unique : `aphrody infra`, `aphrody git`, `aphrody mcp-server`, `aphrody shell`…) et le MCP `aphrody` (aphrody-mcp).
2. `yolo` (Bun) → 3. `bun` → 4. CLI Rust (`rg`, `fd`, `nu`…). Tout le reste est permis si besoin (git, cargo, uv, ssh, gh, pwsh).
- **Obligatoire** : commencer chaque tâche par le skill adapté (`yolo:yolo`, `aphrody:ecosystem`, `aphrody:deploy`,
  `yolo:docs`, `yolo:rust-target-check`…), les outils MCP `aphrody` (`ToolSearch`), puis la CLI propriétaire
  (table complète : `docs/operations/agent-tooling.md`). Discord : `aphrody discord send`, hôtes :
  `aphrody infra ssh exec --host …`, Windows : `aphrody winclean` / MCP. Python ad hoc, `curl` ou `ssh` brut seulement
  pour un manque réel, signalé dans le rapport.
- Toujours `--help` avant d'utiliser une sous-commande. GitHub : `aphrody git api|repo|search` (ou `gh` authentifié : l'API anonyme est vite limitée).
- Rust : gates scopés `cargo clippy -p <crate> --all-targets -- -D warnings` + `cargo test -p <crate>`. Cargo lourd / engines → fabrique VPS. Bun : `bun run typecheck|lint|format:check|test`.

## 5. Hôtes et tunnel privé wg1 (10.200.77.0/24)
| Hôte | IP wg1 | Accès | Notes |
|---|---|---|---|
| vps (hub) | 10.200.77.1 | `ssh vps` (ubuntu) | endpoint public 51.77.147.152:51821, `wg-quick@wg1`, fabrique de build, llama-server 8798/8799, bots Discord, downloads |
| wsl | 10.200.77.2 | — | conservé pendant la migration Windows |
| dbfr | 10.200.77.3 | `ssh dbfr` (ubuntu) | prod dragonballfr, `wg-quick@wg1` |
| aphro-pc (Windows, propriétaire) | 10.200.77.4 | — | tunnel natif Aphrody (tâche `\Aphrody\Aphrody WG aphro-pc`), MCP HTTP 127.0.0.1:8793 |
| omar (Windows) | 10.200.77.10 | — | installation en cours via son Codex |

- WireGuard est natif Rust dans `aphrody infra wg` (`plan|up|down|show|render|syncconf|keygen|pubkey|driver install`). Linux : noyau/boringtun ; Windows : WireGuardNT 1.1 vérifié sha256. Inventaire : `tools/config/host/wireguard/aphrody-tunnel.json`.
- Clés privées : restent sur leur hôte (`~/.aphrody/wireguard/aphrody.key`, ACL restreinte). Seules les clés publiques circulent.
- SSH mesh (en cours) : compte `omar` sur vps/dbfr (sudo NOPASSWD journalisé), OpenSSH Server Windows joignable uniquement depuis 10.200.77.0/24.

## 6. Contrôle à distance (computer use / bureau à distance)
- `aphrody infra remote serve --bind <ip-wg1>:8795` : bureau à distance JPEG/WebSocket + visionneuse navigateur, jeton `APHRODY_REMOTE_TOKEN`.
- `aphrody-mcp http` sur 8793 (bearer `APHRODY_MCP_HTTP_TOKEN`) ; build Windows avec `--features aphrody-mcp/winclean` pour les outils `computer_*`. Côté client : `RemoteComputerBackend` (session MCP stateful, `APHRODY_REMOTE_MCP_TOKEN`).
- Pare-feu : ports 8795/8793 (et 5900 VNC) ouverts **uniquement** depuis 10.200.77.4.
- En cours : unification computer use + VNC (`rustvncserver` serveur, `vnc-rs` client) + wg + remote + winclean + shell en un modèle de cible unique ; RDP (IronRDP) plus tard. RustDesk interdit (AGPL).

## 7. Build et release
- `cargo build --release --locked -p aphrody -p aphrody-mcp --features aphrody-mcp/winclean` produit le binaire complet Windows.
- Release publique : `bun run downloads:publish plan|build|release|verify --revision <sha>` → https://downloads.aphrody.com (`latest.json`). La release publiée au 2026-10-08 (5bf7eed5a) n'a pas encore `wg`/`remote` : nouvelle release en cours.
- Conteneur de build unique (Aphrody + Shenron) en cours dans `tools/config/container/`, utilisé par le runner self-hosted Shenron du vps.

## 8. En cours (2026-10-08) — ne pas dupliquer, coordonner
- Omar : tunnel + remote + MCP + SSH sur son PC (prompt Codex en 8 blocs + étape 12 dans `#admin-console`), jetons à remettre hors Discord.
- Unification remote/VNC, conteneur de build, release downloads, SSH mesh : agents actifs, voir `git log` et `.coord/claims` avant de toucher `crates/infra/{remote-desktop,wireguard}`, `crates/ai/agent-tools`, `tools/config/container`.
- Sécurité à traiter : routes REST hors `/mcp` non authentifiées ; secret Discord possiblement exposé dans `#admin-console` (19:44, à révoquer).

## 9. Rapport attendu de chaque agent
Fait / non fait / bloqué, commits (sha), gates exécutés et leurs résultats, ce qui n'est pas testé en réel. Jamais de secret dans un rapport.
