// SPDX-License-Identifier: Apache-2.0
//! `aphrody agy-loop …` — pousse le CLI Antigravity (`agy`) dans une boucle de
//! codage autonome via ses hooks de cycle de vie `Stop` (pilote) et
//! `PostInvocation` (comptabilité par tour).
//!
//! `agy` n'a pas de mode natif « continue jusqu'à terminé ». Cette sous-commande
//! est le binaire de hook à câbler dans un `hooks.json` d'agy (fragment exact :
//! `aphrody agy-loop hooks-json`).
//!
//! # Contrat agy (vérifié sur la documentation embarquée dans le binaire `agy`)
//!
//! Un `hooks.json` d'agy est un objet dont chaque clé de premier niveau est un
//! **nom de hook** ; sous ce nom, les évènements supportés sont `PreToolUse`,
//! `PostToolUse`, `PreInvocation`, `PostInvocation` et `Stop`. **Il n'existe pas
//! d'évènement `AfterAgent`/`BeforeAgent`** côté agy : ce sont des évènements du
//! Gemini CLI déprécié (le SDK Python `antigravity-sdk-python` expose de son côté
//! `OnSessionStart`, `PreTurn`, `PostTurn`, `PreToolCall`, `PostToolCall`,
//! `OnToolError`, `OnCompaction`, `Stop`). Les payloads agy sont en camelCase
//! (encodage protojson) :
//!
//! * `Stop` (« quand la boucle d'exécution se termine ») reçoit sur stdin
//!   `executionNum`, `terminationReason`, `error`, `fullyIdle`,
//!   `finalModelOutput` + les champs communs (`conversationId`,
//!   `workspacePaths`, `transcriptPath`, `parentConversationId`, …) et lit sur
//!   stdout `{"decision":"continue","reason":…}` : `continue` bloque l'arrêt et
//!   réinjecte `reason` comme message système ; toute autre valeur laisse
//!   l'agent s'arrêter. agy plafonne lui-même les continuations consécutives
//!   d'un hook `Stop` : le plafond `--max` d'aphrody s'ajoute à ce garde-fou.
//! * `PostInvocation` (après chaque invocation du modèle) reçoit
//!   `invocationNum`, `initialNumSteps`, `modelOutput`, `modelThinking` et peut
//!   répondre `injectSteps`/`terminationBehavior`. La boucle n'y force jamais
//!   rien (`{}`) : elle y tient seulement sa comptabilité par tour et y capte la
//!   sentinelle de fin, de sorte que `Stop` la voie même si `finalModelOutput`
//!   est vide.
//!
//! Les hooks agy sont lancés depuis le dossier du `hooks.json` (par exemple
//! `<workspace>/.agents`) : le workspace est donc lu dans `workspacePaths`, pas
//! dans le répertoire courant.
//!
//! La boucle se termine quand l'agent émet le jeton sentinelle [`DONE_SENTINEL`]
//! seul sur une ligne, qu'un arrêt est demandé, que l'utilisateur interrompt le
//! tour, que le plafond d'itérations est atteint, ou après trop d'arrêts
//! consécutifs sur erreur (garde anti-emballement).
//!
//! # Compatibilité Gemini CLI
//!
//! La documentation du Gemini CLI (commande `gemini`, dépréciée) décrit un
//! évènement `AfterAgent` (non revérifié ici, cf.
//! `docs/products/ai/agy-cli/README.md` §5.2) : `aphrody agy-loop hook --event
//! after-agent` (ou un JSON portant `hook_event_name = "AfterAgent"`) garde
//! l'ancien dialecte (`{"decision":"deny","reason":…}`). Ce n'est pas un contrat
//! agy et rien ne câble `AfterAgent` pour agy.
//!
//! Pur Rust, lit stdin / écrit un fichier d'état : identique sur Linux (cible
//! #1), Windows et macOS — aucune dépendance shell/interpréteur.

use std::{
    io::Read as _,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// Jeton que l'agent doit émettre, seul sur sa ligne, pour signaler que
/// l'objectif est réellement atteint, vérifié et committé. Tant qu'il n'apparaît
/// pas dans la réponse, la boucle relance l'agent.
const DONE_SENTINEL: &str = "APHRODY_LOOP_DONE";

/// Chemin du fichier d'état de la boucle, relatif au workspace courant.
const STATE_REL: &str = ".agents/aphrody-loop.json";

/// Marqueur d'arrêt explicite (créé par `agy-loop stop`), relatif au workspace.
const STOP_REL: &str = ".agents/aphrody-loop.stop";

/// Plafond d'itérations par défaut (garde anti-emballement / anti-coût).
const DEFAULT_MAX_ITERATIONS: u32 = 50;

/// Nombre d'arrêts consécutifs sur erreur après lequel la boucle se désarme au
/// lieu de relancer un agent qui échoue en boucle (auth expirée, quota, …).
const MAX_ERROR_STREAK: u32 = 3;

/// Commande de base câblée dans le `hooks.json` d'agy.
const HOOK_COMMAND: &str = "aphrody agy-loop hook";

/// Actions de la sous-commande `agy-loop`.
#[derive(clap::Subcommand, Debug, Clone)]
pub(crate) enum AgyLoopAction {
    /// Arme la boucle pour le workspace courant avec un objectif.
    ///
    /// Exemple : aphrody agy-loop start --goal "implémente l'auth OAuth, tests verts" --max 40
    Start {
        /// Objectif de codage réinjecté à l'agent à chaque tour.
        #[arg(long)]
        goal: String,
        /// Plafond d'itérations avant arrêt forcé (garde anti-emballement).
        #[arg(long, default_value_t = DEFAULT_MAX_ITERATIONS)]
        max: u32,
    },
    /// Désarme la boucle (efface l'état) pour le workspace courant.
    Stop,
    /// Affiche l'état courant de la boucle en JSON.
    Status,
    /// Driver des hooks `Stop` et `PostInvocation` : lit le JSON du hook sur
    /// stdin, émet une décision sur stdout. Câblé par le plugin agy — pas pour
    /// usage manuel.
    Hook {
        /// Évènement traité (défaut : déduit du JSON reçu, `stop` si indéterminé).
        #[arg(long, value_enum)]
        event: Option<HookEvent>,
    },
    /// Affiche le fragment `hooks.json` (format natif agy) qui câble la boucle
    /// sur `Stop` et `PostInvocation`.
    HooksJson,
}

/// Évènement de hook traité par `agy-loop hook`.
#[derive(clap::ValueEnum, Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HookEvent {
    /// `Stop` d'agy : pilote de la boucle (relance ou laisse s'arrêter).
    Stop,
    /// `PostInvocation` d'agy : comptabilité par tour, ne force jamais rien.
    PostInvocation,
    /// `AfterAgent` du Gemini CLI déprécié (dialecte hérité, absent d'agy).
    AfterAgent,
}

/// État persistant d'une boucle de codage active.
///
/// Les champs ajoutés après la première version portent `#[serde(default)]` :
/// un fichier d'état écrit par une version antérieure reste lisible.
#[derive(Serialize, Deserialize, Debug, Clone)]
struct LoopState {
    /// Objectif réinjecté à chaque tour.
    goal: String,
    /// Nombre de relances déjà forcées.
    iteration: u32,
    /// Plafond d'itérations.
    max_iterations: u32,
    /// Horodatage ISO 8601 d'armement (informatif).
    started_at: String,
    /// Invocations du modèle comptées par `PostInvocation` depuis l'armement.
    #[serde(default)]
    invocations: u32,
    /// Dernier `invocationNum` reçu d'agy dans un `PostInvocation`.
    #[serde(default)]
    last_invocation_num: u32,
    /// `true` dès que la sentinelle a été vue seule sur une ligne dans une
    /// sortie du modèle (captée par `PostInvocation`, consommée par `Stop`).
    #[serde(default)]
    done_seen: bool,
    /// Arrêts consécutifs sur erreur (`terminationReason` = `error`).
    #[serde(default)]
    error_streak: u32,
}

impl LoopState {
    /// Nouvel état armé : aucune relance forcée, comptabilité à zéro.
    fn new(goal: String, max_iterations: u32) -> Self {
        Self {
            goal,
            iteration: 0,
            max_iterations: max_iterations.max(1),
            started_at: now_iso8601(),
            invocations: 0,
            last_invocation_num: 0,
            done_seen: false,
            error_streak: 0,
        }
    }
}

/// Résout le workspace des actions `start`/`stop`/`status` : `cwd` explicite,
/// sinon répertoire courant. Les hooks, eux, passent par
/// [`workspace_candidates`] (agy fournit `workspacePaths`).
fn workspace_from(cwd: Option<&str>) -> PathBuf {
    cwd.filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn state_path(ws: &Path) -> PathBuf {
    ws.join(STATE_REL)
}

fn stop_path(ws: &Path) -> PathBuf {
    ws.join(STOP_REL)
}

fn load_state(ws: &Path) -> Option<LoopState> {
    let raw = std::fs::read_to_string(state_path(ws)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn save_state(ws: &Path, st: &LoopState) -> miette::Result<()> {
    let path = state_path(ws);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| miette::miette!("create .agents dir: {e}"))?;
    }
    let body =
        serde_json::to_string_pretty(st).map_err(|e| miette::miette!("encode loop state: {e}"))?;
    std::fs::write(&path, body).map_err(|e| miette::miette!("write loop state: {e}"))
}

fn clear_state(ws: &Path) {
    let _ = std::fs::remove_file(state_path(ws));
    let _ = std::fs::remove_file(stop_path(ws));
}

/// Directive de relance réinjectée à l'agent quand la boucle force un tour.
fn directive(st: &LoopState) -> String {
    format!(
        "Tu n'as PAS terminé (itération {iter}/{max} de la boucle aphrody). OBJECTIF : \
         {goal}\n\nContinue en autonomie totale, sans poser de question : implémente la prochaine \
         étape concrète avec du vrai code (zéro stub, zéro TODO), lance le build et les tests, \
         corrige les échecs. Si tout est déjà implémenté, durcis les tests et la doc. Quand — et \
         seulement quand — l'objectif est entièrement implémenté, vérifié vert (build + tests) et \
         committé, écris le jeton exact `{done}` seul sur sa dernière ligne. Sinon, reprends le \
         travail maintenant.",
        iter = st.iteration,
        max = st.max_iterations,
        goal = st.goal,
        done = DONE_SENTINEL,
    )
}

/// Émet une réponse de hook JSON sur stdout (un objet par ligne).
fn emit(value: &Value) {
    println!("{value}");
}

/// Premier champ texte présent parmi `keys` (agy : camelCase, Gemini CLI :
/// snake_case).
fn first_str<'a>(v: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter().find_map(|k| v.get(*k).and_then(Value::as_str))
}

/// Entier présent dans le JSON, nombre ou chaîne numérique (protojson encode
/// les entiers 64 bits en chaînes).
fn as_count(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str().and_then(|s| s.trim().parse().ok()))
}

/// `true` si la sentinelle [`DONE_SENTINEL`] figure seule sur une ligne de
/// `text` (décorations markdown tolérées). Une simple mention dans une phrase —
/// par exemple la directive recopiée par le modèle — ne compte pas.
fn reports_done(text: &str) -> bool {
    let decoration = |c: char| matches!(c, '`' | '*' | '_' | '"' | '\'');
    text.lines().any(|line| line.trim().trim_matches(decoration) == DONE_SENTINEL)
}

/// Dernière sortie du modèle : `finalModelOutput` (agy `Stop`), `modelOutput`
/// (agy `PostInvocation`) ou `prompt_response` (Gemini CLI `AfterAgent`).
fn final_output(v: &Value) -> &str {
    first_str(v, &["finalModelOutput", "modelOutput", "prompt_response"]).unwrap_or("")
}

/// `true` pour la conversation d'un sous-agent (`parentConversationId` non
/// vide) : seule la conversation racine pilote la boucle.
fn is_subagent(v: &Value) -> bool {
    first_str(v, &["parentConversationId"]).is_some_and(|s| !s.is_empty())
}

/// Comment le tour s'est terminé, d'après le payload d'un hook `Stop` d'agy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EndKind {
    /// Fin normale (plus d'appel d'outil, plafond de pas, …).
    Normal,
    /// Fin sur erreur (`terminationReason` = `error` ou champ `error` non vide).
    Error,
    /// Tour interrompu par l'utilisateur.
    Cancelled,
}

/// Classe la fin de tour. Les valeurs de `terminationReason` documentées par
/// agy sont `model_stop`, `max_steps_exceeded` et `error` ; l'énumération
/// interne distingue aussi l'annulation utilisateur, repérée par sous-chaîne.
fn end_kind(v: &Value) -> EndKind {
    let reason = first_str(v, &["terminationReason"]).unwrap_or("").to_ascii_lowercase();
    if reason.contains("cancel") || reason.contains("interrupt") {
        EndKind::Cancelled
    } else if reason.contains("error") || first_str(v, &["error"]).is_some_and(|e| !e.is_empty()) {
        EndKind::Error
    } else {
        EndKind::Normal
    }
}

/// Décision du pilote, indépendante du dialecte de sortie du hook.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Verdict {
    /// Objectif atteint (sentinelle) ou arrêt explicite demandé.
    Done { iterations: u32 },
    /// L'utilisateur a interrompu le tour : la boucle se désarme.
    Cancelled,
    /// Plafond d'itérations atteint.
    CapReached { max: u32 },
    /// Trop d'arrêts consécutifs sur erreur.
    ErrorBail { streak: u32 },
    /// Relance forcée de l'agent avec cette directive.
    Continue { directive: String },
}

impl Verdict {
    /// Message lisible pour tout verdict, utilisé comme `reason` quand l'agent
    /// est autorisé à s'arrêter.
    fn message(&self) -> String {
        match self {
            Self::Done { iterations } => {
                format!("aphrody agy-loop : objectif atteint après {iterations} itération(s).")
            },
            Self::Cancelled => "aphrody agy-loop : tour interrompu par l'utilisateur — boucle \
                                désarmée. Réarme avec `aphrody agy-loop start`."
                .to_owned(),
            Self::CapReached { max } => format!(
                "aphrody agy-loop : plafond d'itérations ({max}) atteint — arrêt pour éviter \
                 l'emballement. Réarme avec `aphrody agy-loop start`."
            ),
            Self::ErrorBail { streak } => format!(
                "aphrody agy-loop : {streak} arrêts consécutifs sur erreur — boucle désarmée pour \
                 éviter l'emballement. Corrige la cause (auth, quota, réseau) puis réarme avec \
                 `aphrody agy-loop start`."
            ),
            Self::Continue { directive } => directive.clone(),
        }
    }
}

/// Tranche entre relancer l'agent et le laisser s'arrêter. Met à jour le
/// compteur d'itérations et la série d'erreurs de `st` ; l'appelant persiste
/// l'état sur [`Verdict::Continue`] et l'efface pour tout autre verdict.
fn judge(st: &mut LoopState, output: &str, stop_requested: bool, end: EndKind) -> Verdict {
    // Terminaison : sentinelle émise (dans la sortie finale, ou captée plus tôt
    // par `PostInvocation`) ou arrêt explicite demandé.
    if st.done_seen || reports_done(output) || stop_requested {
        return Verdict::Done { iterations: st.iteration };
    }
    // L'utilisateur reprend la main : on ne force jamais la suite d'un tour
    // qu'il vient d'interrompre.
    if end == EndKind::Cancelled {
        return Verdict::Cancelled;
    }
    // Garde anti-emballement : plafond atteint ⇒ on rend la main.
    if st.iteration >= st.max_iterations {
        return Verdict::CapReached { max: st.max_iterations };
    }
    // Un agent qui échoue en boucle n'est pas relancé indéfiniment.
    if end == EndKind::Error {
        st.error_streak = st.error_streak.saturating_add(1);
        if st.error_streak >= MAX_ERROR_STREAK {
            return Verdict::ErrorBail { streak: st.error_streak };
        }
    } else {
        st.error_streak = 0;
    }
    // Sinon : force un nouveau tour de codage.
    st.iteration += 1;
    Verdict::Continue { directive: directive(st) }
}

/// Réponse d'un hook `Stop` d'agy : `continue` bloque l'arrêt et réinjecte
/// `reason` en message système ; toute autre valeur laisse l'agent s'arrêter.
/// Seuls les champs du contrat agy (`decision`, `reason`) sont émis.
fn render_stop(verdict: &Verdict) -> Value {
    match verdict {
        Verdict::Continue { directive } => json!({ "decision": "continue", "reason": directive }),
        other => json!({ "decision": "allow_stop", "reason": other.message() }),
    }
}

/// Réponse au dialecte hérité du Gemini CLI (`AfterAgent`), inchangée.
fn render_after_agent(verdict: &Verdict) -> Value {
    match verdict {
        Verdict::Continue { directive } => json!({ "decision": "deny", "reason": directive }),
        Verdict::Done { .. } => json!({
            "continue": true,
            "suppressOutput": true,
            "systemMessage": verdict.message(),
        }),
        other => json!({ "continue": true, "systemMessage": other.message() }),
    }
}

/// Comptabilité par tour d'un `PostInvocation` : compte l'invocation, retient
/// son numéro et capte la sentinelle de fin pour le prochain `Stop`.
fn account_invocation(st: &mut LoopState, v: &Value) {
    st.invocations = st.invocations.saturating_add(1);
    if let Some(n) = v.get("invocationNum").and_then(as_count) {
        st.last_invocation_num = u32::try_from(n).unwrap_or(u32::MAX);
    }
    if reports_done(first_str(v, &["modelOutput"]).unwrap_or("")) {
        st.done_seen = true;
    }
}

/// Évènement du hook : `hook_event_name` s'il est présent, sinon déduit de la
/// forme du payload (`invocationNum` ⇒ `PostInvocation`, `prompt_response` ⇒
/// `AfterAgent` hérité), `Stop` par défaut.
fn detect_event(v: &Value) -> HookEvent {
    match first_str(v, &["hook_event_name", "hookEventName"]) {
        Some("AfterAgent") => return HookEvent::AfterAgent,
        Some("PostInvocation") => return HookEvent::PostInvocation,
        Some("Stop") => return HookEvent::Stop,
        _ => {},
    }
    if v.get("invocationNum").is_some() {
        HookEvent::PostInvocation
    } else if v.get("prompt_response").is_some() {
        HookEvent::AfterAgent
    } else {
        HookEvent::Stop
    }
}

/// Candidats de workspace d'un hook, par ordre de priorité : `workspacePaths`
/// (agy), `cwd` (Gemini CLI), puis le répertoire courant du hook. agy lance les
/// hooks depuis le dossier du `hooks.json` — typiquement `<workspace>/.agents`
/// — d'où le repli sur son parent.
fn workspace_candidates(v: &Value) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = v
        .get("workspacePaths")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .collect();
    if let Some(cwd) = first_str(v, &["cwd"]).filter(|s| !s.is_empty()) {
        out.push(PathBuf::from(cwd));
    }
    if let Ok(cur) = std::env::current_dir() {
        if cur.file_name().is_some_and(|n| n == ".agents")
            && let Some(parent) = cur.parent()
        {
            out.push(parent.to_path_buf());
        }
        out.push(cur);
    }
    out
}

/// Premier workspace candidat qui porte une boucle armée.
fn find_active(candidates: &[PathBuf]) -> Option<(PathBuf, LoopState)> {
    candidates.iter().find_map(|ws| load_state(ws).map(|st| (ws.clone(), st)))
}

/// Cœur du hook, sans E/S standard : applique `event` au premier workspace
/// candidat qui porte une boucle armée et renvoie la réponse JSON du hook.
fn handle_hook_in(event: HookEvent, v: &Value, candidates: &[PathBuf]) -> miette::Result<Value> {
    // Boucle inactive ⇒ no-op : on n'interfère jamais avec un arrêt normal.
    let Some((ws, mut st)) = find_active(candidates) else {
        return Ok(json!({}));
    };
    // Une conversation fille (sous-agent) ne pilote ni ne compte la boucle.
    if event != HookEvent::AfterAgent && is_subagent(v) {
        return Ok(json!({}));
    }
    // `PostInvocation` : comptabilité seulement, jamais de relance forcée.
    if event == HookEvent::PostInvocation {
        account_invocation(&mut st, v);
        save_state(&ws, &st)?;
        return Ok(json!({}));
    }
    let end = if event == HookEvent::Stop { end_kind(v) } else { EndKind::Normal };
    let verdict = judge(&mut st, final_output(v), stop_path(&ws).exists(), end);
    if matches!(verdict, Verdict::Continue { .. }) {
        save_state(&ws, &st)?;
    } else {
        clear_state(&ws);
    }
    Ok(if event == HookEvent::AfterAgent {
        render_after_agent(&verdict)
    } else {
        render_stop(&verdict)
    })
}

/// Pilote des hooks `Stop` / `PostInvocation` : lit le JSON sur stdin, répond
/// sur stdout. Ne casse jamais agy : une E/S d'état en échec est journalisée sur
/// stderr et la réponse devient `{}` (comportement par défaut d'agy).
fn run_hook(event: Option<HookEvent>) -> miette::Result<()> {
    let mut buf = String::new();
    // Tolérant : stdin vide / illisible ⇒ no-op (ne jamais casser agy).
    let _ = std::io::stdin().read_to_string(&mut buf);
    let v: Value = serde_json::from_str(&buf).unwrap_or(Value::Null);
    let event = event.unwrap_or_else(|| detect_event(&v));
    let reply = handle_hook_in(event, &v, &workspace_candidates(&v)).unwrap_or_else(|e| {
        eprintln!("aphrody agy-loop : {e}");
        json!({})
    });
    emit(&reply);
    Ok(())
}

/// Fragment `hooks.json` au format natif d'agy : une clé par hook nommé, puis
/// les listes d'évènements. `Stop` et `PostInvocation` sont des listes « plates »
/// de gestionnaires (le `matcher` est réservé à `PreToolUse`/`PostToolUse`).
fn hooks_fragment() -> Value {
    json!({
        "aphrody-loop": {
            "PostInvocation": [
                {
                    "type": "command",
                    "command": format!("{HOOK_COMMAND} --event post-invocation"),
                    "timeout": 10
                }
            ],
            "Stop": [
                {
                    "type": "command",
                    "command": format!("{HOOK_COMMAND} --event stop"),
                    "timeout": 10
                }
            ]
        }
    })
}

/// Exécute une action `agy-loop`.
///
/// # Errors
///
/// Renvoie un rapport `miette` sur échec d'IO (lecture/écriture de l'état).
pub(crate) fn run(action: AgyLoopAction) -> miette::Result<()> {
    let ws = workspace_from(None);
    match action {
        AgyLoopAction::Start { goal, max } => {
            let st = LoopState::new(goal, max);
            save_state(&ws, &st)?;
            // Un éventuel marqueur d'arrêt résiduel doit être levé au (ré)armement.
            let _ = std::fs::remove_file(stop_path(&ws));
            println!(
                "aphrody agy-loop armé (max {} itérations) dans {}\nobjectif : {}",
                st.max_iterations,
                state_path(&ws).display(),
                st.goal,
            );
            Ok(())
        },
        AgyLoopAction::Stop => {
            // Pose le marqueur d'arrêt (capté par le prochain hook) ET efface
            // l'état immédiatement pour les invocations hors hook.
            if let Some(parent) = stop_path(&ws).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(stop_path(&ws), b"stop\n");
            clear_state(&ws);
            println!("aphrody agy-loop désarmé pour {}", ws.display());
            Ok(())
        },
        AgyLoopAction::Status => {
            match load_state(&ws) {
                Some(st) => {
                    let rendered = serde_json::to_string_pretty(&st)
                        .map_err(|e| miette::miette!("encode loop state: {e}"))?;
                    println!("{rendered}");
                },
                None => println!("(boucle inactive dans {})", ws.display()),
            }
            Ok(())
        },
        AgyLoopAction::Hook { event } => run_hook(event),
        AgyLoopAction::HooksJson => {
            let rendered = serde_json::to_string_pretty(&hooks_fragment())
                .map_err(|e| miette::miette!("encode hooks fragment: {e}"))?;
            println!("{rendered}");
            Ok(())
        },
    }
}

/// Horodatage ISO 8601 UTC sans dépendance externe lourde (via `std::time`).
fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // Conversion epoch → date civile (algorithme de Howard Hinnant, jours civils).
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Workspace jetable portant une boucle armée (`max` itérations).
    fn armed_ws(max: u32) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        save_state(dir.path(), &LoopState::new("ship feature X".to_owned(), max)).unwrap();
        dir
    }

    /// Payload `Stop` d'agy (camelCase) pour le workspace `ws`.
    fn stop_payload(ws: &Path, output: &str) -> Value {
        json!({
            "conversationId": "c-1",
            "workspacePaths": [ws.to_string_lossy()],
            "executionNum": 1,
            "terminationReason": "model_stop",
            "fullyIdle": true,
            "finalModelOutput": output,
        })
    }

    /// Payload `PostInvocation` d'agy (camelCase) pour le workspace `ws`.
    fn post_invocation_payload(ws: &Path, num: u32, output: &str) -> Value {
        json!({
            "conversationId": "c-1",
            "workspacePaths": [ws.to_string_lossy()],
            "invocationNum": num,
            "initialNumSteps": 10,
            "modelOutput": output,
            "modelThinking": "…",
        })
    }

    #[test]
    fn start_then_status_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path();
        save_state(ws, &LoopState::new("ship feature X".to_owned(), 10)).unwrap();
        let back = load_state(ws).expect("state persisted");
        assert_eq!(back.goal, "ship feature X");
        assert_eq!(back.max_iterations, 10);
        assert_eq!(back.iteration, 0);
        clear_state(ws);
        assert!(load_state(ws).is_none());
    }

    #[test]
    fn state_file_from_an_older_version_still_loads() {
        let dir = tempfile::tempdir().unwrap();
        let path = state_path(dir.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"goal":"g","iteration":2,"max_iterations":9,"started_at":"2026-01-01T00:00:00Z"}"#,
        )
        .unwrap();
        let st = load_state(dir.path()).expect("state written by v1 loads");
        assert_eq!((st.iteration, st.max_iterations, st.invocations), (2, 9, 0));
        assert!(!st.done_seen);
        assert_eq!(st.error_streak, 0);
    }

    #[test]
    fn directive_embeds_goal_and_sentinel() {
        let mut st = LoopState::new("fix the parser".to_owned(), 50);
        st.iteration = 3;
        let d = directive(&st);
        assert!(d.contains("fix the parser"));
        assert!(d.contains(DONE_SENTINEL));
        assert!(d.contains("3/50"));
    }

    #[test]
    fn sentinel_must_stand_alone_on_a_line() {
        assert!(reports_done("tout est vert\nAPHRODY_LOOP_DONE"));
        assert!(reports_done("  APHRODY_LOOP_DONE  \nmerci"));
        assert!(reports_done("fin\n`APHRODY_LOOP_DONE`"));
        assert!(reports_done("**APHRODY_LOOP_DONE**"));
        // Une mention dans une phrase (directive recopiée) n'est pas une terminaison.
        assert!(!reports_done("quand j'aurai fini j'écrirai APHRODY_LOOP_DONE"));
        let echoed = "écris le jeton exact `APHRODY_LOOP_DONE` seul sur sa dernière ligne";
        assert!(!reports_done(echoed));
        assert!(!reports_done(""));
    }

    #[test]
    fn stop_forces_continue_with_the_agy_decision_contract() {
        let dir = armed_ws(5);
        let ws = dir.path().to_path_buf();
        let payload = stop_payload(&ws, "encore du travail");
        let reply = handle_hook_in(HookEvent::Stop, &payload, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(reply["decision"], "continue");
        let reason = reply["reason"].as_str().unwrap();
        assert!(reason.contains("ship feature X"), "{reason}");
        assert!(reason.contains("1/5"), "{reason}");
        // Seuls les champs du contrat agy sont émis : ni `systemMessage` ni
        // `continue` (dialecte Gemini CLI).
        let keys: Vec<&str> = reply.as_object().unwrap().keys().map(String::as_str).collect();
        assert_eq!(keys, ["decision", "reason"]);
        assert_eq!(load_state(&ws).unwrap().iteration, 1);
    }

    #[test]
    fn stop_allows_exit_when_the_sentinel_stands_alone_on_a_line() {
        let dir = armed_ws(5);
        let ws = dir.path().to_path_buf();
        let payload = stop_payload(&ws, "tout est vert et committé\nAPHRODY_LOOP_DONE");
        let reply = handle_hook_in(HookEvent::Stop, &payload, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(reply["decision"], "allow_stop");
        assert!(reply["reason"].as_str().unwrap().contains("objectif atteint"));
        assert!(load_state(&ws).is_none(), "l'état est effacé à la terminaison");
    }

    #[test]
    fn stop_keeps_looping_when_the_sentinel_is_only_mentioned() {
        let dir = armed_ws(5);
        let ws = dir.path().to_path_buf();
        let payload = stop_payload(&ws, "je finirai par écrire APHRODY_LOOP_DONE si tout est vert");
        let reply = handle_hook_in(HookEvent::Stop, &payload, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(reply["decision"], "continue");
    }

    #[test]
    fn stop_caps_the_iterations() {
        let dir = armed_ws(2);
        let ws = dir.path().to_path_buf();
        let payload = stop_payload(&ws, "pas fini");
        for expected in 1..=2 {
            let reply =
                handle_hook_in(HookEvent::Stop, &payload, std::slice::from_ref(&ws)).unwrap();
            assert_eq!(reply["decision"], "continue");
            assert_eq!(load_state(&ws).unwrap().iteration, expected);
        }
        let reply = handle_hook_in(HookEvent::Stop, &payload, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(reply["decision"], "allow_stop");
        assert!(reply["reason"].as_str().unwrap().contains("plafond"));
        assert!(load_state(&ws).is_none());
    }

    #[test]
    fn stop_honours_the_explicit_stop_marker() {
        let dir = armed_ws(5);
        let ws = dir.path().to_path_buf();
        std::fs::write(stop_path(&ws), b"stop\n").unwrap();
        let payload = stop_payload(&ws, "pas fini");
        let reply = handle_hook_in(HookEvent::Stop, &payload, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(reply["decision"], "allow_stop");
        assert!(!stop_path(&ws).exists(), "le marqueur est consommé");
    }

    #[test]
    fn stop_without_an_armed_loop_is_a_noop() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path().to_path_buf();
        let payload = stop_payload(&ws, "pas fini");
        let reply = handle_hook_in(HookEvent::Stop, &payload, &[ws]).unwrap();
        assert_eq!(reply, json!({}));
    }

    #[test]
    fn subagent_conversations_do_not_drive_the_loop() {
        let dir = armed_ws(5);
        let ws = dir.path().to_path_buf();
        let mut payload = stop_payload(&ws, "pas fini");
        payload["parentConversationId"] = json!("parent-1");
        let reply = handle_hook_in(HookEvent::Stop, &payload, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(reply, json!({}));
        assert_eq!(load_state(&ws).unwrap().iteration, 0);
        let mut post = post_invocation_payload(&ws, 1, "APHRODY_LOOP_DONE");
        post["parentConversationId"] = json!("parent-1");
        handle_hook_in(HookEvent::PostInvocation, &post, std::slice::from_ref(&ws)).unwrap();
        let st = load_state(&ws).unwrap();
        assert_eq!(st.invocations, 0);
        assert!(!st.done_seen);
    }

    #[test]
    fn user_cancel_disarms_instead_of_forcing_another_turn() {
        let dir = armed_ws(5);
        let ws = dir.path().to_path_buf();
        let mut payload = stop_payload(&ws, "");
        payload["terminationReason"] = json!("user_canceled");
        let reply = handle_hook_in(HookEvent::Stop, &payload, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(reply["decision"], "allow_stop");
        assert!(reply["reason"].as_str().unwrap().contains("interrompu"));
        assert!(load_state(&ws).is_none());
    }

    #[test]
    fn repeated_errors_bail_out_and_a_healthy_stop_resets_the_streak() {
        let dir = armed_ws(50);
        let ws = dir.path().to_path_buf();
        let mut failing = stop_payload(&ws, "");
        failing["terminationReason"] = json!("error");
        failing["error"] = json!("quota");
        for _ in 1..MAX_ERROR_STREAK {
            let reply =
                handle_hook_in(HookEvent::Stop, &failing, std::slice::from_ref(&ws)).unwrap();
            assert_eq!(reply["decision"], "continue");
        }
        assert_eq!(load_state(&ws).unwrap().error_streak, MAX_ERROR_STREAK - 1);
        // Un arrêt sain remet la série à zéro.
        let healthy = stop_payload(&ws, "pas fini");
        handle_hook_in(HookEvent::Stop, &healthy, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(load_state(&ws).unwrap().error_streak, 0);
        // MAX_ERROR_STREAK erreurs consécutives désarment la boucle.
        for _ in 1..MAX_ERROR_STREAK {
            handle_hook_in(HookEvent::Stop, &failing, std::slice::from_ref(&ws)).unwrap();
        }
        let reply = handle_hook_in(HookEvent::Stop, &failing, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(reply["decision"], "allow_stop");
        assert!(reply["reason"].as_str().unwrap().contains("erreur"));
        assert!(load_state(&ws).is_none());
    }

    #[test]
    fn post_invocation_accounts_per_turn_and_never_forces() {
        let dir = armed_ws(5);
        let ws = dir.path().to_path_buf();
        let payload = post_invocation_payload(&ws, 3, "je continue");
        let reply =
            handle_hook_in(HookEvent::PostInvocation, &payload, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(reply, json!({}));
        let st = load_state(&ws).unwrap();
        assert_eq!((st.invocations, st.last_invocation_num, st.iteration), (1, 3, 0));
        assert!(!st.done_seen);
    }

    #[test]
    fn post_invocation_captures_the_sentinel_for_the_next_stop() {
        let dir = armed_ws(5);
        let ws = dir.path().to_path_buf();
        let post = post_invocation_payload(&ws, 4, "tout est vert\nAPHRODY_LOOP_DONE");
        handle_hook_in(HookEvent::PostInvocation, &post, std::slice::from_ref(&ws)).unwrap();
        assert!(load_state(&ws).unwrap().done_seen);
        // `finalModelOutput` vide : la sentinelle captée au tour précédent suffit.
        let reply =
            handle_hook_in(HookEvent::Stop, &stop_payload(&ws, ""), std::slice::from_ref(&ws))
                .unwrap();
        assert_eq!(reply["decision"], "allow_stop");
        assert!(load_state(&ws).is_none());
    }

    #[test]
    fn legacy_after_agent_keeps_the_gemini_dialect() {
        let dir = armed_ws(5);
        let ws = dir.path().to_path_buf();
        let payload = json!({
            "hook_event_name": "AfterAgent",
            "cwd": ws.to_string_lossy(),
            "prompt_response": "pas fini",
        });
        assert_eq!(detect_event(&payload), HookEvent::AfterAgent);
        let reply =
            handle_hook_in(HookEvent::AfterAgent, &payload, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(reply["decision"], "deny");
        assert!(reply["reason"].as_str().unwrap().contains("ship feature X"));
        let done = json!({
            "hook_event_name": "AfterAgent",
            "prompt_response": "ok\nAPHRODY_LOOP_DONE",
        });
        let reply =
            handle_hook_in(HookEvent::AfterAgent, &done, std::slice::from_ref(&ws)).unwrap();
        assert_eq!(reply["continue"], true);
        assert!(reply["systemMessage"].as_str().unwrap().contains("objectif atteint"));
        assert!(load_state(&ws).is_none());
    }

    #[test]
    fn event_is_detected_from_the_payload_shape() {
        assert_eq!(detect_event(&json!({ "invocationNum": 2 })), HookEvent::PostInvocation);
        let stop = json!({ "executionNum": 1, "terminationReason": "model_stop" });
        assert_eq!(detect_event(&stop), HookEvent::Stop);
        assert_eq!(detect_event(&json!({ "hook_event_name": "Stop" })), HookEvent::Stop);
        assert_eq!(detect_event(&json!({ "prompt_response": "x" })), HookEvent::AfterAgent);
        assert_eq!(detect_event(&Value::Null), HookEvent::Stop);
    }

    #[test]
    fn workspace_candidates_prefer_the_agy_workspace_paths() {
        let v = json!({ "workspacePaths": ["/w/one", "/w/two", ""], "cwd": "/legacy" });
        let c = workspace_candidates(&v);
        assert_eq!(c[0], PathBuf::from("/w/one"));
        assert_eq!(c[1], PathBuf::from("/w/two"));
        assert_eq!(c[2], PathBuf::from("/legacy"));
    }

    #[test]
    fn hooks_fragment_uses_only_native_agy_events() {
        // Garde locale uniquement : la table de normalisation des évènements entre
        // outils appartient à `aphrody-marketplace`.
        const AGY_EVENTS: [&str; 5] =
            ["PreToolUse", "PostToolUse", "PreInvocation", "PostInvocation", "Stop"];
        let fragment = hooks_fragment();
        let named = fragment["aphrody-loop"].as_object().expect("un hook nommé");
        for (event, handlers) in named {
            assert!(AGY_EVENTS.contains(&event.as_str()), "{event} n'est pas un évènement agy");
            // `Stop` / `PostInvocation` sont des listes plates : pas de `matcher`.
            for handler in handlers.as_array().unwrap() {
                assert_eq!(handler["type"], "command");
                assert!(handler.get("matcher").is_none());
                assert!(handler["command"].as_str().unwrap().starts_with(HOOK_COMMAND));
            }
        }
        assert!(named.contains_key("Stop"));
        assert!(named.contains_key("PostInvocation"));
        assert!(!fragment.to_string().contains("AfterAgent"));
    }

    #[test]
    fn iso8601_shape() {
        let s = now_iso8601();
        // YYYY-MM-DDTHH:MM:SSZ ⇒ 20 caractères.
        assert_eq!(s.len(), 20, "{s}");
        assert!(s.ends_with('Z'));
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[10..11], "T");
    }

    #[test]
    fn workspace_falls_back_to_cwd() {
        let ws = workspace_from(Some(""));
        assert!(ws.is_absolute() || ws == Path::new("."));
        let ws2 = workspace_from(Some("/tmp/x"));
        assert_eq!(ws2, Path::new("/tmp/x"));
    }
}
