<!-- SPDX-License-Identifier: Apache-2.0 -->
# Cartographie `aphrody agy` — forwarder, binaire `agy` (Antigravity CLI) et écosystème

Document d'analyse (lecture seule). Distingue systématiquement **[VÉRIFIÉ CODE]**
(lu dans le source Rust / inspection binaire / fichiers de config réels) de
**[HELP]** (déduit d'un `--help`) et **[DOC]** (énoncé dans `README.md` voisin,
non revérifié dans le code). Toutes les références `fichier:ligne` pointent dans
`~/aphrody`.

Secrets : les fichiers `mcp_config.json` d'agy contiennent des tokens en clair
(GitHub PAT, Supabase, Vercel) — ils sont **caviardés** ici et ne doivent pas être
recopiés.

---

## 0. TL;DR

`aphrody agy [ARGS...]` est un **forwarder mince** : il résout le binaire natif
`agy` (Antigravity CLI de Google), le spawn avec stdio hérité, passe les ARGS
verbatim et propage le code de sortie. Il ne parle PAS lui-même au modèle.

`agy` est un binaire **Go**, fork **Codeium/Windsurf** rebrandé « Antigravity »,
qui parle au backend Google **Cloud Code `v1internal`** (Gemini, et selon le tier
Claude/GPT-OSS). Sa config vit dans `~/.gemini/` (pas `~/.codeium/windsurf/` sur
cette machine).

Trois surfaces aphrody coexistent : `agy` (forward binaire) · `antigravity`
(client RPC pur Rust, sans binaire) · `agent` (réimplémentation agent en Rust).
`agy-loop` greffe une boucle autonome sur `agy` via ses hooks `Stop` (pilote) et
`PostInvocation` (comptage par tour) ; `AfterAgent` n'existe pas côté agy (§3).

---

## 1. Le forwarder `aphrody agy` [VÉRIFIÉ CODE]

### 1.1 Déclaration de la commande

- Variante CLI : `apps/cli/src/lib.rs:166` — `Commands::Agy { args: Vec<String> }`,
  doc-comment lib.rs:162-164.
- Dispatch : `apps/cli/src/lib.rs:1026-1028` → `commands::AgyCommand { args }.execute(ctx)`.
- Nom de télémétrie : `apps/cli/src/lib.rs:1584` (`Commands::Agy { .. } => "agy"`).

### 1.2 Résolution du binaire `agy`

Fonction `resolve_agy_bin()` — `apps/cli/src/commands.rs:627-657`. Premier match
gagne :

| Priorité | Source | Détail (code) |
|----------|--------|---------------|
| 1 | `$APHRODY_AGY_BIN` | const `ENV_AGY_BIN` (commands.rs:619). Trim, doit être non vide ET exister (`p.exists()`), sinon ignoré. |
| 2 (Windows) | `%LOCALAPPDATA%\agy\bin\agy.exe` | `cfg(target_os="windows")`, commands.rs:635-641 — chemin écrit par `install.ps1` officiel. |
| 3 (Unix) | `$HOME/agy/bin/agy` puis `$HOME/.local/share/agy/bin/agy` | `cfg(not(windows))`, commands.rs:643-654. |
| 4 | `which("agy")` (PATH) | commands.rs:656. |

> Écart doc/code à noter : le doc-comment de la variante (`lib.rs:164`) résume la
> chaîne comme « `$APHRODY_AGY_BIN > %LOCALAPPDATA%\agy\bin\agy.exe > PATH` » et
> n'expose PAS les deux chemins Unix `$HOME/agy/bin/agy` et
> `$HOME/.local/share/agy/bin/agy` que `resolve_agy_bin` essaie réellement
> (étape 3). Le message d'erreur (commands.rs:671-676) reprend aussi la version
> abrégée. Le comportement réel inclut bien les chemins Unix.

Sur cette machine, `agy` est résolu via PATH : `~/.local/bin/agy`
(`which agy`). [VÉRIFIÉ]

### 1.3 Passthrough / exécution

`AgyCommand::execute` — `apps/cli/src/commands.rs:666-690` :

```
std::process::Command::new(&bin_path).args(&self.args).status()
```

- **Stdio hérité** (pas de capture) → l'enfant a accès au TTY ; le TUI agy
  fonctionne donc en direct. commands.rs:680-683.
- **Args verbatim** : aucun parsing/réécriture par aphrody — `clap` capture tout
  dans `args: Vec<String>` (trailing).
- **Code de sortie propagé** : sur échec, `SubprocessExit(status.code())` est
  remonté tel quel (commands.rs:685-687).
- **Binaire absent** ⇒ erreur `miette` actionnable (« Antigravity CLI (`agy`)
  introuvable… Override : `APHRODY_AGY_BIN=/abs/path` »), renvoie vers
  `aphrody antigravity` pour la surface sans binaire (commands.rs:669-678).

### 1.4 Feature-gate, async, plateforme

- Pas de feature-gate Cargo dédié sur la sous-commande `agy` elle-même (contraste
  avec `images`/`firefly`/`forensics`/`index`, host-only). Le forwarder est
  toujours présent dans le CLI.
- `AgyCommand` implémente `TerminalCommand` (trait async) mais l'exécution est un
  spawn synchrone bloquant — pas de tokio dans le hot-path.
- Comportement **identique Linux/Windows/macOS** : seule la résolution du chemin
  diffère (cfg-gated). Le spawn est portable.

---

## 2. Le binaire `agy` (Antigravity CLI) [VÉRIFIÉ — inspection binaire + helps + config]

### 2.1 Nature

`file ~/.local/bin/agy` → **ELF 64-bit Go** (pie, x86-64). `strings` confirment
sans ambiguïté un **fork Codeium/Windsurf** rebrandé Antigravity :

- Protos internes Codeium : `codeium_common_go_proto.*`, `exa.language_server_pb.*`
  (`LanguageServerService/StreamCascadePanelReactiveUpdates`, `CreateWorktree`,
  `LoadTrajectory`…), `exa.cortex` / `cortex_go_proto`, `exa.chat_client_server_pb`,
  `exa.api_server_pb`, `exa.index_pb`, `exa.seat_management_pb`,
  `exa.opensearch_clients_pb.KnowledgeBaseService`, `jetski/cmd/cli` (chemin source
  Google interne), formateur `TOOL_FORMATTER_TYPE_HERMES`.
- Vocabulaire « Cascade », « Supercomplete », « trajectory », « knowledge base »
  = lexique Windsurf/Codeium.
- Surfaces produit Antigravity : `Antigravity Browser` (CDP/Playwright,
  screenshots, console logs), `antigravity_download_*.zip`, `AntigravityProject`.

### 2.2 Backend modèle

- Cible **Google Cloud Code `v1internal`** : RPC `LoadCodeAssist`, `OnboardUser`,
  `FetchAvailableModels`, `GenerateContent`, `GetCodeAssistGlobalUserSetting`…
  (`google.internal.cloud.code.v1internal.*` dans le binaire) + Vertex
  `aiplatform` (`prediction_service_go_proto`).
- Providers présents : `API_PROVIDER_GOOGLE_GEMINI`, `API_PROVIDER_GOOGLE_VERTEX`,
  `API_PROVIDER_OPENAI_VERTEX` ; ids modèles trouvés : `claude-sonnet-4-5@20250929`
  (+ labels Gemini 3/2 selon tier). [DOC] README liste Gemini 3.5 Flash, 3.1 Pro,
  Claude Sonnet/Opus, GPT-OSS 120B selon le plan AI Ultra.
- Auth : token OAuth « consumer » (cf. §6). Le wire-id réel servi par Cloud Code
  pour le label « Gemini 3.5 Flash » est `gemini-3-flash-preview` sur l'hôte
  **Daily** (`daily-cloudcode-pa.googleapis.com`) — fait observé côté aphrody et
  documenté dans `agy_backend.rs:22-39`.

### 2.3 Skills / BRIEFING / hooks (protocole interne agy)

- **Briefing protocol** [VÉRIFIÉ strings] : le binaire embarque des directives
  « Read `BRIEFING.md` and `ORIGINAL_REQUEST.md` », « Update your BRIEFING.md… »,
  « NEVER archive `BRIEFING_ARCHIVE.md` », table « Key Artifacts | progress.md,
  BRIEFING.md, PROJECT.md ». C'est le système de mémoire/contexte de session agy.
- **Skills** : agy importe des skills depuis plugins (cf. §3). Sur cette machine
  les skills universels atterrissent dans `~/.gemini/config/skills/` (ex.
  `youtube-*`, `m3-monorepo-guidance`) [VÉRIFIÉ], et les skills de plugin sous
  `~/.gemini/config/plugins/<plugin>/skills/`. La piste `~/.codeium/windsurf/skills/`
  existe aussi (skills importés côté Claude) mais n'est PAS la racine de config
  active d'agy ici.
- **Hooks** [VÉRIFIÉ strings] : `Loaded hooks.json from %s: %d named hooks, %d
  total handlers` → agy charge bien des `hooks.json`. Événements de cycle de vie
  documentés dans le binaire : `PreToolUse`, `PostToolUse`, `PreInvocation`,
  `PostInvocation`, `Stop` (les protos internes ajoutent `SessionStart`).
  **`AfterAgent` / `BeforeAgent` n'existent pas dans agy** (aucune occurrence
  dans le binaire ; ce sont des noms du Gemini CLI) — cf. §3.
- **MCP** : `RefreshMcpServers`, `ListMcpPrompts`, `McpCommandTemplate`,
  `McpBrowserRecordingStartHook` → support MCP natif (stdio + HTTP).

### 2.4 Sous-commandes & flags `agy` [HELP — `agy --help`, `agy plugin --help`]

Sous-commandes : `changelog`, `help`, `install`, `plugin` (alias `plugins`),
`update`. (Le `agy inspect`/`agy plugin import gemini` cités dans le README ne
remontent pas dans ce `--help` de cette version — `plugin` expose ici `list /
import [source] / install / uninstall / enable / disable / validate / link /
help`.)

Flags top-level :

| Flag | Rôle |
|------|------|
| `-p` / `--print` / `--prompt` | Prompt unique non-interactif, imprime la réponse |
| `--print-timeout` | Timeout d'attente du mode print (**défaut 5m0s**) |
| `-i` / `--prompt-interactive` | Prompt initial puis continue en interactif |
| `-c` / `--continue` | Reprend la conversation la plus récente |
| `--conversation` | Reprend une conversation par ID |
| `--add-dir` | Ajoute un répertoire au workspace (répétable) |
| `--dangerously-skip-permissions` | Auto-approuve toutes les permissions d'outils |
| `--sandbox` | Sandbox avec restrictions terminal |
| `--log-file` | Override du fichier de log CLI |

`agy plugin` : `list`, `import [gemini|claude]`, `install <target>` (supporte
`plugin@marketplace`), `uninstall <name>`, `enable`, `disable`, `validate [path]`,
`link <mp> <target>`.

### 2.5 TTY / sessions

- Le mode interactif (TUI) **exige un TTY** ; comme `aphrody agy` hérite la stdio,
  il marche en direct. Le mode `-p/--print` est headless mais **borné par
  `--print-timeout` (5m)** — d'où le « timeout chez nous » : sans TTY ni réponse
  rapide, le print attend jusqu'au plafond.
- **Conversations** persistées : `~/.gemini/antigravity-cli/conversations/` +
  `brain/<uuid>/` (transcripts `transcript.jsonl` / `transcript_full.jsonl`),
  `history.jsonl` ; reprise via `-c` / `--conversation <id>`. [VÉRIFIÉ fichiers]

---

## 3. `aphrody agy-loop` — boucle autonome [VÉRIFIÉ CODE]

Source unique : `apps/cli/src/agy_loop.rs` (dispatch `Commands::AgyLoop` dans
`apps/cli/src/lib.rs`). **Pas de feature-gate** (hors wasm32).

> **Correction de contrat (2026-10-01).** Une version antérieure de ce document
> et du driver décrivait la boucle comme pilotée par un hook `AfterAgent` et
> par `{"decision":"deny"}`. C'est le contrat du **Gemini CLI**, pas celui
> d'agy : le binaire `agy` ne contient aucun évènement `AfterAgent` ni
> `BeforeAgent`. Contrat agy réel ci-dessous [VÉRIFIÉ — documentation embarquée
> dans le binaire `agy` et protos `hooks_go_proto` ; non exécuté de bout en
> bout]. Le SDK Python `antigravity-sdk-python` n'a pas non plus ces noms : il
> expose `OnSessionStart`, `OnSessionEnd`, `PreTurn`, `PostTurn`,
> `PreToolCall`, `PostToolCall`, `OnToolError`, `OnInteraction`,
> `OnCompaction` et `Stop` (hook `StopHook` : `ALLOW_STOP` ou `CONTINUE` +
> `reason`). Le tableau de normalisation des évènements entre outils appartient
> à `aphrody-marketplace`, pas à ce document.

### 3.1 Principe

`agy` n'a aucun mode « continue jusqu'à terminé ». La boucle est implémentée via
deux hooks d'agy : **`Stop`** (pilote) — quand la boucle d'exécution de l'agent
se termine, agy invoque `aphrody agy-loop hook --event stop`, qui décide de
relancer l'agent ou de le laisser s'arrêter — et **`PostInvocation`**
(comptabilité par tour) — après chaque invocation du modèle,
`aphrody agy-loop hook --event post-invocation` compte le tour et capte la
sentinelle de fin sans jamais rien forcer. Il n'y a **aucun process daemon** :
`start`/`stop`/`status` ne font que manipuler des fichiers d'état dans le
workspace ; le « moteur » est agy lui-même qui rappelle le hook.

### 3.2 Câblage dans un `hooks.json` d'agy [VÉRIFIÉ — doc embarquée du binaire]

Un `hooks.json` d'agy est un objet dont chaque clé de premier niveau est un
**nom de hook** ; sous ce nom, une liste par évènement. `Stop` et
`PostInvocation` sont des listes « plates » de gestionnaires (le `matcher` est
réservé à `PreToolUse`/`PostToolUse`). Fragment exact, produit par le code
(`aphrody agy-loop hooks-json`) :

```json
{
  "aphrody-loop": {
    "PostInvocation": [
      { "type": "command", "command": "aphrody agy-loop hook --event post-invocation", "timeout": 10 }
    ],
    "Stop": [
      { "type": "command", "command": "aphrody agy-loop hook --event stop", "timeout": 10 }
    ]
  }
}
```

Emplacements lus par agy : `<workspace>/.agents/hooks.json`, le fichier partagé
`~/.gemini/config/hooks.json` et `plugins/<nom>/hooks.json` d'un plugin. Les
commandes sont lancées depuis le dossier du `hooks.json` (donc pas depuis le
workspace : le driver lit `workspacePaths` dans le JSON reçu). Les payloads
sont en **camelCase** (protojson).

État de cette machine au 2026-10-01 : aucun `hooks.json` agy n'existe
(`~/.gemini/config/hooks.json` absent, pas de dossier `plugins/`), donc la
boucle n'est câblée nulle part tant que le fragment ci-dessus n'est pas
installé. L'ancien câblage `AfterAgent` décrit auparavant ici (plugin `aphrody`
importé `source: claude-code`) suivait le format Gemini CLI
`{"hooks":{"AfterAgent":[…]}}` : agy ne connaît pas cet évènement, il ne
pouvait pas relancer la boucle.

### 3.3 Sous-commandes [VÉRIFIÉ CODE — `AgyLoopAction`, `apps/cli/src/agy_loop.rs`]

| Cmd | Effet (code) |
|-----|--------------|
| `start --goal "<txt>" [--max N]` | Écrit `.agents/aphrody-loop.json` (not in repo) (`goal`, `iteration:0`, `max_iterations`, `started_at`, compteurs `invocations`, `last_invocation_num`, `done_seen`, `error_streak`). `--max` défaut **50** (`DEFAULT_MAX_ITERATIONS`). Lève un éventuel marqueur stop résiduel. |
| `stop` | Pose `.agents/aphrody-loop.stop` (not in repo) ET efface l'état. Le stop est capté au prochain hook. |
| `status` | Imprime l'état JSON courant, ou « (boucle inactive) ». |
| `hook [--event stop\|post-invocation\|after-agent]` | Driver stdin/stdout — **pas pour usage manuel**. Sans `--event`, l'évènement est déduit du JSON (`hook_event_name`, sinon `invocationNum` ⇒ `PostInvocation`, `prompt_response` ⇒ `AfterAgent` hérité, `Stop` par défaut). |
| `hooks-json` | Affiche le fragment `hooks.json` agy ci-dessus (pas d'écriture de fichier). |

### 3.4 Le driver `hook` (cœur de la boucle) [VÉRIFIÉ CODE — `handle_hook_in`, `judge`]

Entrée `Stop` d'agy (stdin, camelCase) : `executionNum`, `terminationReason`
(`model_stop`, `max_steps_exceeded`, `error`, …), `error`, `fullyIdle`,
`finalModelOutput` + champs communs (`conversationId`, `workspacePaths`,
`transcriptPath`, `parentConversationId`, …). Sortie attendue (stdout) :
`{"decision":"continue","reason":…}` ; `continue` bloque l'arrêt et injecte
`reason` en message système, toute autre valeur laisse l'agent s'arrêter. agy
plafonne lui-même les continuations consécutives d'un hook `Stop` (champ
`MaxStopHookContinuations` de la config de l'exécuteur, valeur par défaut non
vérifiée ; changelog embarqué : « after a configurable number of consecutive
continuations, the hook can no longer block ») : `--max` s'y ajoute, le plus bas
des deux gagne ; l'état reste armé et la boucle reprend au prochain arrêt.

1. Lit le JSON du hook sur **stdin** (tolérant : stdin vide ⇒ no-op, ne casse
   jamais agy ; une E/S d'état en échec est journalisée sur stderr et la
   réponse devient `{}`).
2. Résout le workspace : `workspacePaths` (agy), puis `cwd` (Gemini CLI), puis le
   répertoire courant du hook (et son parent si c'est `.agents`).
3. **Boucle inactive** (pas de `.agents/aphrody-loop.json` (not in repo)) ⇒ émet `{}` et sort
   (n'interfère jamais avec un arrêt normal). Une conversation de sous-agent
   (`parentConversationId` non vide) ⇒ `{}` aussi.
4. `PostInvocation` : incrémente `invocations`, retient `invocationNum`, capte la
   sentinelle dans `modelOutput` (`done_seen`) ; répond `{}` — jamais de
   `terminationBehavior`/`injectSteps`.
5. `Stop` : **Terminaison** si `finalModelOutput` (ou `done_seen`) porte le
   jeton `APHRODY_LOOP_DONE` **seul sur une ligne** (`DONE_SENTINEL` ; une simple
   mention dans une phrase ne compte pas) OU si stop demandé ⇒ efface l'état,
   émet `{"decision":"allow_stop","reason":"…objectif atteint…"}`.
6. **Interruption utilisateur** (`terminationReason` contenant `cancel`) ⇒
   désarme et laisse s'arrêter. **Garde anti-emballement** : `iteration >= max`
   ⇒ efface l'état, rend la main avec un message ; 3 arrêts consécutifs sur
   erreur (`terminationReason`/`error`) ⇒ idem.
7. **Sinon** : incrémente `iteration`, sauvegarde, émet
   `{"decision":"continue","reason":<directive>}`.

Dialecte hérité : avec `--event after-agent` (ou `hook_event_name` =
`AfterAgent`) le driver garde la sortie Gemini CLI
`{"decision":"deny","reason":…}` / `{"continue":true,…}` ; ce n'est pas un
contrat agy et rien ne le câble pour agy.

La **directive** réinjecte l'objectif + « itération i/max », exige du vrai code
(zéro stub/TODO), build+tests verts, commit, et de n'émettre `APHRODY_LOOP_DONE`
seul sur la dernière ligne que lorsque tout est vert et committé.

### 3.5 Logging / état

- État : `.agents/aphrody-loop.json` (not in repo) (`STATE_REL`, l.29) ; stop :
  `.agents/aphrody-loop.stop` (not in repo) (`STOP_REL`, l.32) — relatifs au **workspace**.
- Pas de fichier de log dédié côté aphrody-loop : la trace vit dans les
  transcripts d'agy (`~/.gemini/antigravity-cli/brain/<uuid>/.system_generated/
  logs/transcript*.jsonl`) [VÉRIFIÉ — le terme `agy-loop` y apparaît].
- Pur Rust, stdin→fichier, **identique** Linux/Windows/macOS (l.14-15). Horodatage
  ISO-8601 maison via `std::time` (l.240-258), sans dépendance lourde.

---

## 4. `agy` vs `antigravity` vs `agent` — trois surfaces distinctes

| Surface | Nature | Backend | Binaire ? | Code |
|---------|--------|---------|-----------|------|
| `aphrody agy` | **Forward** vers le binaire natif `agy` (Go/Codeium) | Cloud Code `v1internal` (par agy) | **Oui** (résout `agy`) | commands.rs:614-690 |
| `aphrody antigravity` | **Client RPC pur Rust** (surface API token + RPC, scriptable, JSON) | `cloudcode-pa` v1internal directement | **Non** | crates/aphrody-antigravity/*, cli/src/antigravity_cmd.rs |
| `aphrody agent` | **Réimplémentation agent en Rust** (« Antigravity-in-Rust » flagship) | Client Gemini live (`GEMINI_API_KEY`/`GOOGLE_API_KEY`) ou `--stub` | **Non** | crates/aphrody-agent-runtime, cli/src/agent_cmd.rs, agent_run.rs |

- **`aphrody antigravity`** [HELP] : `models` (`fetchAvailableModels`), `whoami`
  (OpenID userinfo), `load` (`loadCodeAssist`), `chat` (`generateContent` brut
  JSON), `onboard` (`onboardUser`), `refresh`, `login` (OAuth loopback PKCE),
  `token-info`, `config` (`~/.gemini/config/config.json`), `state-sync`,
  `item-table`, `cloud-code` (RPC v1internal générique). Lit le token au runtime
  (Windows Credential Manager `gemini:antigravity` / fichiers Unix). À utiliser
  pour **scripter/inspecter** Cloud Code sans piloter le binaire.
- **`aphrody agent`** [HELP] : `aphrody agent "do X"` = un tour headless complet
  (ou `--tui`) via `aphrody-agent-runtime`. Backend Gemini live sauf `--stub`.
  `--gated` (approbation par tool-call), `--cwd`, `--system`, `-m`. À utiliser
  pour la **stack agent maison** (tools/loop Rust), pas pour parler à agy.
- **`aphrody agy`** : à utiliser quand on veut **le vrai produit Antigravity CLI**
  (TUI, Cascade, Antigravity Browser, plugins/skills d'agy).

Note : `aphrody chat` (turn-loop unifié) utilise par **défaut le backend `agy`**
(token agy → Cloud Code), via `AgyBackend` — sans lancer le binaire (cf. §5).
`agent_cmd.rs:475-487`.

### 4.1 Auth Google AI Ultra (token OAuth) [VÉRIFIÉ]

Le token écrit par agy : `~/.gemini/antigravity-cli/antigravity-oauth-token`,
enveloppe JSON `{"token":{access_token, token_type, refresh_token, expiry},
"auth_method":"consumer"}` (vérifié, valeurs caviardées). Le SDK aphrody le lit
(cf. §6). Sur Windows : Credential Manager `gemini:antigravity` (même enveloppe).
Le tier (Google One AI Ultra) est porté par le token et résolu via
`loadCodeAssist` → `cloudaicompanionProject`.

---

## 5. Flux de données end-to-end

### 5.1 `aphrody agy "..."` (forward, le vrai agy)

```
$ aphrody agy -p "implémente X"
        │
        ▼  Commands::Agy { args }  (lib.rs:1026)
   AgyCommand::execute            (commands.rs:666)
        │  resolve_agy_bin()      (commands.rs:627)
        │   1.$APHRODY_AGY_BIN 2.%LOCALAPPDATA%\agy\bin\agy.exe
        │   3.$HOME[/.local/share]/agy/bin/agy 4.PATH(which)
        ▼
   spawn  agy  (-p "implémente X")   [stdio hérité, exit propagé]
        │
        ▼  agy (Go / Codeium-Windsurf)
   ┌─────────────────────────────────────────────────────────────┐
   │ token OAuth ~/.gemini/antigravity-cli/antigravity-oauth-token│
   │ config/skills/plugins/hooks/MCP  ~/.gemini/config/*          │
   │   • plugins (modern-web-guidance, aphrody, bxc-gemini,       │
   │     material-design) → skills + commands + hooks + MCP       │
   │   • hooks.json: Stop+PostInvocation(agy-loop)                │
   │   • MCP servers: aphrody(stdio), bxc, context7, github,      │
   │     supabase, vercel (HTTP)                                  │
   │ BRIEFING.md / trajectory / Cascade / Antigravity Browser     │
   └─────────────────────────────────────────────────────────────┘
        │  RPC HTTPS
        ▼
   Google Cloud Code  v1internal  (daily/prod cloudcode-pa.googleapis.com)
        │  loadCodeAssist → project ; generateContent
        ▼
   Modèle (Gemini 3.x Flash/Pro · Claude · GPT-OSS selon tier AI Ultra)
        │  réponse / tool-calls
        ▼
   agy exécute outils (shell, fichiers, MCP, browser) → écrit réponse
        │  fin de tour
        ▼
   hook Stop → `aphrody agy-loop hook --event stop`  (stdin JSON camelCase)
        │  boucle active & non finie ? → {"decision":"continue","reason":directive}
        ▼  (relance un nouveau tour)  …jusqu'à APHRODY_LOOP_DONE / stop / max
   stdout → terminal utilisateur
```

### 5.2 `aphrody chat` / `aphrody hermes` (sans binaire, via `AgyBackend`)

```
aphrody chat/hermes  →  AgyBackend::connect()  (agy_backend.rs:66)
        │  AntigravityClient::from_credential_manager()  (lit le token agy)
        │  project() = loadCodeAssist  (ou APHRODY_CLOUDCODE_PROJECT/GOOGLE_CLOUD_PROJECT)
        ▼
   generate_content_cloud_code(Daily, gemini-3-flash-preview, project, req)
        ▼   réponse JSON → BackendResponse
```

(Ici **aucun** spawn de binaire ; même token, accès RPC direct.)

---

## 6. Config & environnement

### 6.1 Variables d'environnement

| Variable | Surface | Rôle | Réf |
|----------|---------|------|-----|
| `APHRODY_AGY_BIN` | `aphrody agy` | Override absolu du binaire `agy` (prio 1) | commands.rs:619-633 |
| `LOCALAPPDATA` | `aphrody agy` (Windows) | Base de `agy\bin\agy.exe` | commands.rs:636 |
| `HOME` | `aphrody agy` (Unix) | Base des chemins `$HOME/[.local/share/]agy/bin/agy` | commands.rs:644 |
| `APHRODY_CLOUDCODE_PROJECT` / `GOOGLE_CLOUD_PROJECT` | `AgyBackend` | Court-circuite `loadCodeAssist` (projet préset) | agy_backend.rs:76-77 |
| `XDG_CONFIG_HOME` | antigravity-sdk | Base de `aphrody/antigravity-token.json` | auth.rs:155-159 |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | `aphrody agent` | Backend Gemini live | agent help [HELP] |
| `APHRODY_AGY_OAUTH_FILE`, `APHRODY_ANTIGRAVITY_CONFIG`, `ANTIGRAVITY_API_KEY` | env recommandées | [DOC README §4] — non revérifiées dans le code lu | README.md:63-71 |

### 6.2 Token OAuth — résolution SDK [VÉRIFIÉ — auth.rs:124-192]

- **Unix**, premier fichier existant : (1)
  `$XDG_CONFIG_HOME|~/.config/aphrody/antigravity-token.json` (écrit par
  `aphrody antigravity login`) ; (2)
  `~/.gemini/antigravity-cli/antigravity-oauth-token` (écrit par le vrai `agy`).
- **Windows** : Credential Manager `gemini:antigravity` (`CredReadW`,
  auth.rs:195+).
- Enveloppe : `{"token":{access_token,token_type,refresh_token,expiry},
  "auth_method":"consumer"}` [VÉRIFIÉ].

### 6.3 Arborescence de config d'agy [VÉRIFIÉ — cette machine]

- **`~/.gemini/config/`** = racine de config active : `import_manifest.json`,
  `mcp_config.json`, `plugins/`, `skills/`, `agents/`, `projects/`,
  `config.json` (lu aussi par `antigravity-sdk`, config.rs:91-104).
- **`~/.gemini/antigravity-cli/`** = état runtime : token OAuth, `settings.json`
  (`model:"Gemini 3.5 Flash (High)"`, `toolPermission:"always-proceed"`,
  `trustedWorkspaces:[…]`), `mcp_config.json` (doublon avec **tokens en clair —
  caviardés**), `plugins/`, `mcp/`, `brain/<uuid>/` (transcripts),
  `conversations/`, `history.jsonl`, `keybindings.json`, `log/`.
- **Place des skills** : universels → `~/.gemini/config/skills/` ; skills de plugin
  → `~/.gemini/config/plugins/<plugin>/skills/`. Le doc README mentionne aussi
  `.agents/skills/*.md` (projet) et `~/.gemini/antigravity-cli/skills/` (home) [DOC].
  `~/.codeium/windsurf/skills/` existe (skills importés côté Claude) mais n'est pas
  la racine active observée. `~/.agents/skills/` héberge des skills d'autres agents
  (non agy).

### 6.4 Plugins d'agy [VÉRIFIÉ — `agy plugin list` + `import_manifest.json`]

`agy plugin list` (= `~/.gemini/config/import_manifest.json`) :

| Plugin | Source | Composants |
|--------|--------|------------|
| `modern-web-guidance` | gemini-cli | skills |
| `aphrody` | claude-code | skills, agents, hooks, commands |
| `bxc-gemini` | gemini-cli | skills, commands, mcpServers |
| `material-design` | claude-code | skills, agents, mcpServers, hooks |

(Le `import_manifest.json` de `~/.gemini/antigravity-cli/` liste un set
légèrement différent — vercel/context7/supabase — c'est un manifeste runtime
distinct ; la vérité « plugin list » est celle de `~/.gemini/config/`.)

Plugin `aphrody` [VÉRIFIÉ] : `plugin.json` = `{"name":"aphrody"}` ;
`mcp_config.json` = serveur `aphrody` (stdio `~/.local/bin/aphrody-mcp`) ;
`hooks.json` = `SessionStart` (echo rappel docs) + une entrée `AfterAgent`
(`aphrody agy-loop hook`, timeout 30) **au format Gemini CLI, sans effet sous
agy** (cf. §3.2 : le câblage agy est `Stop` + `PostInvocation`) ; `skills/` = 31
skills (dont `aphrody-cmd-ai-creative`, `agy`-related, autopilot, deep-analysis…).

### 6.5 MCP servers d'agy [VÉRIFIÉ — `~/.gemini/antigravity-cli/mcp_config.json`]

`context7` (bunx), `bxc` (`../aphrody-web/apps/bxc/dist/standalone/bxc-mcp`), `github`
(HTTP, **PAT caviardé**), `supabase` (HTTP, **token caviardé**), `vercel` (HTTP,
**token caviardé**), + `aphrody` (stdio, via le plugin). agy supporte MCP stdio et
HTTP nativement.

---

## 7. Points de vigilance / écarts constatés

1. **Doc vs code (résolution Unix)** : `resolve_agy_bin` essaie
   `$HOME/agy/bin/agy` et `$HOME/.local/share/agy/bin/agy` (étape 3) que le
   doc-comment et le message d'erreur n'annoncent pas (ils résument « > PATH »).
   Comportement réel = plus large que la doc. [VÉRIFIÉ commands.rs:643-654]
2. **agy-loop n'est pas un daemon** : aucun process persistant ; `start/stop` =
   fichiers d'état ; la « boucle » est portée par agy qui rappelle le hook à
   chaque `Stop` (et compte les tours via `PostInvocation`). Si agy ne tourne pas
   (ou si le `hooks.json` n'est pas chargé), rien ne relance.
3. **Secrets en clair** : `~/.gemini/.../mcp_config.json` contiennent des tokens
   (GitHub/Supabase/Vercel) lisibles — ne pas les recopier ; caviardés ici.
4. **Mode `-p` borné** : `--print-timeout` 5m par défaut ; en CI/headless sans
   réponse rapide, le print bloque jusqu'au plafond (origine du « timeout »).
5. **Versions agy** : ce `agy --help` n'expose pas `inspect` ni
   `plugin import gemini` cités dans le README ; `plugin` a `import [gemini|claude]`,
   `validate`, `link`. Le README peut référencer une autre version.

---

## Annexe — fichiers source clés

| Élément | Chemin |
|---------|--------|
| Forwarder `agy` (résolution + spawn) | `apps/cli/src/commands.rs:614-690` |
| Variante CLI + dispatch | `crates/aphrody/src/lib.rs:162-166, 1026-1028` |
| Backend chat agy (RPC Cloud Code, sans binaire) | `apps/cli/src/agy_backend.rs` |
| Boucle autonome `agy-loop` | `apps/cli/src/agy_loop.rs` (anciennement `apps/cli/src/agy_loop.rs`) |
| Sélection backend de `chat/hermes` | `apps/cli/src/agent_cmd.rs:475-487` |
| SDK Antigravity (token, RPC, config) | `crates/aphrody-antigravity/src/{auth,client,config,endpoints,models}.rs` |
| Surface `aphrody antigravity` | `apps/cli/src/antigravity_cmd.rs` |
| Surface `aphrody agent` | `apps/cli/src/agent_cmd.rs`, `agent_run.rs`, `crates/ai/agent-runtime/` |
| Skill commandes IA | `~/.gemini/config/plugins/aphrody/skills/aphrody-cmd-ai-creative/SKILL.md` |
| Hook wiring agy-loop | fragment : `aphrody agy-loop hooks-json` ; à installer dans `<workspace>/.agents/hooks.json`, `~/.gemini/config/hooks.json` ou `plugins/<nom>/hooks.json` |
