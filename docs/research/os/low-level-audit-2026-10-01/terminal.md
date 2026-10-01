> Update 2026-10-02: T-01 (token, Origin, Host, loopback) and T-05 (session, idle, frame and output limits) are fixed in `crates/shell/terminal-backend` (`tests/limits.rs`). Line citations below predate the move of `terminal.rs` to `aphrody-terminal-core`.

# Audit bas niveau — axe « terminal » (couche terminal, pty, shell)

Date : 2026-10-01. Dépôt : /home/aphro/aphrody (branche main, arbre sale). Niveau de preuve global : **P1 (statique)**.
Aucun `cargo`, `rustc`, `bun test` lancé ; aucun fichier du dépôt modifié. Seules écritures : ce fichier.
Marqueurs : **[V]** = vérifié en lisant le code (lieu cité) ; **[P]** = plausible, non reproduit (conséquence runtime déduite).
Grille appliquée : agents `rust-engineer`, `security-engineer`, `cross-platform-validator`, `pwsh-expert` ;
skills `nushell-pro`, `cross-platform-cli-toolbelt`, `rust-async-patterns`, `rust-best-practices-2026`
(lus pour la grille ; les constats ci-dessous sont des défauts de sûreté/robustesse/portabilité, pas des remarques de style).

## 0. Périmètre réellement lu

Lecture intégrale (first-party) :
- `crates/shell/terminal-backend/src/{lib.rs,session.rs,terminal.rs,coord.rs}` (562+396+241+6 l.) ; tests `tests/it.rs`, `tests/coord_route.rs` (en-têtes/fonctions seulement).
- `crates/shell/tui/src/{lib.rs,app.rs,ui.rs,state.rs}` (44+212+236+420 l. sur 657 ; le reste de `state.rs` = tests, listés par grep).
- `crates/shell/shell/src/lib.rs` (17 l.), `crates/shell/nu/src/lib.rs` (494 l.), `crates/shell/nu/src/utils.rs` (grep des fonctions/`spawn`/`unsafe` seulement).
- `crates/os/stdio-capture/src/lib.rs` (214 l.), `crates/os/proc/src/{lib.rs,unix.rs,windows.rs,group.rs,lock.rs,lease.rs,port.rs}` (+ liste des tests de `lib_tests.rs`).
- `apps/cli/src/agent_run.rs` (1–330), `main.rs`, `lib.rs` (l. 215–232, 535–552, 1736–1746, 2040–2110, 2195–2280, 2350–2391), `commands.rs` (l. 440–620, 1105–1150, 1910–1950, 2144–2200), `exec_cmd.rs` (l. 430–470), `oc_cmd.rs` (l. 500–575).
- Balayage `rg` dans `apps/cli/src`, `crates/shell`, `crates/os/{stdio-capture,proc}`, `crates/ui/app/src/runtime.rs`, `packages/`, `apps/` pour : pty, termios, raw mode, crossterm, ratatui, signal/SIGWINCH/SIGINT/SIGTERM/SIGTSTP/SIGCONT/SIGPIPE, ctrlc, ConPTY, portable-pty, alacritty_terminal, vte, termwiz, osc, kitty, sixel, clipboard, node-pty, Bun.Terminal, xterm.
- Hors axe mais lus pour établir une chaîne causale : `crates/ai/agent-tools/src/shell.rs` (195–380), `crates/ai/engine/src/actor.rs` (200–260), `crates/os/kernel/src/{main.rs 60–250, transport.rs 190}`, `crates/ai/llama-server/src/{supervisor.rs 250–375, daemon.rs 120–170}`, `crates/ui/app/src/{broker.rs 296–312, koharu.rs 98–112}`, `config/shell-runtime.json`, `docs/products/shell/terminal/README.md`, `docs/reference/shell/terminal/ENGINE-SELECTION.md`.
- Sources tierces du registre `~/.cargo/registry/src` relues pour vérifier l'API : `portable-pty-0.8.1` (lib.rs, unix.rs, cmdbuilder.rs, win/psuedocon.rs), `ratatui-0.30.2` (init.rs), `ratatui-core-0.1.2` (buffer.rs:351, span.rs:314, terminal/render.rs:298), `ratatui-widgets-0.3.2` (paragraph.rs), `crossterm-0.29.0` (terminal/sys/unix.rs), `tungstenite-0.24.0` / `tokio-tungstenite-0.24.0`, `rio-vt-0.5.28` (crosswords, performer/handler.rs), `nu-command-0.115.1` (run_external.rs), `nu-protocol-0.115.1` (process/child.rs), `nu-system-0.115.1` (foreground.rs), toolchain `nightly-2026-09-15` (std/os/unix/net/addr.rs).

Code importé (signalé, non jugé) : `crates/os/drive` (Spacedrive `sd-cli`, workspace imbriqué avec crossterm 0.27/0.28, ratatui 0.26/0.29, inquire, dialoguer) ; moteur Nushell `nu-*` 0.115.1 ; `rio-vt`, `portable-pty` (dépendances tierces : je cite leur comportement quand le code first-party en dépend, je ne les juge pas). `crates/shell/nu` est du glue first-party autour du moteur importé : jugé.

## 1. Synthèse

| ID | Sév. | Lieu | Constat |
|----|------|------|---------|
| T-01 | CRITIQUE | terminal-backend/src/lib.rs:128-157 ; apps/cli/src/commands.rs:1923-1945 | `aphrody term` : shell interactif derrière un WebSocket sans authentification ni contrôle d'Origin ; « localhost uniquement » non appliqué |
| T-02 | HAUTE | tui/src/ui.rs:33,149-170 ; state.rs:213-217,288-296 | Mode `--gated` : l'invite d'approbation n'affiche qu'une ligne ; approbation en une touche, sans collage balisé |
| T-03 | HAUTE | apps/cli/src/agent_run.rs:162-178,257 | Sortie du modèle écrite brute sur stdout/stderr : séquences d'échappement non filtrées (OSC 52, titre, CSI, requêtes DA/CPR) |
| T-04 | HAUTE | shell/nu/src/lib.rs:58-130,184-196,344-358 | `nu_eval` : enfants externes héritent du stdin (flux MCP), sortie non bornée, timeout sans arrêt du processus |
| T-05 | HAUTE | terminal-backend/src/session.rs:110,118-181,245-273 ; lib.rs:137-146 | Pty : arrêt par SIGHUP seul sans escalade ; 3 threads bloquants/session, aucune limite de sessions ni de volume |
| T-06 | HAUTE | apps/cli (aucun handler) ; tui/src/app.rs:53-62 ; agent-tools/src/shell.rs:228-232 | Pas de gestion SIGTERM/SIGHUP/SIGINT hors raw mode : terminal non restauré, enfants d'outils orphelins |
| T-07 | HAUTE | tui/src/ui.rs:56-65,120-125 | La fin du transcript sort de l'écran dès qu'une ligne se replie ; les `\n` des messages sont supprimés |
| T-08 | MOYENNE | tui/src/app.rs:57 ; agent_run.rs:189,268-305 | `ratatui::init()` panique hors tty ; `agent --tui` sans garde tty ; contrat « Errors » de la doc faux |
| T-09 | MOYENNE | os/stdio-capture/src/lib.rs:105,73-80 | `dup` sans CLOEXEC (fuite du vrai stdout vers les démons) ; capture non bornée ; redirection process-globale |
| T-10 | MOYENNE | apps/cli/src/commands.rs:597,616 ; lib.rs:2069-2084 | Pipes/CI : bannière sur stdout, perte du code de signal, panique EPIPE hors `completions` |
| T-11 | MOYENNE | tui/src/state.rs:203-207 ; ui.rs:43-46,172-179 ; app.rs:87 | TUI : transcript non borné, re-mise en page O(N) par évènement, plafond u16, curseur en nombre de chars |
| T-12 | MOYENNE | os/proc/src/unix.rs:70-80,141-149 ; llama-server/src/supervisor.rs:362-366 | `aphrody-proc` : mort-avec-le-parent Linux seulement ; SIGKILL sur pid d'un fichier d'état sans identité |
| T-13 | BASSE | terminal-backend/src/lib.rs:133-135,240-270 ; apps/cli/src/lib.rs:545,1167 | `sd_notify` casse sur socket abstraite ; watchdog détaché ; port 8788 par défaut déjà pris par l'A2A |
| T-14 | BASSE | commands.rs:1930-1936 ; portable-pty cmdbuilder ; shell-runtime.json:19 | Capacités terminal : ni TERM/COLORTERM posés, ni NO_COLOR/TERM=dumb dans le TUI ; réponses DA1 statiques ; dérive de politique |
| T-15 | BASSE | portable-pty win/psuedocon.rs:47-58 ; cmdbuilder.rs:415-420,456-458 ; unix.rs:76-77 | Chemins plateforme non gardés : `conpty.dll` par nom nu, planting `cwd/shell`, repli silencieux sur HOME, macOS sans équivalent PDEATHSIG |

## 2. Constats détaillés

### T-01 — CRITIQUE — Shell interactif accessible sans authentification (WebSocket)

- **Lu** : `terminal-backend/src/lib.rs:128-146` (`serve` : `TcpListener::bind(addr)`, boucle `accept`, un `tokio::spawn` par pair, aucune limite) ; `:157` (`tokio_tungstenite::accept_async(stream)`) ; `:183-226` (octets binaires et JSON `data` transmis tels quels au pty) ; `apps/cli/src/commands.rs:1923-1945` (`addr.parse::<SocketAddr>()` puis `serve`, aucune vérification `is_loopback()`) ; `apps/cli/src/lib.rs:542-548` (aide : « localhost uniquement », défaut `127.0.0.1:8788`) ; `tokio-tungstenite-0.24.0/src/lib.rs:127-132` (`accept_async` = `accept_hdr_async(stream, NoCallback)`) ; `tungstenite-0.24.0/src/handshake/server.rs` (aucune occurrence de `Origin`).
- **Faux** : la poignée de main n'a aucun callback : ni `Origin`, ni `Host`, ni jeton, ni sous-protocole. Quiconque ouvre un TCP vers le port obtient `$SHELL` avec l'environnement complet du serveur (`CommandBuilder::new` copie le `std::env` entier : portable-pty `cmdbuilder.rs:72-93`, `:479-486`), donc les clés d'API du processus.
- **Impact** : (a) détournement WebSocket inter-sites : toute page web ouverte dans le navigateur de l'utilisateur peut faire `new WebSocket("ws://127.0.0.1:8788")` et piloter un shell au nom de l'utilisateur (exécution de code), tant que `aphrody term` tourne et que le navigateur ne bloque pas l'accès au réseau local [P : le blocage dépend du navigateur] ; (b) `--addr 0.0.0.0:8788` est accepté : shell distant sans authentification ni TLS ; (c) pas de test pour ce cas (`lib.rs` tests : resize, déconnexion, sortie du shell seulement).
- **À garder** : `#![deny(unsafe_code)]`, backpressure sans perte, ménage borné (cf. §3).
- **Recommandation** : `accept_hdr_async` avec callback refusant tout `Origin` absent de la liste blanche ; jeton aléatoire généré au démarrage (affiché sur stderr, exigé en paramètre d'URL ou sous-protocole) ; refus des adresses non loopback sans drapeau explicite ; `Host` vérifié (anti DNS-rebinding) ; `max_message_size` réduit (`accept_async_with_config`) ; plafond de connexions (cf. T-05).

### T-02 — HAUTE — Garde d'approbation du TUI contournable (mode `--gated`)

Périmètre : seulement `aphrody agent --tui --gated` (`agent_run.rs:93-95` : le défaut est `FullAuto`, sans invite).
- **Lu** : `ui.rs:33` (zone d'entrée = `Constraint::Length(3)`), `:149-170` (invite : `Paragraph` + `Block::bordered()` dans cette zone, texte `"$ {command.join(" ")} -- {reason}"`) ; `state.rs:213-217,288-296` ; `app.rs:93-114,141-166` ; `ratatui-0.30.2/src/init.rs:396-402` (`init` = raw mode + écran alternatif, aucun `EnableBracketedPaste`, aucune capture souris).
- **Faux** :
  1. Boîte de 3 lignes avec bordures = **1 seule ligne de texte** : la commande est tronquée/repliée hors champ, la raison est ajoutée après la commande. L'utilisateur approuve ce qu'il ne voit pas (ex. argv `["sh","-c","ls\nrm -rf ~"]`, ou 70 espaces puis `; curl … | sh`). [V]
  2. `y`/`n`/`a` résolvent immédiatement (`state.rs:290-292`), sans confirmation ni délai de non-saisie : une frappe/répétition de `y` en cours de saisie, ou un collage (pas de paste balisé, donc les caractères collés arrivent comme touches) approuve une commande qui vient d'apparaître. [V]
  3. `apply_event` écrase `pending_approval` sans file (`state.rs:214,217`) : une 2e demande remplace la 1re, jamais résolue → tour bloqué [P : dépend de la concurrence des demandes côté moteur].
  4. L'affichage n'est pas fidèle à l'argv : `join(" ")` perd le découpage des arguments ; les caractères de contrôle et de largeur nulle sont supprimés silencieusement par ratatui (`span.rs:314`). [V]
  5. Ctrl-C et Esc sont ignorés tant qu'une approbation est en attente (`state.rs:295`).
- **Recommandation** : afficher la commande complète (zone haute, défilement, argv entre guillemets, échappement visible des contrôles) ; exiger `Enter` après sélection ; `EnableBracketedPaste` et ignorer les collages pendant une invite ; file d'attente d'approbations.

### T-03 — HAUTE — Sortie non fiable écrite brute sur le terminal (chemin CLI)

- **Lu** : `agent_run.rs:162-178` (`echo_event` : `eprint!("{delta}")` pour deltas de message et de raisonnement, `eprintln!("[exec] {}", command.join(" "))`, `[tool] {name}`, `[error] {message}`) ; `:241-259` (`run_headless` : `println!("{message}")` avec le message final du modèle) ; recherche `sanitize|strip_ansi|is_control|escape` dans `apps/cli/src`, `crates/ai/agent-tools/src`, `crates/ai/engine/src` : aucun filtre. `commands.rs:2144-2200` (`chat`) suit le même schéma [P : réponse imprimée, boucle non relue en entier].
- **Faux** : tout octet produit par un modèle (donc par une page web, un fichier ou un résultat d'outil injecté) atteint le terminal de l'utilisateur quand stdout/stderr est un tty : OSC 52 (écriture du presse-papiers par un attaquant), OSC 0/2 (titre), OSC 8 (liens), CSI de déplacement/effacement (recouvrir la ligne `[exec] …` déjà affichée), séquences de requête DA/CPR/DECRQSS/XTVERSION dont la réponse du terminal revient dans le stdin du processus. [V pour l'absence de filtre ; P pour l'effet selon le terminal]
- **Correct à garder** : le chemin TUI est filtré par ratatui (`Span::styled_graphemes` rejette tout graphème contenant un caractère de contrôle, `ratatui-core span.rs:314` ; `Buffer::set_stringn` idem, `buffer.rs:351`), ESC, C0 et C1 compris.
- **Recommandation** : une fonction unique `sanitize_for_terminal` (supprimer C0/C1/ESC, conserver `\n` `\t`) appliquée à tout texte modèle/outil/web avant `print!`/`eprint!` quand `is_terminal()` ; idem pour `chat`, `translate` et `search`.

### T-04 — HAUTE — `nu_eval` : stdin hérité, sortie non bornée, timeout sans effet sur le processus

- **Lu** : `nu/src/lib.rs:58-80` (moteur : jamais `is_mcp`), `:100` (`Stack::new().capture_all()`, jamais `suppress_stdin`), `:184-196` (`collect` → `child.wait_with_output()`), `:340-358` (`spawn_blocking` + `tokio::time::timeout`, sur expiration seulement `interrupt.store(true)`) ; `nu-command-0.115.1/src/system/run_external.rs:265-271` (`PipelineData::Empty` ⇒ `Stdio::inherit()` sauf `engine_state.is_mcp || stack.suppress_stdin`) et `:280-283` (détachement du tty seulement dans ce cas) ; `nu-protocol-0.115.1/src/process/child.rs:464-505,516-520` (`wait_with_output` → `collect_bytes` → `read_to_end`, aucun test de `Signals`) ; `os/kernel/src/main.rs:246` et `transport.rs:190-192` (`serve_stdio` avec `builtin_kernel(true, …)` : `nu_eval` est exposé sur le stdin/stdout JSON-RPC).
- **Faux** :
  1. `nu_eval "^cat"` (ou `^python`, `^git commit`, tout ce qui lit stdin) lit le **flux MCP du serveur** : trames volées ou protocole corrompu ; en TUI (autre hôte) les touches. Nushell fournit exactement les deux interrupteurs (`is_mcp`, `suppress_stdin`) ; le glue ne les positionne pas. [V code ; P exécution]
  2. `^yes` ou toute commande bavarde : `read_to_end` sans plafond → mémoire non bornée ; le délai (120 s par défaut, 3600 s max) rend la main à l'appelant mais le thread bloquant et l'enfant continuent (un `spawn_blocking` ne s'annule pas) ; l'enfant n'est ni tué ni dans un groupe dédié (`is_interactive` faux ⇒ pas de pgrp). À la sortie du runtime (`Runtime::drop` attend les tâches bloquantes), le processus peut ne pas se terminer. [V code ; P effet]
- **Recommandation** : `engine.is_mcp = true` et `stack.suppress_stdin = true` ; exécuter les externes via `aphrody-proc::spawn_group` ou borner/tuer par groupe à l'expiration ; plafond de sortie (cf. `agent-tools/src/shell.rs` `max_output_bytes`).

### T-05 — HAUTE — Pty : arrêt incomplet, fuite de threads bloquants, aucune limite

- **Lu** : `session.rs:110` (`killer = child.clone_killer()`), `:118-125,131-165,170-180` (3 `spawn_blocking` par session), `:117` (canal `mpsc` de 256 `Vec<u8>`), `:245-273` (`close`/`stop`) ; `portable-pty-0.8.1/src/lib.rs:312-327` (`ProcessSignaller::kill` Unix = `libc::kill(pid, SIGHUP)`, rien d'autre ; la boucle d'attente puis SIGKILL des l.329-362 appartient à `impl ChildKiller for std::process::Child`, non utilisée ici) et `:290-300` (Windows : `TerminateProcess` du seul shell) ; `lib.rs:137-146` ; `tungstenite-0.24.0/src/protocol/mod.rs:82-83` (limites par défaut 64 MiB message / 16 MiB trame).
- **Faux** :
  1. Un shell qui ignore ou piège SIGHUP survit : `child.wait()` ne rend jamais la main, le superviseur ne ferme jamais le master (`session.rs:185-201`), le lecteur et l'écrivain (qui détient un `Sender` cloné `replies`) ne se terminent jamais. `close()` rend la main après `TEARDOWN_TIMEOUT + 1 s` avec un `warn!` et abandonne les `JoinHandle` : un shell + 3 threads + fds fuient par session, sans escalade vers SIGKILL ni `killpg`. [V mécanique ; P pour un shell réel qui piège HUP]
  2. Windows : `TerminateProcess` ne tue que le shell, pas ses descendants (pas de Job Object ; `aphrody-proc::spawn_group` fournit pourtant Job Object ou setsid+killpg mais n'est pas utilisé ici). [V]
  3. Aucune limite de sessions, aucun délai de poignée de main, aucun keepalive TCP/ping : un client demi-ouvert garde indéfiniment un shell et 3 threads bloquants ; le pool bloquant par défaut de tokio est à 512 (`apps/cli/src/lib.rs:2268` : `Builder::new_multi_thread().enable_all()`), soit environ 170 sessions avant que tout `spawn_blocking` du processus (dont les nouvelles sessions) n'attende indéfiniment. [V arithmétique ; P charge réelle]
  4. File d'entrée bornée en nombre (256) mais pas en octets : 256 × (message ≤ 64 MiB) ≈ 16 GiB retenus si le shell ne lit pas stdin. [V]
  5. Variante `spawn_with_terminal_state` (aucun appelant hors tests, vérifié par `rg`) : `replies.blocking_send` dans le thread lecteur peut s'interbloquer avec l'écrivain quand l'application enfant inonde la sortie de requêtes CPR sans lire stdin (`session.rs:145-149`) ; `TerminalState::resize` sans plafond (`terminal.rs:167-169` : `max(1)` seulement, 65535×65535 cellules possible) [P].
- **Recommandation** : tuer le groupe (`killpg`/Job Object) puis escalader SIGKILL après un délai ; `Semaphore` de sessions + `max_message_size` + file d'octets ; ping/keepalive ; réutiliser `aphrody-proc`.

### T-06 — HAUTE — Aucune gestion de SIGTERM/SIGHUP/SIGINT hors raw mode : terminal non restauré, enfants orphelins

- **Lu** : `rg` sur `apps/cli`, `crates/shell`, `crates/ai/{engine,agent-runtime,agent-tools,app-server,gateway}` pour `tokio::signal|signal_hook|ctrlc|SignalKind|libc::signal|sigaction` : seulement `exec_cmd.rs:442`, `commands.rs:1944` (`term`) et `ai_sync_cmd.rs:117`, tous `ctrl_c()` (SIGINT uniquement) ; `tui/src/app.rs:31-62` (garde `Drop` + hook de panique ratatui `init.rs:566-573`) ; `crossterm-0.29.0/src/terminal/sys/unix.rs:108-123` (mode d'origine dans une statique, aucun handler de signal) ; `ratatui-0.30.2/src/init.rs:540-548` (`restore` = `disable_raw_mode` + `LeaveAlternateScreen`, pas de `show_cursor`) ; `ratatui-core/src/terminal/render.rs:298` (`draw` sans curseur ⇒ `hide_cursor`) ; `agent-tools/src/shell.rs:225-232,338-380` (enfant en groupe propre `process_group(0)`, `killpg` seulement sur expiration, `kill_on_drop(true)`).
- **Faux** :
  1. En raw mode, Ctrl-C est une touche (ISIG coupé) et est bien gérée ; mais SIGTERM/SIGHUP/SIGINT venant de l'extérieur (`kill`, `timeout`, bouton stop d'IDE, systemd) terminent le processus sans exécuter `Drop` : terminal laissé en raw mode et sur l'écran alternatif (reset manuel). [V]
  2. Même mécanisme hors TUI (`aphrody agent` headless, `run_headless`) : Ctrl-C dans le terminal tue `aphrody` immédiatement ; les commandes lancées par l'outil `shell` sont dans un autre groupe de processus (`process_group(0)`) et ne reçoivent pas le SIGINT du terminal : builds/serveurs/jobs GPU survivent en orphelins. [V ; P pour l'observation]
  3. Annulation d'un tour (`Op::Interrupt` → `interrupt.cancelled()`, `engine/src/turn.rs:578` [non relu en détail]) : l'abandon du futur `run_child` déclenche `kill_on_drop`, qui n'envoie SIGKILL qu'au chef (comportement tokio), alors que le commentaire de `shell.rs:338-346` reconnaît qu'un kill du chef seul orpheline les descendants. [P]
  4. Curseur laissé masqué si la dernière trame est l'invite d'approbation (pas de curseur posé) et que la boucle sort par `events.recv() == None`, erreur d'E/S ou panique. [V]
  5. SIGTSTP/SIGCONT : Ctrl-Z est avalé (`app.rs:154`, `KeyCode::Char(_) if ctrl => None`) donc pas de suspension ; un SIGCONT externe ne déclenche aucun repaint. SIGWINCH : correct (crossterm → `Event::Resize` → redessin, `app.rs:116-118`).
- **Recommandation** : un unique module `shutdown` (SIGTERM+SIGHUP+SIGINT) qui restaure le terminal, tue les groupes d'outils (`aphrody-proc::GroupChild`) puis sort ; `show_cursor` dans la garde ; `killpg` au `Drop` du futur d'outil.

### T-07 — HAUTE — TUI : la fin de la conversation n'est pas visible

- **Lu** : `ui.rs:43-65` (`total = lines.len()` en lignes **logiques**, `max_top = total - viewport`, `Paragraph::wrap(Wrap{trim:false}).scroll((top,0))`) ; `ratatui-widgets-0.3.2/src/paragraph.rs:221-225` (« le décalage s'applique après le repli ») ; `ui.rs:120-125` (`labeled` : un seul `Span::raw(text)` par message) ; `ratatui-core span.rs:314` (tout graphème contenant un contrôle, donc `\n` et `\t`, est supprimé).
- **Faux** : (a) un message d'agent de plusieurs lignes devient une seule ligne logique sans retour (« a\nb » s'affiche « ab »), qui se replie sur plusieurs rangées ; (b) `total` ne compte pas ces rangées : `top` est sous-estimé, la zone visible s'arrête avant le bas du transcript, et `PageDown` ne peut pas aller plus bas (`scroll_offset` saturé à 0). La réponse la plus récente peut être hors écran. [V par la logique ; P pour l'observation à l'exécution — aucun test de rendu avec ligne repliée]
- **Recommandation** : découper les messages en `Line` par `\n` ; calculer la hauteur repliée (`Paragraph::line_count(width)`) ; test `TestBackend` avec un message plus large que l'écran.

### T-08 — MOYENNE — Hors tty : panique au lieu d'erreur

- **Lu** : `app.rs:42-62` (doc : « # Errors … returns the first terminal draw / I/O error ») et `:57` (`ratatui::init()`) ; `ratatui-0.30.2/src/init.rs:365-367` (`init` = `try_init().expect("failed to initialize terminal")`) ; `crossterm-0.29.0 unix.rs:108-123` (échec `tty_fd()?` sans `/dev/tty`) ; `agent_run.rs:189-191,268-305` (aucun `is_terminal` avant `aphrody_tui::run`) ; garde présente seulement dans la voie « CLI nue » `apps/cli/src/lib.rs:225-227,2205-2223`.
- **Faux** : `aphrody agent --tui` en CI, via `ssh host cmd` sans `-t`, ou avec stdout redirigé → panique (exit 101, message de panique) au lieu d'une erreur propre ; si stdin est un tty et stdout un pipe, les séquences du TUI partent dans le pipe. La doc de `run` promet une erreur retournée. [V]
- Annexe : `aphrody agent` sans prompt lit stdin jusqu'à EOF même si c'est un tty, sans message d'invite (`agent_run.rs:145-158,189-191`) : paraît figé. [V]
- **À garder** : la garde double stdin+stdout de la voie nue (`lib.rs:225`).
- **Recommandation** : `ratatui::try_init()` + `Err` ; garde `stdin().is_terminal() && stdout().is_terminal()` dans `agent_run::run` pour `--tui`.

### T-09 — MOYENNE — `aphrody-stdio-capture`

- **Lu** : `lib.rs:45-70`, `:73-80`, `:102-117`, `:120-129` ; appelants : `apps/cli/src/lib.rs:2384-2391` (`run_captured`, aucune sérialisation) et `crates/interop/ffi/src/lib.rs:216-217` (verrou `capture_lock`, bon).
- **Faux** :
  1. `libc::dup(target)` (l.105) ne pose pas `FD_CLOEXEC` : tout enfant lancé pendant la fenêtre de capture (démons `aphrody-proc::spawn_detached`, outils) hérite d'un descripteur vers le **vrai** stdout et le **vrai** stderr de l'hôte. Un démon longue durée (llama-server via `Supervisor::spawn_daemon`) garde alors le bout d'écriture du pipe de l'hôte (Bun, CI, `$(…)`) : le lecteur n'obtient jamais EOF. [V code ; P scénario]
  2. Capture non bornée : fichier temporaire sans plafond, puis `read_to_end` + `from_utf8_lossy` en mémoire (sortie binaire corrompue, ×3 copies avec la sérialisation JSON de l'FFI). [V]
  3. Redirection process-globale : `run_captured` de la bibliothèque (hôte Tauri) n'a pas le verrou de l'FFI ; avec deux appels concurrents, les `dup/dup2` s'entrelacent et le descripteur 1 peut rester pointé sur un fichier temporaire supprimé après le 2e rétablissement. Contrat documenté (l.15), donc dépend de chaque appelant. [P]
  4. stdin n'est pas redirigé : une commande capturée qui lit stdin lit celui de l'hôte.
- **À garder** : restauration par `Drop` (donc aussi sur déroulement de panique), `catch_unwind` côté FFI, temp-file plutôt que pipe (pas d'interblocage), variante Windows par `SetStdHandle` justifiée dans la doc.
- **Recommandation** : `fcntl(F_DUPFD_CLOEXEC)` ; plafond configurable avec troncature marquée ; verrou interne au crate plutôt qu'aux appelants.

### T-10 — MOYENNE — Comportement en pipe/CI de la CLI

- **Lu** : `commands.rs:597-613` (bannière `println!("⚡ Route native: …")` sur **stdout** avant d'exécuter l'enfant), `:616` (`SubprocessExit(status.code().unwrap_or(1))`), `:492` (« ✨ [Auto] Détection de langage naturel » sur stdout) ; `lib.rs:2069-2084` (`completions` gère `BrokenPipe`, avec le commentaire expliquant la panique) ; `lib.rs:2350-2357` (`run_native` ne réinitialise pas SIGPIPE) ; 114 `println!` dans `commands.rs` seul.
- **Faux** : `aphrody cargo metadata | jq` ou `aphrody bun run … > out.json` reçoit la bannière dans le flux de données [V] ; un enfant tué par signal (SIGINT=130, SIGKILL=137) devient « 1 » car `code()` est `None` [V] ; hors `completions`, `aphrody <cmd> | head` panique sur EPIPE à chaque `println!` (Rust ignore SIGPIPE, `println!` panique) [P : reproduit par construction, non exécuté].
- `colored` 3.1.1 (Cargo.lock) respecte NO_COLOR/CLICOLOR et le tty de stdout, mais pas stderr, et rien n'active le mode VT de la console héritée sous Windows (aucun `set_virtual_terminal`) [P].
- **Recommandation** : bannières sur stderr ; `ExitStatusExt::signal()` → 128+n ; `libc::signal(SIGPIPE, SIG_DFL)` au démarrage de `run_native` (ou écriture tolérante) ; `colored::control::set_virtual_terminal(true)` sous Windows.

### T-11 — MOYENNE — TUI : bornes, coût, largeur

- **Lu** : `state.rs:179-181,203-207,185` (`agent_buffer`, `output.push_str(&chunk)`, `transcript.push` sans plafond) ; `ui.rs:43-46,56-65` (chaque `draw` reconstruit toutes les `Line` du transcript, formatage de chaque ligne d'exec, puis `Paragraph` replie tout) ; `app.rs:82-88,127-131` (un `draw` par évènement moteur, 12 Hz pendant un tour ; canaux `UnboundedReceiver<Event>` et `UnboundedSender<Submission>`) ; `ui.rs:56,177` (`u16::try_from(...).unwrap_or(u16::MAX)`, `area.x + 1 + cursor as u16`).
- **Faux** : (a) mémoire non bornée sur une session longue (sortie de build en flux) ; (b) coût CPU O(taille du transcript) à chaque delta, d'où une UI figée sur gros flux ; (c) au-delà de 65 535 lignes `total` plafonne : la fin n'est plus suivie (cumul avec T-07) ; (d) le curseur est placé au nombre de **caractères**, pas de colonnes d'affichage : décalé avec CJK (largeur 2), emoji, marques combinantes ; la ligne de saisie n'a ni défilement horizontal ni repli (texte au-delà de la largeur invisible, curseur hors de la boîte), et `area.x + 1 + u16` peut déborder pour ≥ 65 534 caractères collés [V pour le code ; P pour le rendu]. (e) Le rendu des graphèmes dépend de `unicode-width` : les émojis ZWJ/VS16 sont mesurés autrement par plusieurs terminaux (Windows Terminal vs kitty) → décalages de mise en page [P, non testé].
- **À garder** : états purs testables, test `unicode_input_edits_on_char_boundaries`, rendu 1×1 sans panique (`draw_handles_tiny_area`).
- **Recommandation** : plafonner l'historique (anneau) et le cache des lignes mises en page ; coalescer les `draw` (au plus 30-60/s) ; `unicode_width::UnicodeWidthStr` pour le curseur.

### T-12 — MOYENNE (limitée) — `aphrody-proc`

- **Lu** : `unix.rs:64-81` (`setsid` + `PR_SET_PDEATHSIG` sur option `die_with_parent_thread`, Linux seul ; `:76-77` ignoré ailleurs ; aucun contrôle `getppid()` après le `prctl`), `:131-149` (`killpg(SIGKILL)` du chef = pgid ; `terminate_process(pid)` = SIGKILL d'un pid brut), `group.rs:168-182` (kill avant reap, groupe balayé une seule fois : bon), `windows.rs:233-238,245-255,283-311` (Job Object `KILL_ON_JOB_CLOSE`, fenêtre grand-enfant documentée) ; `llama-server/src/supervisor.rs:350-366` (`process_alive(pid)` puis `terminate_process(pid)` sur des pids lus du fichier d'état) ; `ui/app/src/{broker.rs:305,koharu.rs:104}` (options par défaut ; enfants à stdin/stdout en pipes).
- **Faux** : (a) la doc de tête promet « le groupe meurt avec son propriétaire » mais, hors Windows, seul Linux avec l'option (désactivée par défaut, liée au **thread** spawner) offre cela ; macOS et autres Unix : aucun équivalent, un propriétaire tué laisse l'arbre. Atténué pour broker/koharu par l'EOF de stdin sur pipe ; [V] pour le code, [P] pour l'effet. (b) Course PDEATHSIG : si le parent meurt entre `fork` et `prctl`, pas de détection. [P] (c) `stop_locked` envoie SIGKILL à un pid issu d'un fichier d'état dont on ne vérifie que l'existence : un pid recyclé après un crash tue un processus étranger de l'utilisateur (la doc de `process_alive` prévient d'un second indice ; `terminate_process` n'en exige aucun). [V code ; P probabilité faible : `pid_max` 4 194 304 sous WSL2]
- **À garder** : ordre « tuer puis reaper », idempotence, thread de reaping des démons détachés (`unix.rs:102-111`), `setsid` pour les groupes possédés, `CREATE_NEW_PROCESS_GROUP`, verrous `flock` relâchés à la mort du processus (`lock.rs`, `lease.rs`).

### T-13 — BASSE — systemd et port par défaut

- **Lu** : `lib.rs:133` (`let _ = sd_notify("READY=1…")`), `:135` (`_watchdog` détaché à la sortie de `serve`), `:249-262` (`NOTIFY_SOCKET` commençant par `@` : premier octet remplacé par `\0` puis `UnixDatagram::connect(path)`) ; `std/os/unix/net/addr.rs:32-35` (toolchain nightly-2026-09-15 : « paths must not contain interior null bytes » ⇒ `InvalidInput`) ; tests `lib.rs:357-393` (chemin de fichier seulement) ; `apps/cli/src/lib.rs:545` et `:1167` (les deux sous-commandes `term` et `a2a serve` ont `127.0.0.1:8788` par défaut), `config/service-catalog.json:86`.
- **Faux** : (a) avec un socket abstrait (conteneurs, nspawn) le READY n'est jamais envoyé, l'erreur est avalée : l'unité `Type=notify` expire [V] ; (b) l'appel de pétage du watchdog est inconditionnel (prouve seulement que le runtime vit) et la tâche survit à `serve` annulé [V] ; (c) `term` et le serveur A2A se disputent le port 8788, et `doctor` sonde `/ping` sur ce même port (`commands.rs:1798`) [V].
- **Recommandation** : `SocketAddr::from_abstract_name` + `connect_addr` (`std::os::linux::net::SocketAddrExt`) ; défaut distinct pour `term` (port propre) ; vérifier `WATCHDOG_PID`.

### T-14 — BASSE — Détection de capacités et dérive de politique

- **Lu** : `commands.rs:1930-1936` (`PtyConfig` avec `env: []`), `portable-pty cmdbuilder.rs` (aucune occurrence de `TERM`/`COLORTERM`), `rio-vt crosswords/mod.rs:3941` (DA1 statique `\x1b[?62;4;6;22;52c` : annonce sixel et OSC 52 quel que soit l'hôte), `tui/src/ui.rs` (couleurs ANSI nommées, `Modifier::BOLD/DIM` inconditionnels), `rg NO_COLOR|COLORTERM|TERM_PROGRAM` dans `crates/shell` et `apps/cli/src` (rien hors `colored`), `config/shell-runtime.json:19` (`forbiddenApplicationShells`: cmd.exe, powershell.exe, pwsh.exe) face à `lib.rs:81-87` (`default_shell` → `pwsh` puis `cmd`).
- **Constat** : la détection se fait par variables d'environnement seulement (`colored` : NO_COLOR/CLICOLOR ; ratatui/crossterm : aucune), jamais par requête (DA1/XTVERSION/kitty `?u`). Le TUI ne consulte ni `NO_COLOR` ni `TERM=dumb`. Le shell du pty hérite du `TERM` du serveur (souvent absent sous systemd) sans négociation avec le moteur de rendu connecté. Aucun code first-party n'émet kitty/sixel/OSC 52 : pas de repli à auditer. Sous Wayland/X11/WSLg rien n'est propre à la couche terminal (le rendu navigateur Tauri est hors périmètre). Dérive : la politique interdit pwsh/cmd comme « shells d'application », le backend en lance un par défaut (cas d'un terminal humain, donc probablement voulu : à clarifier dans le JSON).
- **Recommandation** : poser `TERM=xterm-256color`/`COLORTERM=truecolor` via `PtyConfig.env` quand le client le déclare ; respecter NO_COLOR dans le TUI ; trancher la politique.

### T-15 — BASSE — Chemins plateforme non gardés

- Windows, `portable-pty-0.8.1/src/win/psuedocon.rs:47-58` : `ConPtyFuncs::open(Path::new("conpty.dll"))` par nom nu (ordre de recherche DLL standard : répertoire de l'application, cwd, PATH) : planting d'une DLL « sideload » [P] ; `.expect("this system does not support conpty…")` panique au lieu de retourner une erreur sous Windows < 1809 ; en revanche `bInheritHandles = 0` et handles standard invalides (`:107-143`) : bon.
- Unix, `cmdbuilder.rs:415-420` (`search_path` : `cwd.join(shell)` testé **avant** PATH) : `aphrody term --shell bash --cwd <dépôt non fiable>` exécute `<dépôt>/bash` s'il existe ; `:456-458` : si `cwd` n'est pas un répertoire, repli silencieux sur HOME (le shell démarre ailleurs que demandé, sans erreur). [V]
- Pré-`exec` portable-pty (`unix.rs:118-139`) alloue (`read_dir("/dev/fd")`, `Vec`) après `fork` dans un processus multi-threadé à allocateur mimalloc (`apps/cli/src/main.rs:13-15`) : risque d'interblocage connu de la classe « allocation après fork » [P].
- macOS : aucun équivalent à PDEATHSIG ni à un Job Object (cf. T-12) ; non vérifié à l'exécution.
- Windows : `default_shell` ne tente pas `powershell.exe` (5.1, toujours présent) avant `cmd` ; `colored` sans mode VT sur console héritée (T-10).

## 3. Ce qui est correct et à garder

- `ratatui::init()` installe un hook de panique qui restaure le terminal (`init.rs:566-573`) et `RestoreGuard` (`app.rs:34-40`) couvre retour anticipé et `?` : raw mode et écran alternatif sont restaurés sur panique, erreur et sortie normale. Ctrl-C en raw mode est traité comme touche ; les évènements `Release` sont filtrés (double évènement Windows, `app.rs:145`). SIGWINCH passe par crossterm et provoque un redessin.
- Filtrage des contrôles par ratatui sur tout le chemin TUI (`span.rs:314`, `buffer.rs:351`) : neutralise OSC 52, titre, CSI injectés par un modèle dans le TUI.
- `rio-vt` : `ReplyListener` ne retransmet au pty que `RioEvent::PtyWrite` (`terminal.rs:67-73`) ; presse-papiers, titre et autres évènements sont ignorés. Les réponses `PtyWrite` sont à format fixe, sauf XTGETTCAP/Kitty/Glyph (noms hexa-encodés pour XTGETTCAP, `handler.rs:1749`) : pas d'écho brut du contenu attaquant observé. Garde-fous mémoire graphiques présents (éviction `graphics.rs:1028`, `MAX_GRAPHIC_DIMENSIONS`). Réserve : tampon XTGETTCAP/DCS sans plafond (`handler.rs:1072`) [P, tiers].
- terminal-backend : contre-pression sans perte (`session.rs:127-165`), lecteur qui continue de vider après le départ de l'hôte (nécessaire à ConPTY), arrêt borné (`TEARDOWN_TIMEOUT`), `#![deny(unsafe_code)]`, `which` en processus (pas de `where.exe`), tests de bout en bout sur WebSocket loopback, `sd_notify` sans `unsafe`.
- portable-pty Unix : `setsid` + `TIOCSCTTY`, remise à SIG_DFL, `close_random_fds` (descripteurs ≥ 3 fermés dans l'enfant), CLOEXEC sur master/slave.
- `agent-tools/src/shell.rs` : `stdin(Stdio::null())`, groupe propre + `killpg` à l'expiration, sortie plafonnée, `kill_on_drop`.
- `aphrody-proc` : tuer avant de reaper, groupe balayé une fois, `KILL_ON_JOB_CLOSE`, `flock` sans nettoyage de verrous périmés, aucun `unsafe` hors des deux modules plateforme.
- Voie « CLI nue » : TUI seulement si stdin **et** stdout sont des tty (`lib.rs:225`).

## 4. Ce qui manque

- Authentification/Origin/TLS/limites sur le serveur pty (T-01, T-05).
- Module central d'arrêt par signaux (T-06) ; assainissement unique des sorties terminal (T-03) ; test de rendu avec lignes repliées/CJK (T-07, T-11) ; test d'un shell qui piège SIGHUP ; test de propriétaire tué (`lib_tests.rs` ne teste que le `Drop`) ; test d'Origin hostile.
- Détection de capacités par requête (DA1/XTVERSION) : inexistante ; le TUI n'a pas de repli monochrome.
- Aucun client first-party du WebSocket dans le dépôt (le « frontend WASM/wterm/Ghostty » cité par l'aide et `DESKTOP-PTY.md` n'a pas été trouvé par `rg` dans `packages/` et `apps/`) : le traitement côté rendu de OSC 52/OSC 8/titre/images n'est pas auditable ici.
- Aucun pilote de pty dans `packages/` (`node-pty`, `Bun.Terminal`, `xterm` : aucune occurrence).

## 5. Recommandations priorisées

1. T-01 : Origin + jeton + loopback obligatoire + limites sur `terminal_backend::serve`.
2. T-02 + T-07 : approbation visible en entier, confirmée, collage balisé ; correctif de défilement/retour à la ligne du transcript.
3. T-04 + T-06 : `is_mcp`/`suppress_stdin` et exécution bornée/tuée par groupe pour `nu_eval` ; module d'arrêt par signaux (restauration du terminal, `killpg` des outils).
4. T-03 : `sanitize_for_terminal` appliqué à toute sortie modèle/outil/web sur tty.
5. T-05 + T-09 : tuer le groupe puis SIGKILL, sémaphore de sessions, `F_DUPFD_CLOEXEC` et plafond dans stdio-capture.

## 6. NON EXAMINÉ

- Exécution : aucun test, aucune reproduction ; tous les [P] restent à confirmer. Windows (ConPTY, Job Object) et macOS : lecture statique seule, aucune compilation croisée.
- Code importé : `crates/os/drive` (Spacedrive), moteur `nu-*` (hors points d'embarquement cités), internals de `rio-vt` et de `portable-pty` au-delà des fonctions citées, `termwiz`/`vte` (présents dans le registre, non liés à ce périmètre), `alacritty_terminal` (absent).
- `apps/cli/src` hors fichiers cités (une cinquantaine de `*_cmd.rs`, `pillars_cmd/`, `gateway_cmd.rs`, `mcp_cmd.rs`, `ide_cmd.rs`) : balayage `rg` des mots-clés seulement ; compilation wasm32 de `Commands::Term` (le bras `lib.rs:1742` n'a pas de `cfg`, `mod commands` en a un) non vérifiée.
- `crates/ui/app/src/runtime.rs` : aucune occurrence pty/terminal au balayage, non lu ; renderer DOM Tauri/wterm/Ghostty absent du dépôt.
- `packages/interop/native` (chargeur Bun) : non lu pour d'éventuels usages de tty ; `crates/shell/nu/src/utils.rs` seulement survolé ; `crates/ai/engine/src/turn.rs` autour de la ligne 578 (chaîne d'annulation → kill des enfants) et `approval.rs` non lus ; `lease.rs` : atomicité de l'écriture du sidecar (lecture concurrente d'un JSON partiel supprimée par `holders()`) non évaluée ; `docs/architecture/os/ARCHITECTURE.md` non relu.
- Largeur Unicode, RTL/bidi et émojis : analyse par lecture de code seulement, aucune mesure de rendu ; versions `unicode-width` 0.1.14 / 0.2.x coexistent dans le registre, celle effectivement liée par ratatui 0.30 non vérifiée via `Cargo.lock`.
- Détection de capacités sous Wayland/X11/WSLg/Windows Terminal : non applicable au code first-party lu (aucune émission kitty/sixel/OSC 52) ; non exécuté sous WSLg.
