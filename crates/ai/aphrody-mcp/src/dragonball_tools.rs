// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! `dragonball.*` — the Dragon Ball tools of the single Aphrody MCP.
//!
//! Ported from the retired Bun server `apps/shenron-mcp` (30 public tools and
//! the five editorial admin tools). Transport only: the local RAG, persona and
//! `APHRODY_AI_*` chat resolution live in [`aphrody_rag::dragonball`]; wiki,
//! bot, databook, manga, canon and A2A data stay behind the Shenron bot and
//! site APIs.
//!
//! # Backends
//!
//! | Variable | Default | Used by |
//! | --- | --- | --- |
//! | `SHENRON_API_URL` | `https://bot.dragonballfr.com` | `rag_*`, `sources`, `data_coverage`, `wiki_*`, `manga_search/tomes/page`, `bot_*`, `news`, `admin_bot_*`, `admin_service*` |
//! | `SHENRON_SITE_API_URL` | `SHENRON_SITE_URL` | `manga_chapitre/planche/recherche`, `chronologie`, `databooks_*`, `canon_*`, `a2a_*`, `admin_databooks_deposit` |
//! | `SHENRON_SITE_URL` | `https://dragonballfr.com` | absolute links in results |
//!
//! `SHENRON_LOCAL_RAG=1` (or `local: true`) serves `rag_*` from the local
//! corpus; `APHRODY_AUTO_FALLBACK=1` falls back to it when the bot API fails.
//! Admin tools need `SHENRON_API_ADMIN_TOKEN` (bot) or
//! `SHENRON_DATABOOKS_API_TOKEN` (site) and fail closed without them.

#![cfg(not(target_arch = "wasm32"))]

use std::{
    collections::HashMap,
    sync::{
        OnceLock,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use aphrody_rag::dragonball::{
    LocalCorpus, LocalSearchOptions, active_persona_with, process_env, set_user_persona_with,
};
use rmcp::{
    model::{CallToolResult, ContentBlock},
    schemars::{self, JsonSchema},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

const MAX_RESULT_CHARS: usize = 90_000;

/// Wiki categories accepted by `wiki_list`, `wiki_get` and `wiki_search`
/// (mirror of the bot contract `GET /api/public/wiki/categories`).
pub(crate) const WIKI_CATEGORIES: [&str; 21] = [
    "characters",
    "planets",
    "races",
    "techniques",
    "transformations",
    "sagas",
    "arcs",
    "episodes",
    "movies",
    "games",
    "tools",
    "battles",
    "items",
    "dragons",
    "wishes",
    "locations",
    "tournaments",
    "voice_actors",
    "soundtracks",
    "power_levels",
    "timeline_events",
];

const A2A_TARGETS: [&str; 9] = [
    "codex",
    "agycli",
    "claude",
    "local_model",
    "rag",
    "subagents",
    "ocr",
    "translation",
    "broadcast",
];

// ---------------------------------------------------------------------------
// Endpoints and HTTP
// ---------------------------------------------------------------------------

fn url_env(name: &str, fallback: &str) -> String {
    process_env(name).unwrap_or_else(|| fallback.to_owned()).trim_end_matches('/').to_owned()
}

fn site_base() -> String {
    url_env("SHENRON_SITE_URL", "https://dragonballfr.com")
}

fn api_base() -> String {
    url_env("SHENRON_API_URL", "https://bot.dragonballfr.com")
}

fn site_api_base() -> String {
    url_env("SHENRON_SITE_API_URL", &site_base())
}

fn client() -> Result<reqwest::Client, String> {
    static CLIENT: OnceLock<Result<reqwest::Client, String>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .user_agent(concat!("aphrody-mcp/", env!("CARGO_PKG_VERSION")))
                .build()
                .map_err(|e| format!("HTTP client: {e}"))
        })
        .clone()
}

type Query<'a> = Vec<(&'a str, Option<String>)>;

fn enc(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            },
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn build_url(base: &str, path: &str, query: &Query<'_>) -> String {
    let mut url = format!("{base}{path}");
    let mut sep = if path.contains('?') { '&' } else { '?' };
    for (key, value) in query {
        if let Some(value) = value.as_deref().filter(|v| !v.is_empty()) {
            url.push(sep);
            url.push_str(key);
            url.push('=');
            url.push_str(&enc(value));
            sep = '&';
        }
    }
    url
}

async fn call(
    method: reqwest::Method,
    base: &str,
    path: &str,
    query: &Query<'_>,
    body: Option<&Value>,
    bearer: Option<&str>,
    timeout: Duration,
) -> Result<Value, String> {
    let url = build_url(base, path, query);
    let mut request =
        client()?.request(method, &url).header("accept", "application/json").timeout(timeout);
    if let Some(token) = bearer {
        request = request.bearer_auth(token);
    }
    if let Some(body) = body {
        request = request.json(body);
    }
    let response = request.send().await.map_err(|e| {
        let reason = if e.is_timeout() { "timeout" } else { "réseau" };
        format!("API injoignable ({reason}) sur {path}")
    })?;
    let status = response.status();
    let text = response.text().await.map_err(|e| format!("lecture de {path}: {e}"))?;
    if !status.is_success() {
        let snippet: String = text
            .chars()
            .take(200)
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let suffix = if snippet.is_empty() { String::new() } else { format!(" — {snippet}") };
        return Err(format!("API {} sur {path}{suffix}", status.as_u16()));
    }
    if text.is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|_| format!("Réponse non-JSON de {path}"))
}

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(20);

async fn api_get(path: &str, query: Query<'_>) -> Result<Value, String> {
    call(reqwest::Method::GET, &api_base(), path, &query, None, None, DEFAULT_TIMEOUT).await
}

async fn site_get(path: &str, query: Query<'_>) -> Result<Value, String> {
    call(reqwest::Method::GET, &site_api_base(), path, &query, None, None, DEFAULT_TIMEOUT).await
}

fn admin_token(name: &str, label: &str) -> Result<String, String> {
    process_env(name).ok_or_else(|| format!("Jeton {label} upstream non configuré (${name})"))
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/// Prefix site-relative `url`/`href` string values with the site origin.
pub(crate) fn absolutize(value: Value, site: &str) -> Value {
    match value {
        Value::Array(items) => {
            Value::Array(items.into_iter().map(|v| absolutize(v, site)).collect())
        },
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(k, v)| {
                    let v = match v {
                        Value::String(s) if (k == "url" || k == "href") && s.starts_with('/') => {
                            Value::String(format!("{site}{s}"))
                        },
                        other => absolutize(other, site),
                    };
                    (k, v)
                })
                .collect(),
        ),
        other => other,
    }
}

fn ok(data: Value) -> CallToolResult {
    let mut text = serde_json::to_string_pretty(&absolutize(data, &site_base()))
        .unwrap_or_else(|_| "null".into());
    if text.chars().count() > MAX_RESULT_CHARS {
        text = format!(
            "{}\n\n… [résultat tronqué à {MAX_RESULT_CHARS} caractères — affinez la requête ou réduisez 'limit']",
            text.chars().take(MAX_RESULT_CHARS).collect::<String>()
        );
    }
    CallToolResult::success(vec![ContentBlock::text(text)])
}

fn err(message: impl std::fmt::Display) -> CallToolResult {
    CallToolResult::error(vec![ContentBlock::text(format!("Erreur : {message}"))])
}

fn done(result: Result<Value, String>) -> CallToolResult {
    match result {
        Ok(value) => ok(value),
        Err(message) => err(message),
    }
}

fn s<T: ToString>(value: Option<T>) -> Option<String> {
    value.map(|v| v.to_string())
}

// ---------------------------------------------------------------------------
// Local RAG
// ---------------------------------------------------------------------------

fn local_corpus() -> &'static LocalCorpus {
    static CORPUS: OnceLock<LocalCorpus> = OnceLock::new();
    CORPUS.get_or_init(|| LocalCorpus::load_with(&process_env))
}

fn local_forced(local: Option<bool>) -> bool {
    local == Some(true) || process_env("SHENRON_LOCAL_RAG").as_deref() == Some("1")
}

fn auto_fallback() -> bool {
    process_env("APHRODY_AUTO_FALLBACK").as_deref() == Some("1")
}

fn local_opts(
    limit: Option<u32>,
    lang: Option<String>,
    entity: Option<String>,
    kind: Option<String>,
) -> LocalSearchOptions {
    LocalSearchOptions { limit: limit.map(|l| l as usize), lang, entity, kind }
}

/// Input of `dragonball.rag_search`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RagSearchRequest {
    #[schemars(description = "Question ou mots-clés en langage naturel (au moins 2 caractères)")]
    pub query: String,
    #[schemars(description = "Nombre de passages à renvoyer (défaut 8, max 25)")]
    #[serde(default)]
    pub limit: Option<u32>,
    #[schemars(description = "Filtrer par langue des documents (ex. 'fr', 'en')")]
    #[serde(default)]
    pub lang: Option<String>,
    #[schemars(description = "Filtrer par entité/personnage indexé (ex. 'Son Goku', 'Vegeta')")]
    #[serde(default)]
    pub entity: Option<String>,
    #[schemars(description = "Filtrer par corpus : db_characters, db_wiki_sections, db_battles, \
                              canon_references, wiki_pages, manga, databooks…")]
    #[serde(default)]
    pub source_id: Option<String>,
    #[schemars(description = "Filtrer par type de passage : character, technique, saga, \
                              manga_page, battle, canon, article, databook…")]
    #[serde(default)]
    pub kind: Option<String>,
    #[schemars(description = "Forcer la recherche via le corpus local d'Aphrody")]
    #[serde(default)]
    pub local: Option<bool>,
}

pub(crate) async fn rag_search(r: RagSearchRequest) -> CallToolResult {
    if r.query.trim().chars().count() < 2 {
        return err("query doit contenir au moins 2 caractères");
    }
    let limit = r.limit.map(|l| l.clamp(1, 25));
    let local = || {
        ok(local_corpus().search_json(
            &r.query,
            &local_opts(limit, r.lang.clone(), r.entity.clone(), r.kind.clone()),
        ))
    };
    if local_forced(r.local) {
        return local();
    }
    let query = vec![
        ("q", Some(r.query.clone())),
        ("limit", s(limit)),
        ("lang", r.lang.clone()),
        ("entity", r.entity.clone()),
        ("sourceId", r.source_id.clone()),
        ("kind", r.kind.clone()),
    ];
    match api_get("/api/public/rag/search", query).await {
        Ok(v) => ok(v),
        Err(_) if auto_fallback() => local(),
        Err(e) => err(e),
    }
}

/// Input of `dragonball.rag_context`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RagContextRequest {
    #[schemars(description = "Question en langage naturel (FR/EN/JP)")]
    pub query: String,
    #[schemars(description = "Nombre de passages (défaut 6, max 12)")]
    #[serde(default)]
    pub limit: Option<u32>,
    #[schemars(description = "Budget total de caractères (défaut 6000, 500 à 16000)")]
    #[serde(default)]
    pub max_chars: Option<u32>,
    #[schemars(description = "fr | en | ja")]
    #[serde(default)]
    pub lang: Option<String>,
    #[schemars(description = "Entité canonique (ex. 'Vegeta')")]
    #[serde(default)]
    pub entity: Option<String>,
    #[schemars(description = "Corpus (ex. 'manga', 'canon_references')")]
    #[serde(default)]
    pub source_id: Option<String>,
    #[schemars(description = "Type de passage (ex. 'canon', 'battle')")]
    #[serde(default)]
    pub kind: Option<String>,
    #[schemars(description = "Forcer le contexte via le corpus local d'Aphrody")]
    #[serde(default)]
    pub local: Option<bool>,
}

pub(crate) async fn rag_context(r: RagContextRequest) -> CallToolResult {
    if r.query.trim().chars().count() < 2 {
        return err("query doit contenir au moins 2 caractères");
    }
    let limit = r.limit.map(|l| l.clamp(1, 12));
    let max_chars = r.max_chars.map(|m| m.clamp(500, 16_000));
    let local = || {
        ok(local_corpus().context_json(
            &r.query,
            &local_opts(limit, r.lang.clone(), r.entity.clone(), r.kind.clone()),
            max_chars.map(|m| m as usize),
        ))
    };
    if local_forced(r.local) {
        return local();
    }
    let query = vec![
        ("q", Some(r.query.clone())),
        ("limit", s(limit)),
        ("maxChars", s(max_chars)),
        ("lang", r.lang.clone()),
        ("entity", r.entity.clone()),
        ("sourceId", r.source_id.clone()),
        ("kind", r.kind.clone()),
    ];
    match api_get("/api/public/rag/context", query).await {
        Ok(v) => ok(v),
        Err(_) if auto_fallback() => local(),
        Err(e) => err(e),
    }
}

/// Input of `dragonball.rag_ask`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct RagAskRequest {
    #[schemars(description = "La question à poser, en langage naturel")]
    pub question: String,
    #[schemars(
        description = "Forcer l'inférence locale (contrat APHRODY_AI_*) et le corpus local"
    )]
    #[serde(default)]
    pub local: Option<bool>,
}

pub(crate) async fn rag_ask(r: RagAskRequest) -> CallToolResult {
    if r.question.trim().chars().count() < 2 {
        return err("question doit contenir au moins 2 caractères");
    }
    if local_forced(r.local) {
        return ok(local_corpus().ask_json(&r.question, &process_env).await);
    }
    // `q` goes in the query string (read by rag/chat) and in the body.
    let path = format!("/api/public/rag/chat?q={}", enc(&r.question));
    let body = json!({ "q": r.question });
    match call(
        reqwest::Method::POST,
        &api_base(),
        &path,
        &vec![],
        Some(&body),
        None,
        Duration::from_secs(90),
    )
    .await
    {
        Ok(v) => ok(v),
        Err(_) if auto_fallback() => ok(local_corpus().ask_json(&r.question, &process_env).await),
        Err(e) => err(e),
    }
}

pub(crate) async fn sources() -> CallToolResult {
    done(api_get("/api/public/sources", vec![]).await)
}

pub(crate) async fn data_coverage() -> CallToolResult {
    done(api_get("/api/public/data/coverage", vec![]).await)
}

// ---------------------------------------------------------------------------
// Wiki
// ---------------------------------------------------------------------------

fn check_category(category: &str) -> Result<(), String> {
    if WIKI_CATEGORIES.contains(&category) {
        Ok(())
    } else {
        Err(format!(
            "catégorie inconnue « {category} » ; attendues : {}",
            WIKI_CATEGORIES.join(", ")
        ))
    }
}

/// Input of `dragonball.wiki_search`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct WikiSearchRequest {
    #[schemars(description = "Termes recherchés")]
    pub query: String,
    #[schemars(description = "Catégories à interroger (omettre = toutes) : characters, planets, \
                              races, techniques, transformations, sagas, arcs, episodes, movies, \
                              games, tools, battles, items, dragons, wishes, locations, tournaments, \
                              voice_actors, soundtracks, power_levels, timeline_events")]
    #[serde(default)]
    pub categories: Option<Vec<String>>,
    #[schemars(description = "Nombre maximal de résultats (1 à 50)")]
    #[serde(default)]
    pub limit: Option<u32>,
}

pub(crate) async fn wiki_search(r: WikiSearchRequest) -> CallToolResult {
    let categories = r.categories.unwrap_or_default();
    if let Some(e) = categories.iter().find_map(|c| check_category(c).err()) {
        return err(e);
    }
    let query = vec![
        ("q", Some(r.query)),
        ("limit", s(r.limit.map(|l| l.clamp(1, 50)))),
        ("categories", (!categories.is_empty()).then(|| categories.join(","))),
    ];
    done(api_get("/api/public/wiki/search", query).await)
}

/// Input of `dragonball.wiki_list`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct WikiListRequest {
    #[schemars(description = "Catégorie d'entités à lister (voir wiki_categories)")]
    pub category: String,
    #[schemars(description = "Taille de page (défaut 50, max 200)")]
    #[serde(default)]
    pub limit: Option<u32>,
    #[schemars(description = "Décalage de pagination (défaut 0)")]
    #[serde(default)]
    pub offset: Option<u32>,
    #[schemars(description = "Filtre textuel sur la catégorie")]
    #[serde(default)]
    pub q: Option<String>,
}

pub(crate) async fn wiki_list(r: WikiListRequest) -> CallToolResult {
    if let Err(e) = check_category(&r.category) {
        return err(e);
    }
    let query =
        vec![("limit", s(r.limit.map(|l| l.clamp(1, 200)))), ("offset", s(r.offset)), ("q", r.q)];
    done(api_get(&format!("/api/public/wiki/{}", r.category), query).await)
}

/// Input of `dragonball.wiki_get`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct WikiGetRequest {
    #[schemars(description = "Catégorie de l'entité (voir wiki_categories)")]
    pub category: String,
    #[schemars(description = "Identifiant numérique ou slug de l'entité")]
    pub id: String,
}

/// Slug used to match a wiki name against a requested slug.
pub(crate) fn slugify(value: &str) -> String {
    let folded: String = value
        .chars()
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ä' | 'ã' | 'å' | 'ā' => 'a',
            'ç' => 'c',
            'è' | 'é' | 'ê' | 'ë' | 'ē' => 'e',
            'ì' | 'í' | 'î' | 'ï' | 'ī' => 'i',
            'ñ' => 'n',
            'ò' | 'ó' | 'ô' | 'ö' | 'õ' | 'ō' => 'o',
            'ù' | 'ú' | 'û' | 'ü' | 'ū' => 'u',
            'ÿ' | 'ý' => 'y',
            other => other,
        })
        .flat_map(char::to_lowercase)
        .collect();
    let mut out = String::new();
    for c in folded.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_owned()
}

/// Categories whose bot detail route only takes a numeric id.
const NUMERIC_ONLY_WIKI: [&str; 3] = ["characters", "planets", "episodes"];

async fn resolve_wiki_id(category: &str, id: &str) -> Result<String, String> {
    if !NUMERIC_ONLY_WIKI.contains(&category) || id.chars().all(|c| c.is_ascii_digit()) {
        return Ok(id.to_owned());
    }
    let wanted = slugify(id);
    let list =
        api_get(&format!("/api/public/wiki/{category}"), vec![("q", Some(id.to_owned()))]).await?;
    let found = list
        .get(category)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|row| {
            ["slug", "name", "nameRomaji", "title"]
                .iter()
                .any(|k| row.get(*k).and_then(Value::as_str).is_some_and(|v| slugify(v) == wanted))
        })
        .and_then(|row| row.get("id"))
        .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_owned));
    found.ok_or_else(|| {
        format!(
            "Aucune entrée {category} ne correspond au slug « {id} » ; passez l'identifiant \
             numérique (wiki_search ou wiki_list)"
        )
    })
}

pub(crate) async fn wiki_get(r: WikiGetRequest) -> CallToolResult {
    if let Err(e) = check_category(&r.category) {
        return err(e);
    }
    let resolved = match resolve_wiki_id(&r.category, &r.id).await {
        Ok(id) => id,
        Err(e) => return err(e),
    };
    done(api_get(&format!("/api/public/wiki/{}/{}", r.category, enc(&resolved)), vec![]).await)
}

pub(crate) async fn wiki_categories() -> CallToolResult {
    done(api_get("/api/public/wiki/categories", vec![]).await)
}

// ---------------------------------------------------------------------------
// Manga
// ---------------------------------------------------------------------------

/// A manga volume: a bare number `13` becomes `vol13`; anything else passes.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(untagged)]
pub(crate) enum Tome {
    Number(u32),
    Id(String),
}

/// OCR tome identifier (`13` → `vol13`, `ch1407` unchanged).
pub(crate) fn manga_tome_id(tome: &Tome) -> String {
    let raw = match tome {
        Tome::Number(n) => n.to_string(),
        Tome::Id(s) => s.trim().to_owned(),
    };
    match raw.parse::<u64>() {
        Ok(n) => format!("vol{n}"),
        Err(_) => raw,
    }
}

/// Input of `dragonball.manga_search`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct QueryLimitRequest {
    #[schemars(description = "Texte recherché")]
    pub query: String,
    #[schemars(description = "Nombre de résultats (défaut 20)")]
    #[serde(default)]
    pub limit: Option<u32>,
}

pub(crate) async fn manga_search(r: QueryLimitRequest) -> CallToolResult {
    done(
        api_get(
            "/api/public/manga/search",
            vec![("q", Some(r.query)), ("limit", s(r.limit.map(|l| l.clamp(1, 50))))],
        )
        .await,
    )
}

/// Input of `dragonball.manga_tomes`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct MangaTomesRequest {
    #[schemars(
        description = "Code de série OCR (ex. 'DB'), tel que renvoyé par manga_tomes ; omettre pour tout lister"
    )]
    #[serde(default)]
    pub series: Option<String>,
    #[schemars(
        description = "Tome : numéro (13 → vol13) ou identifiant OCR (vol13, ch1407, t901)"
    )]
    #[serde(default)]
    pub tome: Option<Tome>,
}

pub(crate) async fn manga_tomes(r: MangaTomesRequest) -> CallToolResult {
    let path = match (r.series, r.tome) {
        (Some(series), Some(tome)) => {
            format!("/api/public/manga/tomes/{}/{}", enc(&series), enc(&manga_tome_id(&tome)))
        },
        _ => "/api/public/manga/tomes".to_owned(),
    };
    done(api_get(&path, vec![]).await)
}

/// Input of `dragonball.manga_page`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct MangaPageRequest {
    #[schemars(description = "Code de série OCR (ex. 'DB'), tel que renvoyé par manga_tomes")]
    pub series: String,
    #[schemars(
        description = "Tome : numéro (13 → vol13) ou identifiant OCR (vol13, ch1407, t901)"
    )]
    pub tome: Tome,
    #[schemars(description = "Numéro de planche")]
    pub planche: u32,
}

pub(crate) async fn manga_page(r: MangaPageRequest) -> CallToolResult {
    let path = format!(
        "/api/public/manga/page/{}/{}/{}",
        enc(&r.series),
        enc(&manga_tome_id(&r.tome)),
        r.planche
    );
    done(api_get(&path, vec![]).await)
}

/// Input of `dragonball.manga_chapitre`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MangaChapitreRequest {
    #[schemars(description = "Identifiant du chapitre sur le site")]
    pub chapter_id: u32,
    #[schemars(description = "Ne rendre que les transcriptions (défaut : vrai)")]
    #[serde(default)]
    pub texte_seul: Option<bool>,
}

pub(crate) async fn manga_chapitre(r: MangaChapitreRequest) -> CallToolResult {
    let chapter = match site_get(&format!("/api/manga/chapter/{}", r.chapter_id), vec![]).await {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    if r.texte_seul == Some(false) {
        return ok(chapter);
    }
    let mut chapter = chapter;
    if let Some(obj) = chapter.as_object_mut() {
        let planches: Vec<Value> = obj
            .get("planches")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|p| json!({ "index": p.get("index"), "planche": p.get("planche"), "text": p.get("text"), "api": p.get("api") }))
            .collect();
        obj.insert("planches".into(), Value::Array(planches));
    }
    ok(chapter)
}

/// Input of `dragonball.manga_planche`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MangaPlancheRequest {
    #[schemars(description = "Identifiant du chapitre sur le site")]
    pub chapter_id: u32,
    #[schemars(description = "Rang de la planche dans le chapitre (1 = première)")]
    pub planche: u32,
}

pub(crate) async fn manga_planche(r: MangaPlancheRequest) -> CallToolResult {
    done(
        site_get(&format!("/api/manga/chapter/{}/planche/{}", r.chapter_id, r.planche), vec![])
            .await,
    )
}

pub(crate) async fn manga_recherche(r: QueryLimitRequest) -> CallToolResult {
    done(
        site_get(
            "/api/manga/search",
            vec![("q", Some(r.query)), ("limit", s(r.limit.map(|l| l.clamp(1, 100))))],
        )
        .await,
    )
}

/// Input of `dragonball.manga_scanlate`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MangaScanlateRequest {
    #[schemars(description = "Identifiant du chapitre")]
    pub chapter_id: u32,
    #[schemars(description = "Rang de la planche dans le chapitre (1 = première)")]
    pub planche: u32,
    #[schemars(description = "Langue cible pour la scanlation (défaut : 'fr')")]
    #[serde(default)]
    pub target_lang: Option<String>,
}

pub(crate) async fn manga_scanlate(r: MangaScanlateRequest) -> CallToolResult {
    let client = aphrody_manga::MangaCdnClient::new();
    let mut options = aphrody_manga::MangaPipelineOptions::default();
    if let Some(target) = r.target_lang {
        options.target_language = target;
    }
    match client.scanlate_manga_plate(r.chapter_id as u64, r.planche, &options).await {
        Ok((res, psd_bytes, record)) => ok(json!({
            "status": "success",
            "chapterId": r.chapter_id,
            "planche": r.planche,
            "cdnUrl": record.cdn_url,
            "existingText": record.existing_text,
            "bubblesCount": res.bubbles.len(),
            "bubbles": res.bubbles,
            "psdSizeBytes": psd_bytes.len(),
            "dimensions": { "width": res.width, "height": res.height },
            "pageResult": res,
        })),
        Err(e) => err(format!("Manga scanlate failed: {e}")),
    }
}

/// Input of `dragonball.chronologie`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct ChronologieRequest {
    #[schemars(description = "Ère à isoler (DB, DBZ, GT, Super, Daima, Manga)")]
    #[serde(default)]
    pub era: Option<String>,
    #[schemars(description = "Nature d'entrée à isoler : episode, movie ou manga")]
    #[serde(default)]
    pub kind: Option<String>,
}

pub(crate) async fn chronologie(r: ChronologieRequest) -> CallToolResult {
    done(site_get("/api/chronologie", vec![("era", r.era), ("kind", r.kind)]).await)
}

// ---------------------------------------------------------------------------
// Bot
// ---------------------------------------------------------------------------

pub(crate) async fn bot_stats() -> CallToolResult {
    done(api_get("/api/public/stats", vec![]).await)
}

/// Input of `dragonball.bot_personas`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct BotPersonasRequest {
    #[schemars(
        description = "Définir le persona du bot unique (écrit <APHRODY_HOME>/persona.json)"
    )]
    #[serde(default)]
    pub set_persona: Option<String>,
}

pub(crate) async fn bot_personas(r: BotPersonasRequest) -> CallToolResult {
    if let Some(name) = r.set_persona.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        return match set_user_persona_with(&process_env, name) {
            Ok(updated) => ok(json!({
                "bot": "shenron-bot",
                "single_bot": true,
                "message": format!("Persona configuré avec succès : {}", updated.name),
                "updated_persona": updated,
            })),
            Err(e) => err(format!("écriture du persona : {e}")),
        };
    }
    match api_get("/api/public/personas", vec![]).await {
        Ok(v) => ok(v),
        Err(_) => {
            let active = active_persona_with(&process_env);
            ok(json!({
                "bot": "shenron-bot",
                "single_bot": true,
                "active_persona": active,
                "personas": [active],
                "source": "local",
                "description": "Un seul bot unifié — persona Akira Toriyama par défaut en mode YOLO",
            }))
        },
    }
}

/// Input of `dragonball.bot_leaderboard` and `dragonball.news`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct LimitRequest {
    #[schemars(description = "Nombre d'entrées")]
    #[serde(default)]
    pub limit: Option<u32>,
}

pub(crate) async fn bot_leaderboard(r: LimitRequest) -> CallToolResult {
    done(
        api_get("/api/public/leaderboard", vec![("limit", s(r.limit.map(|l| l.clamp(1, 100))))])
            .await,
    )
}

pub(crate) async fn bot_commands() -> CallToolResult {
    done(api_get("/api/public/commands", vec![]).await)
}

pub(crate) async fn news(r: LimitRequest) -> CallToolResult {
    done(api_get("/api/public/news", vec![("limit", s(r.limit.map(|l| l.clamp(1, 50))))]).await)
}

// ---------------------------------------------------------------------------
// Databooks
// ---------------------------------------------------------------------------

/// Input of `dragonball.databooks_search`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct DatabooksSearchRequest {
    #[schemars(description = "Termes recherchés (titre, titre japonais, auteur, description)")]
    #[serde(default)]
    pub q: Option<String>,
    #[schemars(description = "Type d'ouvrage : databook, interview ou artbook")]
    #[serde(default)]
    pub kind: Option<String>,
    #[schemars(description = "Catégorie éditoriale (ex. « V-Jump », « Art Book »)")]
    #[serde(default)]
    pub category: Option<String>,
    #[schemars(description = "Nombre de fiches (défaut 20, max 100)")]
    #[serde(default)]
    pub limit: Option<u32>,
    #[schemars(description = "Décalage de pagination")]
    #[serde(default)]
    pub offset: Option<u32>,
}

pub(crate) async fn databooks_search(r: DatabooksSearchRequest) -> CallToolResult {
    let query = vec![
        ("q", r.q),
        ("kind", r.kind),
        ("category", r.category),
        ("limit", Some(r.limit.unwrap_or(20).clamp(1, 100).to_string())),
        ("offset", s(r.offset)),
    ];
    let response = match site_get("/api/databooks", query).await {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let items: Vec<Value> = response
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|item| {
            let mut item = item.as_object().cloned().unwrap_or_default();
            let pages = item.remove("pages");
            let count = pages.as_ref().and_then(Value::as_array).map_or(0, Vec::len);
            let id = item
                .get("id")
                .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_owned))
                .unwrap_or_default();
            item.insert("pageCount".into(), json!(count));
            item.insert("url".into(), json!(format!("/wiki/databooks/{id}")));
            Value::Object(item)
        })
        .collect();
    let total = response.get("total").cloned().unwrap_or_else(|| json!(items.len()));
    ok(json!({ "total": total, "items": items }))
}

const EXTRAIT_LARGEUR: usize = 320;

/// Window of text centred on the first occurrence of `term`.
pub(crate) fn extrait_autour(texte: &str, terme: &str) -> String {
    let chars: Vec<char> = texte.chars().collect();
    if chars.len() <= EXTRAIT_LARGEUR {
        return texte.to_owned();
    }
    let Some(byte_at) = texte.find(terme) else {
        return format!("{}…", chars[..EXTRAIT_LARGEUR].iter().collect::<String>());
    };
    let at = texte[..byte_at].chars().count();
    let term_len = terme.chars().count();
    let debut = at.saturating_sub(EXTRAIT_LARGEUR.saturating_sub(term_len) / 2);
    let fin = (debut + EXTRAIT_LARGEUR).min(chars.len());
    format!(
        "{}{}{}",
        if debut > 0 { "…" } else { "" },
        chars[debut..fin].iter().collect::<String>(),
        if fin < chars.len() { "…" } else { "" }
    )
}

/// Input of `dragonball.databooks_planches`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct DatabooksPlanchesRequest {
    #[schemars(description = "Expression cherchée dans le texte des planches")]
    pub q: String,
    #[schemars(description = "Restreindre la recherche à un seul ouvrage")]
    #[serde(default)]
    pub databook: Option<u32>,
    #[schemars(description = "Nombre de planches (défaut 10, max 50)")]
    #[serde(default)]
    pub limit: Option<u32>,
}

pub(crate) async fn databooks_planches(r: DatabooksPlanchesRequest) -> CallToolResult {
    let query = vec![
        ("q", Some(r.q.clone())),
        ("databook", s(r.databook)),
        ("limit", Some(r.limit.unwrap_or(10).clamp(1, 50).to_string())),
    ];
    let response = match site_get("/api/databooks/search", query).await {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let items: Vec<Value> = response
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|item| {
            let mut item: Map<String, Value> = item.as_object().cloned().unwrap_or_default();
            let texte = item.remove("texte");
            let id = item
                .get("databookId")
                .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_owned))
                .unwrap_or_default();
            item.insert("url".into(), json!(format!("/wiki/databooks/{id}")));
            item.insert(
                "extrait".into(),
                json!(extrait_autour(texte.as_ref().and_then(Value::as_str).unwrap_or(""), &r.q)),
            );
            Value::Object(item)
        })
        .collect();
    ok(json!({ "q": r.q, "total": items.len(), "items": items }))
}

/// Input of `dragonball.databooks_get`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabooksGetRequest {
    #[schemars(description = "Identifiant de la fiche")]
    pub id: u32,
    #[schemars(description = "Inclure les planches et leur transcription (défaut : oui)")]
    #[serde(default)]
    pub include_pages: Option<bool>,
    #[schemars(description = "Plafond de planches renvoyées (défaut 50, max 300)")]
    #[serde(default)]
    pub max_pages: Option<u32>,
}

pub(crate) async fn databooks_get(r: DatabooksGetRequest) -> CallToolResult {
    let fiche = match site_get(&format!("/api/databooks/{}", r.id), vec![]).await {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let mut fiche = fiche.as_object().cloned().unwrap_or_default();
    let pages = fiche.remove("pages").and_then(|p| p.as_array().cloned()).unwrap_or_default();
    let plafond = r.max_pages.unwrap_or(50).clamp(1, 300) as usize;
    let transcrites = pages
        .iter()
        .filter(|p| p.get("text").and_then(Value::as_str).is_some_and(|t| !t.is_empty()))
        .count();
    fiche.insert("url".into(), json!(format!("/wiki/databooks/{}", r.id)));
    fiche.insert("pageCount".into(), json!(pages.len()));
    fiche.insert("pagesTranscrites".into(), json!(transcrites));
    if r.include_pages != Some(false) {
        fiche.insert("pagesTronquees".into(), json!(pages.len() > plafond));
        fiche.insert("pages".into(), Value::Array(pages.into_iter().take(plafond).collect()));
    }
    ok(Value::Object(fiche))
}

/// Input of `dragonball.databooks_scanlate`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabooksScanlateRequest {
    #[schemars(description = "Identifiant du databook (ex: 312)")]
    pub databook_id: u64,
    #[schemars(description = "Numéro de planche ou page dans l'ouvrage")]
    pub page: u32,
    #[schemars(description = "Langue cible pour la scanlation (défaut : 'fr')")]
    #[serde(default)]
    pub target_lang: Option<String>,
}

pub(crate) async fn databooks_scanlate(r: DatabooksScanlateRequest) -> CallToolResult {
    let client = aphrody_manga::MangaCdnClient::new();
    let mut options = aphrody_manga::MangaPipelineOptions::default();
    if let Some(target) = r.target_lang {
        options.target_language = target;
    }
    match client.scanlate_databook_plate(r.databook_id, r.page, &options).await {
        Ok((res, psd_bytes, record)) => ok(json!({
            "status": "success",
            "databookId": r.databook_id,
            "page": r.page,
            "cdnUrl": record.cdn_url,
            "existingText": record.existing_text,
            "bubblesCount": res.bubbles.len(),
            "bubbles": res.bubbles,
            "psdSizeBytes": psd_bytes.len(),
            "dimensions": { "width": res.width, "height": res.height },
            "pageResult": res,
        })),
        Err(e) => err(format!("Databooks scanlate failed: {e}")),
    }
}

// ---------------------------------------------------------------------------
// Canon
// ---------------------------------------------------------------------------

/// Input of `dragonball.canon_check`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct CanonCheckRequest {
    #[schemars(
        description = "L'affirmation ou la question à arbitrer (vide = renvoyer la doctrine)"
    )]
    #[serde(default)]
    pub question: Option<String>,
}

pub(crate) async fn canon_check(r: CanonCheckRequest) -> CallToolResult {
    let q = r.question.map(|q| q.trim().to_owned()).filter(|q| !q.is_empty());
    done(site_get("/api/canon", vec![("q", q)]).await)
}

/// Input of `dragonball.canon_references`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct CanonReferencesRequest {
    #[schemars(description = "Mot ou nom à chercher (ex. 'Broly', 'Kaiōken')")]
    #[serde(default)]
    pub q: Option<String>,
    #[schemars(description = "Provenance : aphrody, databooks ou manuel")]
    #[serde(default)]
    pub provenance: Option<String>,
    #[schemars(description = "Nombre d'items (défaut 20, max 100)")]
    #[serde(default)]
    pub limit: Option<u32>,
    #[schemars(description = "Décalage de pagination")]
    #[serde(default)]
    pub offset: Option<u32>,
}

pub(crate) async fn canon_references(r: CanonReferencesRequest) -> CallToolResult {
    let query = vec![
        ("q", r.q),
        ("provenance", r.provenance),
        ("limit", s(r.limit)),
        ("offset", s(r.offset)),
    ];
    done(site_get("/api/canon/references", query).await)
}

// ---------------------------------------------------------------------------
// A2A (the task registry stays on the Shenron site, `/api/a2a`)
// ---------------------------------------------------------------------------

async fn a2a_rpc(method: &str, params: Value) -> Result<Value, String> {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    let body = json!({ "jsonrpc": "2.0", "id": NEXT_ID.fetch_add(1, Ordering::Relaxed), "method": method, "params": params });
    let url = format!("{}/api/a2a", site_api_base());
    let response = client()?
        .post(&url)
        .json(&body)
        .timeout(DEFAULT_TIMEOUT)
        .send()
        .await
        .map_err(|e| format!("Shenron A2A injoignable : {e}"))?;
    let status = response.status();
    if !status.is_success() && status.as_u16() != 400 {
        return Err(format!("Shenron A2A HTTP {}", status.as_u16()));
    }
    let reply: Value =
        response.json().await.map_err(|_| "Shenron A2A returned invalid JSON".to_owned())?;
    if let Some(error) = reply.get("error") {
        return Err(format!(
            "Shenron A2A {}: {}",
            error.get("code").cloned().unwrap_or(Value::Null),
            error.get("message").and_then(Value::as_str).unwrap_or("")
        ));
    }
    Ok(reply.get("result").cloned().unwrap_or(Value::Null))
}

async fn a2a_get_task(task_id: &str) -> Result<Option<Value>, String> {
    match a2a_rpc("tasks/get", json!({ "taskId": task_id })).await {
        Ok(task) => Ok(Some(task)),
        Err(e) if e.contains("-32004") => Ok(None),
        Err(e) => Err(e),
    }
}

/// Input of `dragonball.a2a_send`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct A2aSendRequest {
    #[schemars(
        description = "Destinataire : codex, agycli, claude, local_model, rag, subagents, \
                              ocr, translation ou broadcast (ignoré quand taskId est fourni)"
    )]
    pub target: String,
    #[schemars(description = "Ordre, consigne ou requête ; avec taskId : compte rendu du pair")]
    pub instruction: String,
    #[schemars(description = "Nom de l'agent émetteur (défaut : mcp-client)")]
    #[serde(default)]
    pub source_agent: Option<String>,
    #[schemars(description = "Payload de données structurées JSON")]
    #[serde(default)]
    pub data: Option<HashMap<String, Value>>,
    #[schemars(description = "Exécution autonome sans HITL (défaut true)")]
    #[serde(default)]
    pub yolo: Option<bool>,
    #[schemars(description = "Tâche existante à mettre à jour (réponse d'un pair)")]
    #[serde(default)]
    pub task_id: Option<String>,
    #[schemars(description = "Verdict du pair : FAIT (avec artefact), INCOMPLET ou NON_FAIT")]
    #[serde(default)]
    pub verdict: Option<String>,
    #[schemars(description = "Statut : working, input_required, completed ou failed")]
    #[serde(default)]
    pub status: Option<String>,
    #[schemars(
        description = "Artefacts vérifiables : [{name, type: json|markdown|code|file, uri?, content?, data?}]"
    )]
    #[serde(default)]
    pub artifacts: Option<Vec<Value>>,
}

pub(crate) async fn a2a_send(r: A2aSendRequest) -> CallToolResult {
    let source = r.source_agent.unwrap_or_else(|| "mcp-client".into());
    if let Some(task_id) = r.task_id {
        let params = json!({
            "taskId": task_id, "sourceAgent": source, "verdict": r.verdict, "status": r.status,
            "text": r.instruction, "data": r.data, "artifacts": r.artifacts,
        });
        if let Err(e) = a2a_rpc("tasks/update", params).await {
            return err(format!("-32603 {e}"));
        }
        return match a2a_get_task(&task_id).await {
            Ok(Some(task)) => ok(task),
            Ok(None) => err("-32004 Task missing after update"),
            Err(e) => err(e),
        };
    }
    if !A2A_TARGETS.contains(&r.target.as_str()) {
        return err(format!(
            "cible A2A inconnue « {} » ; attendues : {}",
            r.target,
            A2A_TARGETS.join(", ")
        ));
    }
    let params = json!({
        "target": r.target, "sourceAgent": source, "instruction": r.instruction,
        "data": r.data, "yolo": r.yolo.unwrap_or(true),
    });
    let result = match a2a_rpc("message/send", params).await {
        Ok(v) => v,
        Err(e) => return err(e),
    };
    let Some(task_id) = result.get("taskId").and_then(Value::as_str) else {
        return err("Shenron A2A: réponse sans taskId");
    };
    let task = match a2a_get_task(task_id).await {
        Ok(Some(task)) => task,
        Ok(None) => return err(format!("Shenron A2A task missing after send: {task_id}")),
        Err(e) => return err(e),
    };
    let parts =
        result.pointer("/response/parts").and_then(Value::as_array).cloned().unwrap_or_default();
    let part = |kind: &str| {
        parts.iter().find(|p| p.get("type").and_then(Value::as_str) == Some(kind)).cloned()
    };
    ok(json!({
        "task": task,
        "responseMarkdown": part("text").and_then(|p| p.get("text").cloned()).unwrap_or_else(|| json!("")),
        "responseData": part("data").and_then(|p| p.get("data").cloned()).unwrap_or_else(|| json!({})),
        "verdict": result.get("verdict"),
    }))
}

/// Input of `dragonball.a2a_task_status`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct A2aTaskStatusRequest {
    #[schemars(description = "Identifiant de la tâche A2A")]
    pub task_id: String,
}

pub(crate) async fn a2a_task_status(r: A2aTaskStatusRequest) -> CallToolResult {
    match a2a_get_task(&r.task_id).await {
        Ok(Some(task)) => ok(task),
        Ok(None) => err(format!("Tâche A2A introuvable : {}", r.task_id)),
        Err(e) => err(e),
    }
}

/// Input of `dragonball.a2a_task_list`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct A2aTaskListRequest {
    #[schemars(
        description = "Filtrer par cible (codex, agycli, claude, local_model, rag, subagents, ocr, translation, broadcast)"
    )]
    #[serde(default)]
    pub target: Option<String>,
}

pub(crate) async fn a2a_task_list(r: A2aTaskListRequest) -> CallToolResult {
    match a2a_rpc("tasks/list", json!({ "target": r.target })).await {
        Ok(result) => {
            let tasks = result.get("tasks").cloned().unwrap_or_else(|| json!([]));
            let total = tasks.as_array().map_or(0, Vec::len);
            ok(json!({ "total": total, "tasks": tasks }))
        },
        Err(e) => err(e),
    }
}

/// The A2A agent card of the Dragon Ball hub.
pub(crate) fn agent_card() -> Value {
    json!({
        "name": "shenron-dragonball",
        "description": "Hub A2A Dragon Ball : RAG sourcé réel, état mesuré OCR/traduction, et boîte d'ordres pour Codex, agycli, Claude, workers locaux et sous-agents (résultat seulement quand le pair le poste).",
        "version": env!("CARGO_PKG_VERSION"),
        "url": format!("{}/api/a2a", site_api_base()),
        "capabilities": { "streaming": false, "pushNotifications": false, "yoloMode": true },
        "supportedTargets": A2A_TARGETS,
        "skills": [
            { "id": "rag_query", "name": "RAG Canonique", "description": "Recherche hybride réelle sur l'index Shenron : passages, titres et URL absolues. FAIT seulement si au moins un passage revient." },
            { "id": "ocr_dispatch", "name": "État OCR & traduction", "description": "Statut mesuré (bot.db_databooks, systemd, results.db, heartbeat worker) ; un ordre OCR reste en attente jusqu'au résultat d'un worker." },
            { "id": "subagent_task", "name": "Délégation d'ordres", "description": "Dépôt d'un ordre dans la boîte .coord pour un agent ou des sous-agents ; tâche submitted/INCOMPLET jusqu'au résultat du pair." },
            { "id": "model_infer", "name": "Ordre pour worker local", "description": "Dépôt d'un ordre pour un modèle local ; aucun modèle ni état VRAM n'est affirmé sans résultat du worker." },
            { "id": "task_update", "name": "Clôture par un pair", "description": "tasks/update, message/send avec taskId, ou enveloppe .coord avec re : statut + verdict (FAIT exige au moins un artefact)." }
        ]
    })
}

// ---------------------------------------------------------------------------
// Admin (explicit surface, never a generic method/path proxy)
// ---------------------------------------------------------------------------

/// One validated transcription for `dragonball.admin_databooks_deposit`.
#[derive(Debug, Clone, Deserialize, serde::Serialize, JsonSchema)]
pub(crate) struct DepositPage {
    #[schemars(description = "Numéro de planche (≥ 1)")]
    pub number: u32,
    #[schemars(description = "Transcription vérifiée (1 à 40 000 caractères)")]
    pub text: String,
}

/// Input of `dragonball.admin_databooks_deposit`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminDepositRequest {
    #[schemars(description = "Identifiant du databook")]
    pub databook_id: u32,
    #[schemars(description = "Planches à fusionner (1 à 2000)")]
    pub pages: Vec<DepositPage>,
}

pub(crate) async fn admin_databooks_deposit(r: AdminDepositRequest) -> CallToolResult {
    if r.databook_id == 0 || r.pages.is_empty() || r.pages.len() > 2_000 {
        return err("databookId ≥ 1 et 1 à 2000 planches attendus");
    }
    if let Some(bad) = r
        .pages
        .iter()
        .find(|p| p.number == 0 || p.text.trim().is_empty() || p.text.chars().count() > 40_000)
    {
        return err(format!(
            "planche {} invalide : numéro ≥ 1 et texte non vide ≤ 40 000 caractères",
            bad.number
        ));
    }
    let token = match admin_token("SHENRON_DATABOOKS_API_TOKEN", "databooks") {
        Ok(t) => t,
        Err(e) => return err(e),
    };
    let body = json!({ "mode": "merge", "pages": r.pages });
    let path = format!("/api/databooks/{}/transcription", r.databook_id);
    done(
        call(
            reqwest::Method::POST,
            &site_api_base(),
            &path,
            &vec![],
            Some(&body),
            Some(&token),
            DEFAULT_TIMEOUT,
        )
        .await,
    )
}

async fn bot_admin(method: reqwest::Method, path: &str, body: Option<Value>) -> CallToolResult {
    let token = match admin_token("SHENRON_API_ADMIN_TOKEN", "admin") {
        Ok(t) => t,
        Err(e) => return err(e),
    };
    done(
        call(method, &api_base(), path, &vec![], body.as_ref(), Some(&token), DEFAULT_TIMEOUT)
            .await,
    )
}

pub(crate) async fn admin_bot_commands() -> CallToolResult {
    bot_admin(reqwest::Method::GET, "/api/bot/commands/catalog", None).await
}

/// Input of `dragonball.admin_bot_command_execute`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminCommandRequest {
    #[schemars(description = "Commande à exécuter (1 à 160 caractères), voir admin_bot_commands")]
    pub invocation: String,
    #[schemars(description = "Options de la commande")]
    #[serde(default)]
    pub options: Option<HashMap<String, Value>>,
    #[schemars(description = "Salon Discord (snowflake de 17 à 20 chiffres)")]
    #[serde(default)]
    pub channel_id: Option<String>,
}

pub(crate) async fn admin_bot_command_execute(r: AdminCommandRequest) -> CallToolResult {
    let len = r.invocation.chars().count();
    if len == 0 || len > 160 {
        return err("invocation : 1 à 160 caractères");
    }
    if let Some(channel) = &r.channel_id
        && (!(17..=20).contains(&channel.len()) || !channel.bytes().all(|b| b.is_ascii_digit()))
    {
        return err("channelId : snowflake de 17 à 20 chiffres");
    }
    let body =
        json!({ "invocation": r.invocation, "options": r.options, "channelId": r.channel_id });
    bot_admin(reqwest::Method::POST, "/api/bot/commands/exec", Some(body)).await
}

pub(crate) async fn admin_services() -> CallToolResult {
    bot_admin(reqwest::Method::GET, "/api/services", None).await
}

/// Input of `dragonball.admin_service_action`.
#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub(crate) struct AdminServiceActionRequest {
    #[schemars(description = "Service listé par admin_services ([a-z0-9-]{1,80})")]
    pub service: String,
    #[schemars(description = "Action listée par admin_services ([a-z0-9-]{1,80})")]
    pub action: String,
    #[schemars(description = "Arguments de l'action")]
    #[serde(default)]
    pub arguments: Option<HashMap<String, Value>>,
}

/// `[a-z0-9-]{1,80}`.
pub(crate) fn is_service_token(value: &str) -> bool {
    (1..=80).contains(&value.len())
        && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub(crate) async fn admin_service_action(r: AdminServiceActionRequest) -> CallToolResult {
    if !is_service_token(&r.service) || !is_service_token(&r.action) {
        return err("service et action : [a-z0-9-]{1,80}");
    }
    let body = json!(r.arguments.unwrap_or_default());
    bot_admin(
        reqwest::Method::POST,
        &format!("/api/services/{}/{}", r.service, r.action),
        Some(body),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tome_ids_match_the_ocr_contract() {
        assert_eq!(manga_tome_id(&Tome::Number(13)), "vol13");
        assert_eq!(manga_tome_id(&Tome::Id(" 7 ".into())), "vol7");
        assert_eq!(manga_tome_id(&Tome::Id("ch1407".into())), "ch1407");
    }

    #[test]
    fn slugify_folds_accents_and_punctuation() {
        assert_eq!(slugify("Son Gokū"), "son-goku");
        assert_eq!(slugify("  Végéta !! "), "vegeta");
    }

    #[test]
    fn absolutize_only_rewrites_relative_links() {
        let v = absolutize(
            json!({ "url": "/wiki/x", "href": "https://a/b", "title": "/not-a-link", "items": [{ "url": "/y" }] }),
            "https://site",
        );
        assert_eq!(v["url"], "https://site/wiki/x");
        assert_eq!(v["href"], "https://a/b");
        assert_eq!(v["title"], "/not-a-link");
        assert_eq!(v["items"][0]["url"], "https://site/y");
    }

    #[test]
    fn extract_centres_on_the_term() {
        let text = format!("{}Kamehameha{}", "a".repeat(500), "b".repeat(500));
        let out = extrait_autour(&text, "Kamehameha");
        assert!(out.contains("Kamehameha"));
        assert!(out.starts_with('…') && out.ends_with('…'));
        assert_eq!(extrait_autour("court", "x"), "court");
    }

    #[test]
    fn urls_skip_empty_query_values_and_encode() {
        let url = build_url(
            "https://b",
            "/p",
            &vec![("q", Some("a b&c".into())), ("x", None), ("y", Some(String::new()))],
        );
        assert_eq!(url, "https://b/p?q=a%20b%26c");
    }

    #[test]
    fn service_tokens_are_restricted() {
        assert!(is_service_token("shenron-bot"));
        assert!(!is_service_token("rm -rf"));
        assert!(!is_service_token(""));
    }

    #[test]
    fn agent_card_lists_every_target() {
        assert_eq!(agent_card()["supportedTargets"].as_array().map(Vec::len), Some(9));
    }

    #[tokio::test]
    async fn validation_fails_closed_before_any_request() {
        let r = admin_service_action(AdminServiceActionRequest {
            service: "Bad Name".into(),
            action: "x".into(),
            arguments: None,
        })
        .await;
        assert_eq!(r.is_error, Some(true));
        let r = wiki_list(WikiListRequest {
            category: "nope".into(),
            limit: None,
            offset: None,
            q: None,
        })
        .await;
        assert_eq!(r.is_error, Some(true));
        let r = rag_search(RagSearchRequest {
            query: "x".into(),
            limit: None,
            lang: None,
            entity: None,
            source_id: None,
            kind: None,
            local: None,
        })
        .await;
        assert_eq!(r.is_error, Some(true));
    }

    #[tokio::test]
    async fn local_rag_answers_offline() {
        let r = rag_search(RagSearchRequest {
            query: "Goku".into(),
            limit: Some(3),
            lang: None,
            entity: None,
            source_id: None,
            kind: None,
            local: Some(true),
        })
        .await;
        assert_ne!(r.is_error, Some(true));
        let text = r.content[0].as_text().map(|t| t.text.clone()).unwrap_or_default();
        let v: Value = serde_json::from_str(&text).expect("json");
        assert_eq!(v["mode"], "aphrody_local_naive");
    }
}
