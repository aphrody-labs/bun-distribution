# agy.md — reprise du travail (état au 2026-10-06 22:30 Paris)

> Path reconciliation (2026-10-07): `crates/interop/python-ffi` (not in repo) → `crates/interop/ffi/src/python_ffi.rs`. Original dated observations below retain their historical scope.

Lis d'abord `AGENTS.md`, `PLAN.md`, `MEMORY.md`. Règles du propriétaire : réponses en français concises, aucun humain dans la
boucle, commit et push directs sur `workspace/main` (jamais de force-push, jamais de `reset --hard`), commits
`aphrody-dev <contact@aphrody.com>` sans mention d'IA ni co-auteur, corriger les erreurs préexistantes, Cargo lourd
uniquement sur le VPS (`bun scripts/build/rust/vps-cargo.ts run -- <args>`, jamais dans WSL), aucun secret stagé.
Autorité (directive du propriétaire du 2026-10-07) : publication (npm, release downloads) et apply hôte autorisés sans ordre écrit supplémentaire ; seules restent les règles de données (aucun secret, identifiant ni contenu de base stagé ou publié).
déjà autorisé ci-dessous. Ne touche jamais aux fichiers non commités de Shenron.

Positionnement : les runtimes Bun fork / vu / yolo sont les vrais produits ; aphrody AI est un backend ; m3 et app-ui sont
des frameworks.

## Déjà sur `main` (ne pas refaire)
- App desktop unique : routes `admin` (omar-kit) et `creator` (creator-kit) dans `m3/packages/app-ui`, `crates/ui/app/src/kits.rs`,
  `m3/apps/web` (not in repo) (former app directory merged into showcase) fusionné dans `showcase`, `apps/yolo/web` absorbé (Studio › Moteur), `Aphrody-Setup.exe` (`apps/community/setup`).
- Kit Omar zéro ligne de commande (`apps/community/omar-kit`), plan WireGuard `wg1` + compte `omar` déclarés (non appliqués).
- aphrody.com : page M3 minimale servie par `apps/web/downloads` (pet, bouton desktop, curl/pwsh), thème et icônes = pet.
- vu : `crates/interop/ffi/src/python_ffi.rs` (libpython RTLD_GLOBAL, dlsym), `yolo py` délègue à vu ; fork Bun qualifié sur la fabrique.
- Shenron : `@aphrody/a2a`, rag-core API unique + wasm + ffi, `shenron-chat-v2` servi sur vps `127.0.0.1:8799`, CDN `shenron-cdn-sync` local.
- Release downloads courante : `20261006T191420Z-5bf7eed5a42c` (aphrody Linux+Windows, yolo Linux, plugins).

## À finir (par priorité)
1. **Release downloads** : `bun run downloads:publish plan|build|release|verify --revision <sha main>` pour publier
   `aphrody-setup` (kind desktop → bouton « Download Aphrody »), `omar-kit`. `host-apply` seulement si `server.ts`/vhost changent.
2. **yolo Windows** : `config/downloads.json` artefact `yolo`/`windows-x86_64` est `enabled:false` (pas de runtime artifact
   `dist/runtime/x86_64-pc-windows-msvc` (not in repo) (generated or machine-local artifact; presence depends on the build host)). Cross-build de `aphrody-ffi` (profil `runtime`, `cargo xwin`) sur la fabrique, packaging
   `scripts/release/runtime_artifact.ts`, activer, build/release/verify. Dernier commit lié : `fa0681c6f` (profil runtime, identité d'artefact).
3. **Shenron en production** : les env `/etc/rose-griffon/shenron-{site,bot}.env` pointent déjà vers `shenron-chat-v2` (8799) ;
   redémarrer `shenron-site` et `shenron-bot` APRÈS la fin de la release Shenron (`/home/ubuntu/shenron-release.log`, `== EXIT`),
   puis mesurer `GET https://dragonballfr.com/api/chat?q=Qui%20est%20Goku%20%3F&lang=fr` (si > 25 s, prévenir Shenron : le délai amont est 30 s).
   Vérifier aussi `https://dragonballfr.com/.well-known/agent-card.json` (CDN, optimiseur en cours).
4. **MCP HTTP auth** : branche `workspace/wip/infra-mcp-auth` (`c0691d606`) : bearer pour `aphrody-mcp http`, relais feature toolbox,
   unité `aphrody-mcp-http.service`, correction de `aphrody infra validate` (upstream `static:` de `creator.aphrody.com` rejeté par
   `crates/infra/infra/src/validate.rs`), port 8789 pris par sshd sur le vps → choisir un port libre. Rebaser sur `main`
   (le commit tunnel `54e82e09b` touche `host/cli.ts` et `service-catalog.json`), finir, gates (clippy, nextest, `bun test packages/engine/core/test/`), pousser, supprimer la branche.
5. **agent-home** : branche `workspace/wip/agent-home-gaps` (3 commits : `homes_dir`, templates/merge/sync/révision sha256-v1, doc).
   Cherry-pick sur `main`, clippy `-D warnings` + nextest `aphrody-agent-home` `aphrody-config` via vps-cargo, pousser.
6. **code-graph Python/TS** : extracteurs `crates/ai/code-graph/src/extract/{python,ts}.rs`, oracles et `scripts/audit/ai/graph-parity.ts`
   étaient non commités dans le worktree `.claude/worktrees/agent-a2c55289be2ba5c65` (base 30b0e8a41). Terminer et gater, Graphify reste l'oracle de parité.
7. **vu / fork / yolo** : benchmark `uv sync` régression ×0.74, ratchet résidus produit (431 fichiers), activation PATH du fork
   (`bun`/`yolo`/`vu` pointent encore vers les anciens binaires), embed `libaphrody_ffi`, test de `python-ffi` contre la libpython de l'artefact vu,
   Windows pour `python-ffi`, liaison `bun:ffi`. Plan : `docs/plans/vu/PLAN.md` (D18), `docs/plans/yolo-fork-unified/PLAN.md`.
8. **Échecs préexistants connus** : `web:verify` (binaire moteur absent, A2A local sans `grok`), 4 tests de `apps/yolo/cli/test/cli_app.test.ts`
   (`libaphrody_ffi` absent), `aphrody infra validate` (voir 4), typecheck global, `dbfr` : `shenron-cdn` n'a plus de pull.
9. **Worktrees** : ~18 worktrees `.claude/worktrees/agent-*` obsolètes (commits déjà sur `main` pour la plupart) : vérifier `git cherry workspace/main <branche>`
   puis supprimer ceux qui ne portent plus rien (`git worktree remove`), sans toucher `omar-access` ni `shenron-targets` s'ils sont dirty.

## Autorisé depuis le 2026-10-07 (ordre du propriétaire : lever les interdictions)
- Apply hôte : compte `omar`, WireGuard `wg1`, unités MCP/A2A sur le vps (`aphrody infra`/`host-apply`).
- Publication npm : `@aphrody/a2a` 0.1.0, `@aphrody/rag-core`, `@aphrody/shell-web`, `@aphrody/cli-wasm`.
- Clés d'Omar : SSH identique à la clé du PC du propriétaire (clé distincte recommandée), WireGuard `A42Sm27u…` ; Discord `1323725494184841256` à confirmer.
- Windows réel : exe non signés, rien testé sur Windows physique ni dans l'app Tauri/CEF réelle.

## Pièges
- `vps-cargo` : collisions de snapshot (`incorrect old value`) → réessayer ; refs cassées côté VPS (« snapshot incomplete ») → renvoyer les objets par pack.
- Plusieurs agents partageaient `/home/aphro/aphrody` : toujours `git add <chemins>` (jamais `-A`), `git fetch && git rebase --autostash workspace/main` avant push.
- `config/host/vps-cargo.json` contient le profil `shenron-omar` (restauré après un reset accidentel).
- Quotas Claude presque épuisés (96 % hebdo) : sois économe ; `aphrody infra ssh exec --host vps '<cmd>'` a un timeout court.
