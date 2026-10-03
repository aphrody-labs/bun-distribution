// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors

//! Local Dragon Ball knowledge: corpus paths, a naive in-memory index, the
//! single-bot persona and the grounded local answer.
//!
//! This is the library side of the `dragonball.*` MCP tools served by
//! `aphrody-mcp`. It replaces the Bun `apps/shenron-mcp` local RAG
//! (`local-ai.ts`, `local-rag.ts`, `persona.ts`) with the same contracts:
//!
//! - Model endpoints follow the `APHRODY_AI_*` contract
//!   ([`aphrody_config::ai_env`], mirrored by `config/local-ai.json`).
//!   `APHRODY_LOCAL_AI_CONFIG` names a contract file whose alias forms and
//!   default model are honoured. No endpoint literal lives here: without a
//!   variable, the local chat model is simply unavailable.
//! - The corpus comes from `APHRODY_DRAGONBALL_CORPUS` (file or directory),
//!   else `<dataset dir>/corpus`, where the dataset dir is
//!   `APHRODY_DRAGONBALL_DATASET_DIR` or `crates/aphrody-rag-eval/datasets/dragonball`.
//!   The runtime `aphrody-rag` store is `APHRODY_DRAGONBALL_RAG_DB`, else
//!   `<crawl dir>/rag.sqlite`, the crawl dir being `APHRODY_CORPUS_CRAWL_DIR`
//!   or `<APHRODY_HOME|~/.aphrody>/workspaces/dbfr/crawl`.
//!
//! Every resolver has a `_with` twin taking an environment lookup so it can be
//! tested without mutating the process environment.

use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use aphrody_config::ai_env;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::shenron::{ShenronCorpusDoc, load_shenron_corpus};

/// Embedded canon reference, always part of the local index.
const LORE: &str = include_str!("../assets/dragonball/lore.md");
/// Embedded exploration guide, always part of the local index.
const GUIDE: &str = include_str!("../assets/dragonball/guide.md");

/// Public site used to absolutize relative corpus URLs.
pub const SITE_BASE: &str = "https://dragonballfr.com";

/// Environment lookup used by the `_with` resolvers.
pub type EnvLookup<'a> = &'a (dyn Fn(&str) -> Option<String> + Sync);

/// Read a process variable, treating a blank value as unset.
#[must_use]
pub fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

fn get(env: EnvLookup<'_>, name: &str) -> Option<String> {
    env(name).map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// Aphrody home: `APHRODY_HOME`, else `~/.aphrody`.
#[must_use]
pub fn aphrody_home_with(env: EnvLookup<'_>) -> PathBuf {
    get(env, "APHRODY_HOME").map_or_else(
        || dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(".aphrody"),
        PathBuf::from,
    )
}

/// Dataset directory: `APHRODY_DRAGONBALL_DATASET_DIR`, else the in-repo
/// `crates/aphrody-rag-eval/datasets/dragonball`.
#[must_use]
pub fn dataset_dir_with(env: EnvLookup<'_>) -> PathBuf {
    get(env, "APHRODY_DRAGONBALL_DATASET_DIR").map_or_else(
        || Path::new(env!("CARGO_MANIFEST_DIR")).join("../aphrody-rag-eval/datasets/dragonball"),
        PathBuf::from,
    )
}

/// Crawl directory: `APHRODY_CORPUS_CRAWL_DIR`, else `<home>/workspaces/dbfr/crawl`.
#[must_use]
pub fn crawl_dir_with(env: EnvLookup<'_>) -> PathBuf {
    get(env, "APHRODY_CORPUS_CRAWL_DIR").map_or_else(
        || aphrody_home_with(env).join("workspaces").join("dbfr").join("crawl"),
        PathBuf::from,
    )
}

/// Runtime RAG store: `APHRODY_DRAGONBALL_RAG_DB`, else `<crawl dir>/rag.sqlite`.
#[must_use]
pub fn rag_store_with(env: EnvLookup<'_>) -> PathBuf {
    get(env, "APHRODY_DRAGONBALL_RAG_DB")
        .map_or_else(|| crawl_dir_with(env).join("rag.sqlite"), PathBuf::from)
}

/// Corpus source: `APHRODY_DRAGONBALL_CORPUS`, else `<dataset dir>/corpus`.
#[must_use]
pub fn corpus_path_with(env: EnvLookup<'_>) -> PathBuf {
    get(env, "APHRODY_DRAGONBALL_CORPUS")
        .map_or_else(|| dataset_dir_with(env).join("corpus"), PathBuf::from)
}

// ---------------------------------------------------------------------------
// Local chat endpoint (APHRODY_AI_* contract)
// ---------------------------------------------------------------------------

/// A resolved OpenAI-compatible chat endpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ChatEndpoint {
    /// Base URL including the capability base path (e.g. `.../v1`).
    pub base_url: String,
    /// Full operation URL (`<base>/chat/completions`).
    pub url: String,
    /// Model id, when configured.
    pub model: Option<String>,
    /// Variable the URL came from.
    pub source: String,
}

const CHAT_BASE_PATH: &str = "/v1";
const CHAT_OPERATION: &str = "/chat/completions";

/// URL form of a variable, as declared by `aliasForms` in the contract.
fn chat_form(contract: Option<&Value>, name: &str) -> &'static str {
    let url_env = contract
        .and_then(|c| c.pointer("/capabilities/chat/env"))
        .and_then(Value::as_array)
        .and_then(|list| {
            list.iter().find(|e| e.get("kind").and_then(Value::as_str) == Some("url"))
        });
    let declared = url_env.and_then(|e| {
        e.pointer(&format!("/aliasForms/{name}")).or_else(|| e.get("form")).and_then(Value::as_str)
    });
    match declared {
        Some("origin") => "origin",
        Some("endpoint") => "endpoint",
        Some(_) => "base",
        // Built-in mirror of the contract when no contract file is given.
        None if name == "APHRODY_LOCAL_MODEL_URL" => "origin",
        None => "base",
    }
}

fn normalise_base(value: &str, form: &str) -> String {
    let url = value.trim_end_matches('/');
    match form {
        "origin" => format!("{url}{CHAT_BASE_PATH}"),
        "endpoint" => url.strip_suffix(CHAT_OPERATION).unwrap_or(url).to_owned(),
        _ => url.to_owned(),
    }
}

/// Resolve the local chat endpoint from the `APHRODY_AI_*` contract.
///
/// `APHRODY_LOCAL_AI_CONFIG` may name the contract JSON; its alias forms and
/// `defaultModel` are then honoured. Returns `None` when no URL variable is set.
#[must_use]
pub fn resolve_chat_with(env: EnvLookup<'_>) -> Option<ChatEndpoint> {
    let contract: Option<Value> = get(env, "APHRODY_LOCAL_AI_CONFIG")
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok());
    let source = ai_env::CHAT_BASE_URL.resolve_source_with(env)?;
    let raw = get(env, source)?;
    let base_url = normalise_base(&raw, chat_form(contract.as_ref(), source));
    let model = ai_env::CHAT_MODEL.resolve_with(env).or_else(|| {
        contract
            .as_ref()
            .and_then(|c| c.pointer("/capabilities/chat/defaultModel"))
            .and_then(Value::as_str)
            .map(str::to_owned)
    });
    Some(ChatEndpoint {
        url: format!("{base_url}{CHAT_OPERATION}"),
        base_url,
        model,
        source: source.to_owned(),
    })
}

// ---------------------------------------------------------------------------
// Persona (single bot)
// ---------------------------------------------------------------------------

/// The persona of the single Dragon Ball bot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Persona {
    /// Stable slug.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Short title.
    pub title: String,
    /// System prompt used for grounded answers.
    pub system_prompt: String,
    /// Whether this is the built-in default.
    #[serde(default)]
    pub is_default: bool,
}

/// The canonical default persona: Akira Toriyama (Tori-bot).
#[must_use]
pub fn toriyama_persona() -> Persona {
    Persona {
        id: "akira-toriyama".into(),
        name: "Akira Toriyama".into(),
        title: "Auteur et créateur de Dragon Ball (Tori-bot)".into(),
        system_prompt: "Tu es Akira Toriyama (Tori-bot), l'auteur et créateur original de Dragon \
                        Ball. Tu t'exprimes avec bienveillance, passion, modestie et \
                        l'autodérision caractéristique de Tori-bot. Tu es la référence absolue \
                        sur le manga original, le lore et la création de l'œuvre. Appuie-toi \
                        rigoureusement sur les passages documentaires fournis pour formuler tes \
                        réponses et cite toujours les sources [n] sans inventer d'éléments absents \
                        du canon."
            .into(),
        is_default: true,
    }
}

fn slug(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut dash = false;
    for c in name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    out.trim_end_matches('-').to_owned()
}

/// Path of the persisted user persona: `<home>/persona.json`.
#[must_use]
pub fn persona_path_with(env: EnvLookup<'_>) -> PathBuf {
    aphrody_home_with(env).join("persona.json")
}

/// Resolve the active persona.
///
/// 1. `APHRODY_YOLO=1` or `APHRODY_NHITL=1`: Akira Toriyama.
/// 2. `SHENRON_BOT_PERSONA` / `BOT_PERSONA`.
/// 3. The user persona saved in `<home>/persona.json`.
/// 4. Akira Toriyama.
#[must_use]
pub fn active_persona_with(env: EnvLookup<'_>) -> Persona {
    if get(env, "APHRODY_YOLO").as_deref() == Some("1")
        || get(env, "APHRODY_NHITL").as_deref() == Some("1")
    {
        return toriyama_persona();
    }
    if let Some(name) = get(env, "SHENRON_BOT_PERSONA").or_else(|| get(env, "BOT_PERSONA")) {
        return Persona {
            id: slug(&name),
            title: format!("Persona {name}"),
            system_prompt: format!(
                "Tu es le bot Dragon Ball incarnant le persona {name}. Réponds avec clarté, \
                 bienveillance et rigueur en te fondant exclusivement sur les sources fournies."
            ),
            name,
            is_default: false,
        };
    }
    std::fs::read_to_string(persona_path_with(env))
        .ok()
        .and_then(|raw| serde_json::from_str::<Persona>(&raw).ok())
        .filter(|p| !p.name.trim().is_empty() && !p.system_prompt.trim().is_empty())
        .unwrap_or_else(toriyama_persona)
}

/// Persist a user persona in `<home>/persona.json` and return it.
///
/// # Errors
/// Returns the I/O error when the file cannot be written.
pub fn set_user_persona_with(env: EnvLookup<'_>, name: &str) -> std::io::Result<Persona> {
    let name = name.trim();
    let persona = Persona {
        id: slug(name),
        name: name.to_owned(),
        title: format!("Persona {name}"),
        system_prompt: format!(
            "Tu es le bot Dragon Ball incarnant {name}. Réponds avec clarté et précision en \
             t'appuyant rigoureusement sur les passages fournis."
        ),
        is_default: false,
    };
    let path = persona_path_with(env);
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let body = serde_json::to_string_pretty(&persona).map_err(std::io::Error::other)?;
    std::fs::write(&path, body)?;
    Ok(persona)
}

// ---------------------------------------------------------------------------
// Naive local index
// ---------------------------------------------------------------------------

/// Filters accepted by [`LocalCorpus::search`].
#[derive(Debug, Clone, Default, Deserialize)]
pub struct LocalSearchOptions {
    /// Maximum hits (default 8).
    pub limit: Option<usize>,
    /// Language filter.
    pub lang: Option<String>,
    /// Entity substring filter.
    pub entity: Option<String>,
    /// Kind filter.
    pub kind: Option<String>,
}

/// One scored local passage.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalHit {
    /// Document id.
    pub rowid: String,
    /// Document kind.
    pub kind: String,
    /// Title.
    pub title: String,
    /// Absolute URL.
    pub url: String,
    /// Bounded passage.
    pub snippet: String,
    /// Score in `[0, 1]`, comparable within one answer only.
    pub score: f64,
    /// Language.
    pub lang: String,
    /// Origin corpus.
    pub origin_source_id: String,
    /// Entity tag.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity: Option<String>,
}

#[derive(Debug, Clone)]
struct IndexedDoc {
    doc: ShenronCorpusDoc,
    origin: String,
    title_lc: String,
    entity_lc: String,
    content_lc: String,
}

/// In-memory Dragon Ball corpus with naive lexical scoring.
#[derive(Debug, Clone, Default)]
pub struct LocalCorpus {
    docs: Vec<IndexedDoc>,
}

impl LocalCorpus {
    /// Build from explicit documents (tests, callers with their own source).
    #[must_use]
    pub fn from_docs(docs: impl IntoIterator<Item = (ShenronCorpusDoc, String)>) -> Self {
        let docs = docs
            .into_iter()
            .map(|(doc, origin)| IndexedDoc {
                title_lc: doc.display_title().to_lowercase(),
                entity_lc: doc.entity.clone().unwrap_or_default().to_lowercase(),
                content_lc: doc.text_content().to_lowercase(),
                origin,
                doc,
            })
            .collect();
        Self { docs }
    }

    /// Load the embedded lore and guide, the corpus path and the runtime store.
    #[must_use]
    pub fn load_with(env: EnvLookup<'_>) -> Self {
        let mut docs = vec![
            (
                embedded(
                    "embedded-lore",
                    "Référence Canon Dragon Ball (Lore)",
                    "/wiki/lore",
                    LORE,
                    "canon",
                ),
                "shenron-corpus".to_owned(),
            ),
            (
                embedded(
                    "embedded-guide",
                    "Guide d'exploration Dragon Ball",
                    "/wiki/guide",
                    GUIDE,
                    "guide",
                ),
                "shenron-corpus".to_owned(),
            ),
        ];
        let corpus = corpus_path_with(env);
        if corpus.exists()
            && let Ok(loaded) = load_shenron_corpus(&corpus)
        {
            docs.extend(loaded.into_iter().map(|d| (d, "shenron-corpus".to_owned())));
        }
        docs.extend(
            load_store(&rag_store_with(env))
                .into_iter()
                .map(|d| (d, "aphrody-rag-dragonball".to_owned())),
        );
        Self::from_docs(docs)
    }

    /// Number of indexed documents.
    #[must_use]
    pub fn len(&self) -> usize {
        self.docs.len()
    }

    /// Whether the index is empty.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.docs.is_empty()
    }

    /// Score every document against the query terms and return the best hits.
    #[must_use]
    pub fn search(&self, query: &str, opts: &LocalSearchOptions) -> Vec<LocalHit> {
        let limit = opts.limit.unwrap_or(8).max(1);
        let terms: Vec<String> = query
            .to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
            .collect::<String>()
            .split_whitespace()
            .filter(|t| t.chars().count() >= 2)
            .map(str::to_owned)
            .collect();
        if terms.is_empty() {
            return Vec::new();
        }
        let lang = opts.lang.as_deref().map(str::to_lowercase);
        let kind = opts.kind.as_deref().map(str::to_lowercase);
        let entity = opts.entity.as_deref().map(str::to_lowercase);

        let mut scored: Vec<(&IndexedDoc, u32)> = self
            .docs
            .iter()
            .filter(|d| match (&lang, &d.doc.lang) {
                (Some(want), Some(have)) => have.to_lowercase() == *want,
                _ => true,
            })
            .filter(|d| match (&kind, &d.doc.kind) {
                (Some(want), Some(have)) => have.to_lowercase() == *want,
                _ => true,
            })
            .filter(|d| match (&entity, &d.doc.entity) {
                (Some(want), Some(_)) => d.entity_lc.contains(want.as_str()),
                _ => true,
            })
            .filter_map(|d| {
                let score: u32 = terms
                    .iter()
                    .map(|term| {
                        let mut s = 0u32;
                        if d.title_lc.contains(term.as_str()) {
                            s += 5;
                        }
                        if d.entity_lc.contains(term.as_str()) {
                            s += 4;
                        }
                        s + u32::try_from(d.content_lc.matches(term.as_str()).count().min(10))
                            .unwrap_or(10)
                    })
                    .sum();
                (score > 0).then_some((d, score))
            })
            .collect();
        scored.sort_by_key(|item| std::cmp::Reverse(item.1));
        scored
            .into_iter()
            .take(limit)
            .enumerate()
            .map(|(idx, (d, score))| hit(d, idx, score))
            .collect()
    }

    /// Search and return the result envelope (`q`, `mode`, `total`, `results`).
    #[must_use]
    pub fn search_json(&self, query: &str, opts: &LocalSearchOptions) -> Value {
        let hits = self.search(query, opts);
        json!({ "q": query, "mode": "aphrody_local_naive", "total": hits.len(), "results": hits })
    }

    /// Numbered `[n]` context blocks within a character budget (default 6000).
    #[must_use]
    pub fn context_json(
        &self,
        query: &str,
        opts: &LocalSearchOptions,
        max_chars: Option<usize>,
    ) -> Value {
        let max_chars = max_chars.unwrap_or(6_000);
        let hits = self.search(query, opts);
        let mut assembled = String::new();
        let mut count = 0usize;
        for (i, h) in hits.iter().enumerate() {
            let block = format!(
                "[{}] {}\nSource: {}\nType: {} | Lang: {}\n{}\n\n",
                i + 1,
                h.title,
                h.url,
                h.kind,
                h.lang,
                h.snippet
            );
            if !assembled.is_empty()
                && assembled.chars().count() + block.chars().count() > max_chars
            {
                break;
            }
            assembled.push_str(&block);
            count += 1;
        }
        if assembled.is_empty() {
            assembled = format!("Aucun passage local trouvé pour la requête : \"{query}\".");
        }
        json!({ "q": query, "context": assembled.trim(), "totalHits": count, "mode": "aphrody_local_naive" })
    }

    /// Answer a question from the top five passages with the local chat model,
    /// in the active persona's voice. Without a reachable model the answer is a
    /// direct synthesis of the passages and `mode` says so.
    pub async fn ask_json(&self, question: &str, env: EnvLookup<'_>) -> Value {
        let hits =
            self.search(question, &LocalSearchOptions { limit: Some(5), ..Default::default() });
        let persona = active_persona_with(env);
        let passages = hits
            .iter()
            .enumerate()
            .map(|(i, h)| format!("[{}] ({} - {}) :\n{}", i + 1, h.title, h.url, h.snippet))
            .collect::<Vec<_>>()
            .join("\n\n");
        let prompt = format!(
            "Passages documentaires de la base de connaissances :\n\n{passages}\n\nQuestion : \
             {question}\n\nRédige ta réponse fondée sur ces passages :"
        );
        if let Some(chat) = resolve_chat_with(env)
            && let Some(answer) = chat_completion(&chat, &persona.system_prompt, &prompt).await
        {
            return json!({ "question": question, "answer": answer, "mode": "aphrody_local_naive_llm", "model": chat.model, "hits": hits });
        }
        let lines = hits
            .iter()
            .take(3)
            .enumerate()
            .map(|(i, h)| format!("• [{}] {} : {}", i + 1, h.title, h.snippet))
            .collect::<Vec<_>>()
            .join("\n\n");
        let answer = format!(
            "D'après les archives de la base de connaissances Dragon Ball (synthèse directe - \
             persona {}) :\n\n{lines}\n\n(Synthèse directe des passages extraits ; modèle local \
             APHRODY_AI_CHAT_BASE_URL indisponible).",
            persona.name
        );
        json!({ "question": question, "answer": answer, "mode": "aphrody_local_naive", "hits": hits })
    }
}

fn embedded(id: &str, name: &str, url: &str, text: &str, kind: &str) -> ShenronCorpusDoc {
    ShenronCorpusDoc {
        id: id.into(),
        name: Some(name.into()),
        url: url.into(),
        markdown: Some(text.into()),
        lang: Some("fr".into()),
        entity: None,
        kind: Some(kind.into()),
    }
}

fn hit(d: &IndexedDoc, idx: usize, score: u32) -> LocalHit {
    let text = d.doc.text_content();
    let snippet = if text.chars().count() > 280 {
        format!("{}...", text.chars().take(280).collect::<String>())
    } else {
        text.to_owned()
    };
    let url = if d.doc.url.is_empty() {
        format!("/wiki/databooks/{}", d.doc.id)
    } else {
        d.doc.url.clone()
    };
    LocalHit {
        rowid: if d.doc.id.is_empty() { (idx + 1).to_string() } else { d.doc.id.clone() },
        kind: d.doc.kind.clone().unwrap_or_else(|| "databook".into()),
        title: d
            .doc
            .name
            .clone()
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| format!("Passage #{}", idx + 1)),
        url: absolutize(&url),
        snippet,
        score: (f64::from(score) / 20.0).min(1.0),
        lang: d.doc.lang.clone().unwrap_or_else(|| "fr".into()),
        origin_source_id: d.origin.clone(),
        entity: d.doc.entity.clone(),
    }
}

/// Prefix a site-relative URL with [`SITE_BASE`]; absolute URLs pass through.
#[must_use]
pub fn absolutize(url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        url.to_owned()
    } else if url.starts_with('/') {
        format!("{SITE_BASE}{url}")
    } else {
        format!("{SITE_BASE}/{url}")
    }
}

/// Read documents from an `aphrody-rag` SQLite store (docs + chunks), read-only.
fn load_store(path: &Path) -> Vec<ShenronCorpusDoc> {
    if !path.is_file() {
        return Vec::new();
    }
    let Ok(conn) =
        rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
    else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT d.id, d.path, d.title, d.language, group_concat(c.content, char(10))
           FROM docs d JOIN chunks c ON c.doc_id = d.id GROUP BY d.id ORDER BY d.id",
    ) else {
        return Vec::new();
    };
    stmt.query_map([], |row| {
        let path: String = row.get(1)?;
        Ok(ShenronCorpusDoc {
            id: row.get::<_, i64>(0)?.to_string(),
            name: Some(row.get::<_, Option<String>>(2)?.unwrap_or_else(|| path.clone())),
            url: path,
            markdown: row.get(4)?,
            lang: row.get(3)?,
            entity: None,
            kind: Some("corpus".into()),
        })
    })
    .map(|rows| rows.filter_map(Result::ok).collect())
    .unwrap_or_default()
}

async fn chat_completion(chat: &ChatEndpoint, system: &str, prompt: &str) -> Option<String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(60)).build().ok()?;
    let body = json!({
        "model": chat.model.as_deref().unwrap_or("default"),
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": prompt }
        ],
        "max_tokens": 1024,
        "temperature": 0.3
    });
    let response = client.post(&chat.url).json(&body).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let data: Value = response.json().await.ok()?;
    data.pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn env_of(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> + use<> {
        let map: HashMap<String, String> =
            pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        move |name| map.get(name).cloned()
    }

    #[test]
    fn paths_follow_overrides() {
        let env = env_of(&[("APHRODY_HOME", "/h")]);
        assert_eq!(rag_store_with(&env), PathBuf::from("/h/workspaces/dbfr/crawl/rag.sqlite"));
        let env = env_of(&[("APHRODY_HOME", "/h"), ("APHRODY_CORPUS_CRAWL_DIR", "/c")]);
        assert_eq!(rag_store_with(&env), PathBuf::from("/c/rag.sqlite"));
        let env = env_of(&[("APHRODY_DRAGONBALL_RAG_DB", "/db.sqlite")]);
        assert_eq!(rag_store_with(&env), PathBuf::from("/db.sqlite"));
        let env = env_of(&[("APHRODY_DRAGONBALL_DATASET_DIR", "/d")]);
        assert_eq!(corpus_path_with(&env), PathBuf::from("/d/corpus"));
        let env = env_of(&[("APHRODY_DRAGONBALL_CORPUS", "/x.jsonl")]);
        assert_eq!(corpus_path_with(&env), PathBuf::from("/x.jsonl"));
    }

    #[test]
    fn chat_is_unavailable_without_env() {
        assert_eq!(resolve_chat_with(&env_of(&[])), None);
    }

    #[test]
    fn chat_resolves_canonical_and_origin_alias() {
        let env = env_of(&[
            ("APHRODY_AI_CHAT_BASE_URL", "http://h:1/v1/"),
            ("APHRODY_AI_CHAT_MODEL", "m"),
        ]);
        let chat = resolve_chat_with(&env).expect("chat");
        assert_eq!(chat.url, "http://h:1/v1/chat/completions");
        assert_eq!(chat.model.as_deref(), Some("m"));
        assert_eq!(chat.source, "APHRODY_AI_CHAT_BASE_URL");

        let env = env_of(&[("APHRODY_LOCAL_MODEL_URL", "http://h:2")]);
        let chat = resolve_chat_with(&env).expect("chat");
        assert_eq!(chat.base_url, "http://h:2/v1");
        assert_eq!(chat.model, None);
    }

    #[test]
    fn chat_honours_contract_forms_and_default_model() {
        let dir = tempfile::tempdir().expect("tempdir");
        let contract = dir.path().join("local-ai.json");
        std::fs::write(
            &contract,
            r#"{"capabilities":{"chat":{"defaultModel":"qwen","env":[{"canonical":"APHRODY_AI_CHAT_BASE_URL","kind":"url","form":"endpoint"}]}}}"#,
        )
        .expect("write");
        let path = contract.to_string_lossy().into_owned();
        let env = env_of(&[
            ("APHRODY_LOCAL_AI_CONFIG", path.as_str()),
            ("APHRODY_AI_CHAT_BASE_URL", "http://h:3/v1/chat/completions"),
        ]);
        let chat = resolve_chat_with(&env).expect("chat");
        assert_eq!(chat.base_url, "http://h:3/v1");
        assert_eq!(chat.model.as_deref(), Some("qwen"));
    }

    #[test]
    fn persona_defaults_to_toriyama_in_yolo_and_env_override_otherwise() {
        let p =
            active_persona_with(&env_of(&[("APHRODY_YOLO", "1"), ("SHENRON_BOT_PERSONA", "Whis")]));
        assert_eq!(p.id, "akira-toriyama");
        assert!(p.system_prompt.contains("Tori-bot"));
        let dir = tempfile::tempdir().expect("tempdir");
        let home = dir.path().to_string_lossy().into_owned();
        let p = active_persona_with(&env_of(&[
            ("APHRODY_HOME", home.as_str()),
            ("SHENRON_BOT_PERSONA", "Son Gohan"),
        ]));
        assert_eq!(p.name, "Son Gohan");
        assert_eq!(p.id, "son-gohan");
    }

    #[test]
    fn user_persona_round_trips() {
        let dir = tempfile::tempdir().expect("tempdir");
        let home = dir.path().to_string_lossy().into_owned();
        let env = env_of(&[("APHRODY_HOME", home.as_str())]);
        assert_eq!(active_persona_with(&env).id, "akira-toriyama");
        let saved = set_user_persona_with(&env, " Bulma ").expect("save");
        assert_eq!(saved.name, "Bulma");
        assert_eq!(active_persona_with(&env), saved);
    }

    #[test]
    fn embedded_corpus_answers_and_context_respects_budget() {
        let dir = tempfile::tempdir().expect("tempdir");
        let empty = dir.path().to_string_lossy().into_owned();
        let env = env_of(&[
            ("APHRODY_HOME", empty.as_str()),
            ("APHRODY_DRAGONBALL_DATASET_DIR", empty.as_str()),
        ]);
        let corpus = LocalCorpus::load_with(&env);
        assert_eq!(corpus.len(), 2);
        let hits = corpus.search("Goku", &LocalSearchOptions::default());
        assert!(!hits.is_empty());
        assert!(hits[0].url.starts_with("https://dragonballfr.com/"));
        assert!(hits[0].score > 0.0 && hits[0].score <= 1.0);
        let ctx = corpus.context_json("Saiyan Goku", &LocalSearchOptions::default(), Some(1_500));
        assert!(ctx["context"].as_str().expect("context").chars().count() <= 1_500);
        assert!(corpus.search("!", &LocalSearchOptions::default()).is_empty());
    }

    #[test]
    fn filters_and_store_are_applied() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db = dir.path().join("rag.sqlite");
        {
            let conn = rusqlite::Connection::open(&db).expect("open");
            conn.execute_batch(
                "CREATE TABLE docs (id INTEGER PRIMARY KEY, path TEXT, title TEXT, language TEXT);
                 CREATE TABLE chunks (id INTEGER PRIMARY KEY, doc_id INTEGER, content TEXT);
                 INSERT INTO docs VALUES (1, 'https://example.org/vegeta', 'Vegeta', 'en');
                 INSERT INTO chunks VALUES (1, 1, 'Vegeta is the prince of Saiyans.');",
            )
            .expect("seed");
        }
        let db_path = db.to_string_lossy().into_owned();
        let empty = dir.path().join("none").to_string_lossy().into_owned();
        let env = env_of(&[
            ("APHRODY_DRAGONBALL_RAG_DB", db_path.as_str()),
            ("APHRODY_DRAGONBALL_DATASET_DIR", empty.as_str()),
        ]);
        let corpus = LocalCorpus::load_with(&env);
        let hits = corpus.search(
            "vegeta prince",
            &LocalSearchOptions { lang: Some("en".into()), ..Default::default() },
        );
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].origin_source_id, "aphrody-rag-dragonball");
        assert_eq!(hits[0].url, "https://example.org/vegeta");
    }

    #[tokio::test]
    async fn ask_falls_back_to_direct_synthesis_without_model() {
        let dir = tempfile::tempdir().expect("tempdir");
        let empty = dir.path().to_string_lossy().into_owned();
        let env = env_of(&[
            ("APHRODY_HOME", empty.as_str()),
            ("APHRODY_DRAGONBALL_DATASET_DIR", empty.as_str()),
        ]);
        let corpus = LocalCorpus::load_with(&env);
        let out = corpus.ask_json("Qui est Son Goku ?", &env).await;
        assert_eq!(out["mode"], "aphrody_local_naive");
        assert!(out["answer"].as_str().expect("answer").contains("Akira Toriyama"));
    }
}
