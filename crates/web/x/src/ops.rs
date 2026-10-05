// SPDX-License-Identifier: Apache-2.0
//! The X operation table: one JSON-in, JSON-out entry per capability of this crate, and the runner
//! that executes an operation with retry, rate-limit waiting and pacing.
//!
//! This is the single surface the Bun package, the FFI job API and the batch driver sit on. An
//! operation has a name (the Rust method name in snake case: `create_tweet`, `user_tweets`, ...),
//! JSON arguments and a JSON result; [`OPS`] lists them with their kind and retry class, and the
//! `meta` operation serves the same table at run time.
//!
//! * **Pure** operations (parsers, catalog, ranking) need nothing and run synchronously.
//! * **Local** operations touch local state only (the SQLite store, the rate-limit table of a
//!   client) and run synchronously.
//! * **Network** operations talk to X. They run asynchronously through [`execute`], which retries
//!   transient failures, waits out rate limits and returns an envelope:
//!
//! ```json
//! {"ok": true,  "op": "search", "id": "q1", "data": {...}, "rate_limit": {...}, "attempts": 1, "elapsed_ms": 412}
//! {"ok": false, "op": "like",   "id": "t9", "error": {"message": "...", "kind": "terminal", "code": 139}, "attempts": 1, "elapsed_ms": 88}
//! ```

use std::{
    collections::{HashMap, HashSet},
    future::Future,
    path::Path,
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use reqwest::Method;
use serde::Serialize;
use serde_json::{Map, Value, json};
use time::format_description::well_known::Rfc3339;

use crate::{
    Result, XClient, XError,
    algorithm::RankingContext,
    archive,
    catalog::{self, OpType, Operation},
    client::{CallScope, RateLimit, now_epoch, with_call_scope},
    features, ids,
    news::{self, NewsOptions},
    parse::{self, Author, Tweet, TweetPage, UserPage},
    policy::{ErrorInfo, ErrorKind, Pacer, RetryPolicy, classify, jitter01},
    premium, store,
    surface::{
        DISCOVERY_PAGES, GRAPHQL_URL_TEMPLATE, GRYPHON_GRAPHQL_OPS, PREMIUM_GRAPHQL_OPS,
        PRODUCT_SKUS, REST_V1_1_BASE, X_PRO_RECON_URLS,
    },
    x_pro_deck::XProDeckConfig,
};

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/// Where an operation runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OpKind {
    /// No state at all (parsers, catalog, ranking).
    Pure,
    /// Local state only (store, client tables); synchronous.
    Local,
    /// Talks to X; asynchronous.
    Network,
}

/// One entry of the operation table.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct OpSpec {
    /// The operation name.
    pub name: &'static str,
    /// Where it runs.
    pub kind: OpKind,
    /// Whether it needs an open client (a session).
    pub needs_client: bool,
    /// Whether it changes state on X (paced and never waited on by default, see [`RetryPolicy`]).
    pub mutating: bool,
    /// Whether repeating it after an ambiguous failure is harmless.
    pub idempotent: bool,
    /// Arguments, for humans (`name` required, `name?` optional).
    pub args: &'static str,
}

const fn pure(name: &'static str, args: &'static str) -> OpSpec {
    OpSpec {
        name,
        kind: OpKind::Pure,
        needs_client: false,
        mutating: false,
        idempotent: true,
        args,
    }
}
const fn local(name: &'static str, args: &'static str) -> OpSpec {
    OpSpec {
        name,
        kind: OpKind::Local,
        needs_client: false,
        mutating: false,
        idempotent: true,
        args,
    }
}
const fn local_client(name: &'static str, args: &'static str) -> OpSpec {
    OpSpec {
        name,
        kind: OpKind::Local,
        needs_client: true,
        mutating: false,
        idempotent: true,
        args,
    }
}
const fn read(name: &'static str, args: &'static str) -> OpSpec {
    OpSpec {
        name,
        kind: OpKind::Network,
        needs_client: true,
        mutating: false,
        idempotent: true,
        args,
    }
}
/// A network operation that does not need a session.
const fn open(name: &'static str, args: &'static str) -> OpSpec {
    OpSpec {
        name,
        kind: OpKind::Network,
        needs_client: false,
        mutating: false,
        idempotent: true,
        args,
    }
}
/// A mutation that sets a state (repeating it changes nothing more).
const fn set(name: &'static str, args: &'static str) -> OpSpec {
    OpSpec {
        name,
        kind: OpKind::Network,
        needs_client: true,
        mutating: true,
        idempotent: true,
        args,
    }
}
/// A mutation that creates something (repeating it would create it twice).
const fn create(name: &'static str, args: &'static str) -> OpSpec {
    OpSpec {
        name,
        kind: OpKind::Network,
        needs_client: true,
        mutating: true,
        idempotent: false,
        args,
    }
}

const PAGE: &str = "count?, cursor?, quote_depth?, all?, max_pages?, max_barren_pages?";

/// Every operation, in the order `meta` lists them.
pub static OPS: &[OpSpec] = &[
    // identity
    read("whoami", ""),
    read("user_by_screen_name", "handle"),
    read("user_id_for", "handle"),
    // tweets: write
    create("create_tweet", "text, reply_to?, media_ids?"),
    create("create_tweet_rest", "text, reply_to?"),
    create("note_tweet", "note_text, tweet_text?"),
    set("delete_tweet", "id"),
    set("like", "id"),
    set("unlike", "id"),
    set("retweet", "id"),
    set("unretweet", "id"),
    set("bookmark", "id"),
    set("unbookmark", "id"),
    set("pin_tweet", "id"),
    set("unpin_tweet", "id"),
    // graph and messages
    set("follow", "user_id"),
    set("unfollow", "user_id"),
    set("block", "user_id"),
    set("unblock", "user_id"),
    set("mute", "user_id"),
    set("unmute", "user_id"),
    create("send_dm", "recipient_id, text"),
    // reads
    read("get_tweet", "id, quote_depth?"),
    read("thread", "id, cursor?, quote_depth?, all?, max_pages?"),
    read("tweet_detail_raw", "id, cursor?"),
    read(
        "search",
        "query, product?, query_source?, count?, cursor?, quote_depth?, all?, max_pages?",
    ),
    read("user_tweets", "user_id|handle?, count?, cursor?, quote_depth?, all?, max_pages?"),
    read(
        "user_tweets_and_replies",
        "user_id|handle?, count?, cursor?, quote_depth?, all?, max_pages?",
    ),
    read("user_media", "user_id|handle?, count?, cursor?, quote_depth?, all?, max_pages?"),
    read("home", "latest?, count?, cursor?, quote_depth?, all?, max_pages?"),
    read("home_timeline", "count?"),
    read("likes", "user_id|handle?, count?, cursor?, quote_depth?, all?, max_pages?"),
    read("bookmarks", PAGE),
    read("following", "user_id|handle?, count?, cursor?, all?, max_pages?"),
    read("followers", "user_id|handle?, count?, cursor?, all?, max_pages?"),
    read("list_timeline", "list, count?, cursor?, quote_depth?, all?, max_pages?"),
    read("lists", "user_id|handle?, member_of?, count?"),
    read("community_by_rest_id", "community"),
    read("community_timeline", "community, count?, cursor?, quote_depth?, all?, max_pages?"),
    read("community_info_and_timeline", "community, count?, quote_depth?"),
    read("timeline_tweets", "operation, variables, quote_depth?"),
    read("timeline_users", "operation, variables"),
    read("get_news", "count?, tabs?, ai_only?"),
    read("explore", ""),
    // media and premium
    set("upload_media", "path, alt?"),
    read("premium_upsells", ""),
    read("premium_bundle", "handle"),
    read("premium_fetch_all", "handle?, user_id?"),
    // X Pro
    read("viewer_account_sync", ""),
    read("xpro_get_deck", "deck_id"),
    create("xpro_create_deck", "name, columns?"),
    set("xpro_update_deck", "deck_id, config"),
    set("xpro_remove_deck", "deck_id"),
    set("xpro_reorder_decks", "deck_ids"),
    create("xpro_create_column", "deck_id, column"),
    set("xpro_update_column", "deck_id, column_id, column"),
    set("xpro_remove_column", "deck_id, column_id"),
    set("xpro_reorder_columns", "deck_id, column_ids"),
    set("xpro_import_client_sync_columns", ""),
    read("xpro_probe", ""),
    // raw access
    read("graphql", "operation, variables?, features?, wait?, max_wait_secs?, idempotent?"),
    read("request", "method?, url|path, query?, headers?, form?, json?, body?"),
    // maintenance
    open("catalog_sync", "path"),
    open("bundles_discover", ""),
    open("query_ids_live", "operations?"),
    open("coverage", "check_query_ids?, probe_premium?"),
    read("query_ids_refresh", "operations?, force?"),
    local_client("rate_limit", "operation?"),
    local_client("query_ids_snapshot", ""),
    local_client("query_ids_get", "operation"),
    local_client("session_info", ""),
    // pure
    pure("meta", ""),
    pure("catalog_get", "name"),
    pure("catalog_list", "type?, filter?"),
    pure("features_for", "operation"),
    pure("bundle_extract", "js"),
    pure("premium_variables", "handle, user_id"),
    pure("parse_timeline_tweets", "json, quote_depth?"),
    pure("parse_timeline_users", "json"),
    pure("parse_tweet_result", "json, quote_depth?"),
    pure("parse_user_result", "json"),
    pure("parse_single_tweet", "json, id"),
    pure("parse_post_count", "text"),
    pure("parse_news_item", "item_content, entry_id?, source?, ai_only?"),
    pure("parse_tab_items", "json, source?, max_count?, ai_only?"),
    pure("parse_upsells", "json"),
    pure("parse_premium_flags", "viewer, user?"),
    pure("parse_viewer_account_sync", "json"),
    pure("parse_timestamp", "text"),
    pure("archive_resolve_file", "path"),
    pure("archive_parse", "raw"),
    pure("archive_tweet", "element, owner"),
    pure("rank_tweets", "tweets, context?, top_k?"),
    // store
    local("store_open", "path?"),
    local("store_close", "store"),
    local("store_upsert_tweet", "store, tweet"),
    local("store_upsert_user", "store, user"),
    local("store_add_edge", "store, account, kind, tweet_id"),
    local("store_add_follow", "store, account, direction, user"),
    local("store_ingest", "store, tweets?, users?, edges?, follows?"),
    local("store_ingest_users", "store, json"),
    local("store_search", "store, query, limit?"),
    local("store_stats", "store"),
    local("store_export", "store"),
    local("store_digest", "store, top?"),
    local("store_mutuals", "store, account"),
    local("store_non_mutual", "store, account"),
    local("store_query", "store, sql, params?, limit?"),
    local("store_known_usernames", "store"),
    local("store_known_communities", "store"),
    local("import_archive", "store, path, owner"),
];

static SPEC_INDEX: LazyLock<HashMap<&'static str, &'static OpSpec>> =
    LazyLock::new(|| OPS.iter().map(|spec| (spec.name, spec)).collect());

/// The table entry of `name`.
pub fn spec(name: &str) -> Option<&'static OpSpec> {
    SPEC_INDEX.get(name).copied()
}

/// Whether this call changes state on X (the table says so, except for the raw operations whose
/// answer depends on the arguments).
pub fn is_mutating(op: &str, args: &Value) -> bool {
    match op {
        "graphql" => args
            .get("operation")
            .and_then(Value::as_str)
            .and_then(catalog::operation)
            .is_some_and(|operation| !operation.op_type.is_query()),
        "request" => !matches!(request_method(args).as_str(), "GET" | "HEAD"),
        other => spec(other).is_some_and(|s| s.mutating),
    }
}

/// Whether repeating this call after an ambiguous failure is harmless.
pub fn is_idempotent(op: &str, args: &Value) -> bool {
    match op {
        "graphql" | "request" => {
            !is_mutating(op, args) || args.get("idempotent").and_then(Value::as_bool) == Some(true)
        },
        other => spec(other).is_none_or(|s| s.idempotent),
    }
}

fn request_method(args: &Value) -> String {
    args.get("method").and_then(Value::as_str).unwrap_or("GET").to_ascii_uppercase()
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

fn invalid(message: impl Into<String>) -> XError {
    XError::Invalid(message.into())
}

/// A present, non-null argument.
fn arg<'a>(args: &'a Value, key: &str) -> Option<&'a Value> {
    args.get(key).filter(|value| !value.is_null())
}

fn arg_value<'a>(args: &'a Value, key: &str) -> Result<&'a Value> {
    arg(args, key).ok_or_else(|| invalid(format!("missing argument `{key}`")))
}

fn arg_str<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    match arg(args, key) {
        Some(Value::String(text)) if !text.trim().is_empty() => Ok(text.as_str()),
        Some(Value::String(_)) => Err(invalid(format!("argument `{key}` is empty"))),
        Some(_) => Err(invalid(format!("argument `{key}` must be a string"))),
        None => Err(invalid(format!("missing argument `{key}`"))),
    }
}

fn arg_opt_str<'a>(args: &'a Value, key: &str) -> Result<Option<&'a str>> {
    match arg(args, key) {
        None => Ok(None),
        Some(Value::String(text)) => Ok(Some(text.as_str())),
        Some(_) => Err(invalid(format!("argument `{key}` must be a string"))),
    }
}

fn arg_u64(args: &Value, key: &str, default: u64) -> Result<u64> {
    match arg(args, key) {
        None => Ok(default),
        Some(value) => value
            .as_u64()
            .ok_or_else(|| invalid(format!("argument `{key}` must be a non-negative integer"))),
    }
}

fn arg_u32(args: &Value, key: &str, default: u32) -> Result<u32> {
    u32::try_from(arg_u64(args, key, u64::from(default))?)
        .map_err(|_| invalid(format!("argument `{key}` is too large")))
}

fn arg_bool(args: &Value, key: &str, default: bool) -> Result<bool> {
    match arg(args, key) {
        None => Ok(default),
        Some(Value::Bool(flag)) => Ok(*flag),
        Some(_) => Err(invalid(format!("argument `{key}` must be a boolean"))),
    }
}

fn arg_str_list(args: &Value, key: &str) -> Result<Vec<String>> {
    match arg(args, key) {
        None => Ok(Vec::new()),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| invalid(format!("argument `{key}` must be a list of strings")))
            })
            .collect(),
        Some(_) => Err(invalid(format!("argument `{key}` must be a list of strings"))),
    }
}

fn arg_tweet_id(args: &Value, key: &str) -> Result<String> {
    let raw = arg_str(args, key)?;
    ids::tweet_id(raw).ok_or_else(|| invalid(format!("could not extract a tweet id from `{raw}`")))
}

fn to_json<T: Serialize>(value: &T) -> Result<Value> {
    Ok(serde_json::to_value(value)?)
}

fn from_json<T: serde::de::DeserializeOwned>(value: &Value, what: &str) -> Result<T> {
    serde_json::from_value(value.clone())
        .map_err(|error| invalid(format!("invalid {what}: {error}")))
}

// ---------------------------------------------------------------------------
// Context and dispatch
// ---------------------------------------------------------------------------

/// What an operation may use besides its arguments.
#[derive(Clone, Copy, Default)]
pub struct OpContext<'a> {
    /// The open client, for operations that need a session.
    pub client: Option<&'a XClient>,
}

impl<'a> OpContext<'a> {
    fn client(&self) -> Result<&'a XClient> {
        self.client.ok_or_else(|| invalid("this operation needs an open client (a session)"))
    }
}

/// Run any operation once: no retry, no waiting beyond what the client's call scope allows.
pub async fn run(ctx: OpContext<'_>, op: &str, args: &Value) -> Result<Value> {
    let spec = spec(op).ok_or_else(|| invalid(format!("unknown operation `{op}`")))?;
    if spec.needs_client && ctx.client.is_none() {
        return Err(invalid(format!("operation `{op}` needs an open client (a session)")));
    }
    match spec.kind {
        OpKind::Pure | OpKind::Local => run_local(ctx, op, args),
        OpKind::Network => network(ctx, op, args).await,
    }
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

/// Open SQLite stores, addressed by the handle `store_open` returned.
pub struct StoreRegistry {
    next: AtomicU64,
    stores: Mutex<HashMap<u64, Arc<Mutex<store::Store>>>>,
}

impl StoreRegistry {
    /// The process-wide registry used by the FFI.
    pub fn global() -> &'static StoreRegistry {
        static GLOBAL: LazyLock<StoreRegistry> = LazyLock::new(|| StoreRegistry {
            next: AtomicU64::new(1),
            stores: Mutex::new(HashMap::new()),
        });
        &GLOBAL
    }

    /// Open (creating if needed) the store at `path` (`:memory:` for a private database).
    pub fn open(&self, path: &Path) -> Result<u64> {
        let store = store::Store::open(path)?;
        let id = self.next.fetch_add(1, Ordering::SeqCst);
        self.stores
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, Arc::new(Mutex::new(store)));
        Ok(id)
    }

    fn get(&self, id: u64) -> Result<Arc<Mutex<store::Store>>> {
        self.stores
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&id)
            .cloned()
            .ok_or_else(|| invalid(format!("unknown store handle {id}")))
    }

    /// Close a store; `false` when the handle was unknown.
    pub fn close(&self, id: u64) -> bool {
        self.stores.lock().unwrap_or_else(|e| e.into_inner()).remove(&id).is_some()
    }
}

/// Run `f` on the store the `store` argument names.
fn with_store<T>(args: &Value, f: impl FnOnce(&store::Store) -> Result<T>) -> Result<T> {
    let id = arg(args, "store")
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid("missing argument `store` (a handle from store_open)"))?;
    let handle = StoreRegistry::global().get(id)?;
    let guard = handle.lock().unwrap_or_else(|e| e.into_inner());
    f(&guard)
}

// ---------------------------------------------------------------------------
// Pure and local operations
// ---------------------------------------------------------------------------

fn op_type_name(op_type: OpType) -> &'static str {
    match op_type {
        OpType::Query => "query",
        OpType::Mutation => "mutation",
        OpType::Subscription => "subscription",
    }
}

fn operation_json(op: &Operation) -> Value {
    json!({
        "name": op.name,
        "queryId": op.query_id,
        "operationType": op_type_name(op.op_type),
        "featureSwitches": op.feature_switches,
    })
}

fn iso_now() -> String {
    time::OffsetDateTime::now_utc().format(&Rfc3339).unwrap_or_default()
}

/// The `meta` operation: the table, the taxonomy, the surface constants, the defaults.
fn meta_value() -> Value {
    let all = catalog::all();
    json!({
        "api": 1,
        "crate_version": env!("CARGO_PKG_VERSION"),
        "ops": OPS,
        "policy": crate::policy::policy_json(),
        "defaults": {
            "retry": RetryPolicy::default(),
            "pacing": crate::policy::PacingOptions::default(),
        },
        "catalog": {
            "total": all.len(),
            "queries": all.iter().filter(|o| o.op_type.is_query()).count(),
            "mutations": all.iter().filter(|o| o.op_type.is_mutation()).count(),
        },
        "surface": {
            "api_base": crate::client::API_BASE,
            "upload_url": crate::client::UPLOAD_URL,
            "discovery_pages": DISCOVERY_PAGES,
            "x_pro_recon_urls": X_PRO_RECON_URLS,
            "gryphon_graphql_ops": GRYPHON_GRAPHQL_OPS,
            "premium_graphql_ops": PREMIUM_GRAPHQL_OPS,
            "product_skus": PRODUCT_SKUS,
            "graphql_url_template": GRAPHQL_URL_TEMPLATE,
            "rest_v1_1_base": REST_V1_1_BASE,
        },
    })
}

/// Run a **pure** or **local** operation synchronously.
pub fn run_local(ctx: OpContext<'_>, op: &str, args: &Value) -> Result<Value> {
    match op {
        "meta" => Ok(meta_value()),
        "catalog_get" => {
            let name = arg_str(args, "name")?;
            Ok(catalog::operation(name).map_or(Value::Null, operation_json))
        },
        "catalog_list" => {
            let wanted = arg_opt_str(args, "type")?;
            let filter = arg_opt_str(args, "filter")?.map(str::to_lowercase);
            let mut ops: Vec<&Operation> = catalog::all()
                .into_iter()
                .filter(|o| wanted.is_none_or(|t| op_type_name(o.op_type) == t))
                .filter(|o| filter.as_deref().is_none_or(|f| o.name.to_lowercase().contains(f)))
                .collect();
            ops.sort_by(|a, b| a.name.cmp(&b.name));
            Ok(Value::Array(ops.into_iter().map(operation_json).collect()))
        },
        "bundle_extract" => {
            to_json(&crate::runtime_query_ids::extract_all_operations(arg_str(args, "js")?))
        },
        "features_for" => {
            let name = arg_str(args, "operation")?;
            let op =
                catalog::operation(name).ok_or_else(|| XError::UnknownOperation(name.into()))?;
            Ok(features::features_for(op))
        },
        "premium_variables" => Ok(Value::Object(premium::premium_variables(
            arg_str(args, "handle")?,
            arg_str(args, "user_id")?,
        ))),
        "parse_timeline_tweets" => {
            let depth = arg_u32(args, "quote_depth", 1)?;
            to_json(&parse::walk_timeline_tweets(arg_value(args, "json")?, depth))
        },
        "parse_timeline_users" => to_json(&parse::walk_timeline_users(arg_value(args, "json")?)),
        "parse_tweet_result" => {
            let depth = arg_u32(args, "quote_depth", 1)?;
            to_json(&parse::parse_tweet_result(arg_value(args, "json")?, depth))
        },
        "parse_user_result" => to_json(&parse::parse_user_result(arg_value(args, "json")?)),
        "parse_single_tweet" => to_json(&parse::parse_single_tweet(
            arg_value(args, "json")?,
            &arg_tweet_id(args, "id")?,
        )),
        "parse_post_count" => to_json(&news::parse_post_count(arg_str(args, "text")?)),
        "parse_news_item" => to_json(&news::parse_news_item(
            arg_value(args, "item_content")?,
            arg_opt_str(args, "entry_id")?.unwrap_or_default(),
            arg_opt_str(args, "source")?.unwrap_or_default(),
            arg_bool(args, "ai_only", false)?,
        )),
        "parse_tab_items" => to_json(&news::parse_tab_items(
            arg_value(args, "json")?,
            arg_opt_str(args, "source")?.unwrap_or_default(),
            usize::try_from(arg_u64(args, "max_count", 20)?).unwrap_or(usize::MAX),
            arg_bool(args, "ai_only", false)?,
        )),
        "parse_upsells" => to_json(&premium::parse_upsells_response(arg_value(args, "json")?)),
        "parse_premium_flags" => {
            to_json(&premium::parse_premium_flags(arg_value(args, "viewer")?, arg(args, "user")))
        },
        "parse_viewer_account_sync" => {
            to_json(&crate::x_pro_deck::parse_viewer_account_sync(arg_value(args, "json")?))
        },
        "parse_timestamp" => to_json(&parse::parse_timestamp(arg_str(args, "text")?)),
        "archive_resolve_file" => to_json(
            &archive::resolve_tweets_file(Path::new(arg_str(args, "path")?))
                .map(|path| path.display().to_string()),
        ),
        "archive_parse" => to_json(&archive::parse_archive_array(arg_str(args, "raw")?)?),
        "archive_tweet" => {
            let owner: Author = from_json(arg_value(args, "owner")?, "owner")?;
            to_json(&archive::archive_tweet_to_tweet(arg_value(args, "element")?, &owner))
        },
        "rank_tweets" => {
            let tweets: Vec<Tweet> = from_json(arg_value(args, "tweets")?, "tweets")?;
            let context: RankingContext = match arg(args, "context") {
                Some(value) => from_json(value, "context")?,
                None => RankingContext::default(),
            };
            let top_k = usize::try_from(arg_u64(args, "top_k", 20)?).unwrap_or(usize::MAX);
            to_json(&crate::rank_tweets(&tweets, context, top_k))
        },

        // -- client state ---------------------------------------------------
        "rate_limit" => {
            let client = ctx.client()?;
            let snapshot = match arg_opt_str(args, "operation")? {
                Some(endpoint) => client.rate_limit_for(endpoint),
                None => client.last_rate_limit(),
            };
            to_json(&snapshot)
        },
        "query_ids_snapshot" => {
            let store = ctx.client()?.query_ids();
            Ok(match store.snapshot() {
                Some(snapshot) => snapshot_json(store.cache_path(), &snapshot),
                None => json!({
                    "cache_path": store.cache_path().display().to_string(),
                    "fresh": null,
                    "count": 0,
                    "ids": {},
                }),
            })
        },
        "query_ids_get" => to_json(&ctx.client()?.query_ids().get(arg_str(args, "operation")?)),
        "session_info" => {
            let client = ctx.client()?;
            let session = client.session();
            Ok(json!({
                "handle": session.handle,
                "has_transaction_id": session.transaction_id.is_some(),
                "source_path": session.source_path().map(|p| p.display().to_string()),
                "api_base": client.api_base(),
            }))
        },

        // -- store ----------------------------------------------------------
        "store_open" => {
            let path = match arg_opt_str(args, "path")? {
                Some(path) => std::path::PathBuf::from(path),
                None => store::Store::default_path(),
            };
            let id = StoreRegistry::global().open(&path)?;
            Ok(json!({ "store": id, "path": path.display().to_string() }))
        },
        "store_close" => {
            let id = arg_u64(args, "store", 0)?;
            Ok(json!({ "closed": StoreRegistry::global().close(id) }))
        },
        "store_upsert_tweet" => {
            let tweet: Tweet = from_json(arg_value(args, "tweet")?, "tweet")?;
            with_store(args, |s| s.upsert_tweet(&tweet))?;
            Ok(json!({ "id": tweet.id }))
        },
        "store_upsert_user" => {
            let user: parse::User = from_json(arg_value(args, "user")?, "user")?;
            with_store(args, |s| s.upsert_user(&user))?;
            Ok(json!({ "id": user.id }))
        },
        "store_add_edge" => {
            with_store(args, |s| {
                s.add_edge(
                    arg_str(args, "account")?,
                    arg_str(args, "kind")?,
                    arg_str(args, "tweet_id")?,
                )
            })?;
            Ok(json!({ "ok": true }))
        },
        "store_add_follow" => {
            let user: parse::User = from_json(arg_value(args, "user")?, "user")?;
            with_store(args, |s| {
                s.add_follow(arg_str(args, "account")?, arg_str(args, "direction")?, &user)
            })?;
            Ok(json!({ "ok": true }))
        },
        "store_ingest" => {
            let batch: store::IngestBatch = from_json(args, "ingest batch")?;
            to_json(&with_store(args, |s| s.ingest(&batch))?)
        },
        "store_ingest_users" => {
            let root = arg_value(args, "json")?;
            let users = collect_users(root);
            let count = users.len();
            let batch = store::IngestBatch { users, ..store::IngestBatch::default() };
            with_store(args, |s| s.ingest(&batch))?;
            Ok(json!({ "users": count }))
        },
        "store_search" => {
            let limit = arg_u32(args, "limit", 20)?;
            to_json(&with_store(args, |s| s.search(arg_str(args, "query")?, limit))?)
        },
        "store_stats" => to_json(&with_store(args, |s| {
            let path = args.get("path").and_then(Value::as_str).unwrap_or("").to_owned();
            s.stats(&path)
        })?),
        "store_export" => Ok(Value::Array(with_store(args, |s| s.export_tweets())?)),
        "store_digest" => {
            let top = arg_u32(args, "top", 10)?;
            to_json(&with_store(args, |s| s.digest(top))?)
        },
        "store_mutuals" => to_json(&with_store(args, |s| s.mutuals(arg_str(args, "account")?))?),
        "store_non_mutual" => {
            to_json(&with_store(args, |s| s.non_mutual_following(arg_str(args, "account")?))?)
        },
        "store_query" => {
            let params: Vec<Value> = match arg(args, "params") {
                None => Vec::new(),
                Some(Value::Array(items)) => items.clone(),
                Some(_) => return Err(invalid("argument `params` must be an array")),
            };
            let limit = usize::try_from(arg_u64(args, "limit", 1000)?).unwrap_or(usize::MAX);
            Ok(Value::Array(with_store(args, |s| s.query(arg_str(args, "sql")?, &params, limit))?))
        },
        "store_known_usernames" => to_json(&with_store(args, |s| s.known_usernames())?),
        "store_known_communities" => to_json(&with_store(args, |s| s.known_communities())?),
        "import_archive" => {
            let imported = with_store(args, |s| {
                archive::import_archive(
                    s,
                    Path::new(arg_str(args, "path")?),
                    arg_str(args, "owner")?,
                )
            })?;
            Ok(json!({ "imported": imported, "owner": ids::handle(arg_str(args, "owner")?) }))
        },
        other if spec(other).is_some() => {
            Err(invalid(format!("`{other}` is a network operation: submit it as a job")))
        },
        other => Err(invalid(format!("unknown operation `{other}`"))),
    }
}

/// The queryId cache snapshot as served by `query_ids_snapshot` and `query_ids_refresh`.
fn snapshot_json(cache_path: &Path, snapshot: &crate::QueryIdSnapshot) -> Value {
    json!({
        "cache_path": cache_path.display().to_string(),
        "fresh": snapshot.is_fresh(),
        "fetched_at": snapshot.fetched_at,
        "ttl_secs": snapshot.ttl_secs,
        "age_secs": snapshot.age_secs(),
        "count": snapshot.ids.len(),
        "ids": snapshot.ids,
        "bundles": snapshot.bundles,
    })
}

/// Every user of a response, found anywhere under a `user_results.result` key.
fn collect_users(root: &Value) -> Vec<parse::User> {
    let mut found: Vec<parse::User> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut stack = vec![root];
    while let Some(value) = stack.pop() {
        match value {
            Value::Object(map) => {
                if let Some(result) = map.get("user_results").and_then(|u| u.get("result"))
                    && let Some(user) = parse::parse_user_result(result)
                    && seen.insert(user.id.clone())
                {
                    found.push(user);
                }
                stack.extend(map.values());
            },
            Value::Array(items) => stack.extend(items.iter()),
            _ => {},
        }
    }
    found
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

struct Paging {
    count: u32,
    cursor: Option<String>,
    quote_depth: u32,
    all: bool,
    max_pages: u32,
    max_barren: u32,
}

fn paging(args: &Value) -> Result<Paging> {
    Ok(Paging {
        count: arg_u32(args, "count", 20)?,
        cursor: arg_opt_str(args, "cursor")?.map(str::to_owned),
        quote_depth: arg_u32(args, "quote_depth", 1)?,
        all: arg_bool(args, "all", false)?,
        max_pages: arg_u32(args, "max_pages", 5)?.max(1),
        max_barren: arg_u32(args, "max_barren_pages", 3)?.max(1),
    })
}

/// A page as the fetchers return it: the items and the cursor of the next page.
type PageParts<T> = (Vec<T>, Option<String>);

/// Walk a paginated timeline. A single page is returned as is; with `all` the walk follows cursors
/// until the timeline ends, `max_pages` is reached, or `max_barren_pages` consecutive pages bring
/// nothing new (X keeps handing out fresh cursors over pages already seen). The result is
/// `{ <items_key>: [...], next_cursor, pages, complete }`; `complete` is false when the walk stopped
/// on `max_pages` with more to read.
async fn paged<T, F, Fut>(
    p: &Paging,
    items_key: &str,
    id_of: impl Fn(&T) -> String,
    mut fetch: F,
) -> Result<Value>
where
    T: Serialize,
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<PageParts<T>>>,
{
    let mut items: Vec<T> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();
    let mut seen_cursors: HashSet<String> = HashSet::new();
    let mut cursor = p.cursor.clone();
    let mut pages = 0u32;
    let mut barren = 0u32;
    let (next_cursor, complete) = loop {
        let (page_items, next) = fetch(cursor.clone()).await?;
        pages += 1;
        let raw_len = page_items.len();
        if p.all {
            let mut fresh = 0usize;
            for item in page_items {
                if seen_ids.insert(id_of(&item)) {
                    items.push(item);
                    fresh += 1;
                }
            }
            barren = if fresh == 0 { barren + 1 } else { 0 };
        } else {
            items.extend(page_items);
            break (next.clone(), next.is_none());
        }
        let repeated = next
            .as_ref()
            .is_some_and(|c| Some(c) == cursor.as_ref() || !seen_cursors.insert(c.clone()));
        if next.is_none() || raw_len == 0 || repeated || barren >= p.max_barren {
            break (next, true);
        }
        if pages >= p.max_pages {
            break (next, false);
        }
        cursor = next;
    };
    let items = serde_json::to_value(&items)?;
    Ok(json!({
        items_key: items,
        "next_cursor": next_cursor,
        "pages": pages,
        "complete": complete,
    }))
}

async fn tweets_paged<F, Fut>(p: &Paging, mut fetch: F) -> Result<Value>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<TweetPage>>,
{
    paged(
        p,
        "tweets",
        |t: &Tweet| t.id.clone(),
        move |cursor| {
            let next = fetch(cursor);
            async move { next.await.map(|page| (page.tweets, page.next_cursor)) }
        },
    )
    .await
}

async fn users_paged<F, Fut>(p: &Paging, mut fetch: F) -> Result<Value>
where
    F: FnMut(Option<String>) -> Fut,
    Fut: Future<Output = Result<UserPage>>,
{
    paged(
        p,
        "users",
        |u: &parse::User| u.id.clone(),
        move |cursor| {
            let next = fetch(cursor);
            async move { next.await.map(|page| (page.users, page.next_cursor)) }
        },
    )
    .await
}

/// The user an operation targets: `user_id`, else `handle`, else the authenticated account.
async fn target_user(client: &XClient, args: &Value) -> Result<String> {
    if let Some(id) = arg_opt_str(args, "user_id")?.filter(|id| !id.is_empty()) {
        return Ok(id.to_owned());
    }
    if let Some(handle) = arg_opt_str(args, "handle")?.filter(|h| !h.trim().is_empty()) {
        return client.user_id_for(ids::handle(handle)).await;
    }
    Ok(client.whoami().await?.id)
}

/// The tweet a post replies to (an id or a status URL), if any.
fn reply_target(args: &Value) -> Result<Option<String>> {
    match arg_opt_str(args, "reply_to")?.filter(|r| !r.is_empty()) {
        Some(raw) => ids::tweet_id(raw)
            .map(Some)
            .ok_or_else(|| invalid(format!("could not extract a tweet id from `{raw}`"))),
        None => Ok(None),
    }
}

fn list_arg(args: &Value, key: &str) -> Result<String> {
    let raw = arg_str(args, key)?;
    ids::list_id(raw).ok_or_else(|| invalid(format!("could not extract a list id from `{raw}`")))
}

fn community_arg(args: &Value) -> Result<String> {
    let raw = arg_str(args, "community")?;
    ids::community_id(raw)
        .ok_or_else(|| invalid(format!("could not extract a community id from `{raw}`")))
}

// ---------------------------------------------------------------------------
// Raw request
// ---------------------------------------------------------------------------

/// Hosts that may receive the session cookies, besides the client's own API and upload bases.
const X_HOSTS: [&str; 6] =
    ["x.com", "twitter.com", "api.x.com", "api.twitter.com", "upload.twitter.com", "upload.x.com"];

fn same_origin(url: &reqwest::Url, base: &str) -> bool {
    reqwest::Url::parse(base).is_ok_and(|b| {
        b.scheme() == url.scheme()
            && b.host_str() == url.host_str()
            && b.port_or_known_default() == url.port_or_known_default()
    })
}

/// The session may be sent to the client's own API and upload bases (same scheme, host and port:
/// loopback servers in tests, a proxy) and to X hosts over https; nowhere else.
fn host_allowed(client: &XClient, url: &reqwest::Url) -> bool {
    if same_origin(url, client.api_base()) || same_origin(url, client.upload_url()) {
        return true;
    }
    let host = url.host_str().unwrap_or_default();
    url.scheme() == "https"
        && (X_HOSTS.contains(&host) || host.ends_with(".x.com") || host.ends_with(".twitter.com"))
}

fn string_pairs(value: &Value, key: &str) -> Result<Vec<(String, String)>> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Object(map)) => Ok(map
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().map_or_else(|| v.to_string(), str::to_owned)))
            .collect()),
        Some(_) => Err(invalid(format!("argument `{key}` must be an object"))),
    }
}

async fn request_op(client: &XClient, args: &Value) -> Result<Value> {
    let method = Method::from_bytes(request_method(args).as_bytes())
        .map_err(|_| invalid("argument `method` is not an HTTP method"))?;
    let url = match (arg_opt_str(args, "url")?, arg_opt_str(args, "path")?) {
        (Some(url), _) => url.to_owned(),
        (None, Some(path)) => format!("{}/{}", client.api_base(), path.trim_start_matches('/')),
        (None, None) => return Err(invalid("missing argument `url` or `path`")),
    };
    let parsed = reqwest::Url::parse(&url)
        .map_err(|error| invalid(format!("invalid url `{url}`: {error}")))?;
    if !host_allowed(client, &parsed) {
        return Err(invalid(format!(
            "the session is not sent to `{}`: only X hosts over https, or the client's own API base",
            parsed.host_str().unwrap_or_default()
        )));
    }
    let mut builder = client.req(method, &url);
    let query = string_pairs(args, "query")?;
    if !query.is_empty() {
        builder = builder.query(&query);
    }
    for (name, value) in string_pairs(args, "headers")? {
        // The credentials are the client's: a caller cannot replace them.
        if matches!(name.to_ascii_lowercase().as_str(), "cookie" | "authorization" | "x-csrf-token")
        {
            continue;
        }
        builder = builder.header(name, value);
    }
    if arg(args, "form").is_some() {
        builder = builder.form(&string_pairs(args, "form")?);
    } else if let Some(json) = arg(args, "json") {
        builder = builder.json(json);
    } else if let Some(body) = arg_opt_str(args, "body")? {
        builder = builder.body(body.to_owned());
    }
    let response = builder.send().await?;
    let label = parsed.path().trim_start_matches('/').to_owned();
    client.observe(&label, response.headers());
    let status = response.status();
    let headers: Map<String, Value> = response
        .headers()
        .iter()
        .filter(|(name, _)| name.as_str() != "set-cookie")
        .filter_map(|(name, value)| {
            value.to_str().ok().map(|v| (name.as_str().to_owned(), Value::String(v.to_owned())))
        })
        .collect();
    let text = response.text().await?;
    let parsed_json: Option<Value> = serde_json::from_str(&text).ok();
    Ok(json!({
        "status": status.as_u16(),
        "ok": status.is_success(),
        "headers": headers,
        "body": text,
        "json": parsed_json,
    }))
}

// ---------------------------------------------------------------------------
// Network operations
// ---------------------------------------------------------------------------

const PREMIUM_WAIT: Duration = Duration::from_secs(120);

async fn premium_fetch_all(client: &XClient, handle: &str, user_id: &str) -> Value {
    let variables = premium::premium_variables(handle, user_id);
    let mut out = Map::new();
    for op in PREMIUM_GRAPHQL_OPS {
        let vars = variables.get(*op).cloned().unwrap_or_else(|| json!({}));
        let entry = match client.graphql_waiting(op, vars, None, PREMIUM_WAIT).await {
            Ok(data) => json!({ "ok": true, "data": data }),
            Err(error) => json!({ "ok": false, "error": error.to_string() }),
        };
        out.insert((*op).to_owned(), entry);
    }
    Value::Object(out)
}

async fn coverage(client: Option<&XClient>, args: &Value) -> Result<Value> {
    let all = catalog::all();
    let mut report = json!({
        "generated_at": iso_now(),
        "catalog": {
            "total": all.len(),
            "queries": all.iter().filter(|o| o.op_type.is_query()).count(),
            "mutations": all.iter().filter(|o| o.op_type.is_mutation()).count(),
        },
        "sdk_surface": OPS
            .iter()
            .filter(|s| s.kind == OpKind::Network)
            .map(|s| s.name)
            .collect::<Vec<_>>(),
        "premium_ops": PREMIUM_GRAPHQL_OPS,
    });
    if arg_bool(args, "check_query_ids", false)? {
        // The live bundles are optional: offline, the report simply has no `query_id_cache`.
        let live = async {
            let http = crate::runtime_query_ids::discovery_client()?;
            let bundles = crate::runtime_query_ids::discover_bundles_public(&http).await?;
            Ok::<_, XError>(crate::runtime_query_ids::fetch_and_extract_all(&http, &bundles).await)
        }
        .await;
        if let Ok(live) = live {
            let mut stale: Vec<&str> = all
                .iter()
                .filter(|o| live.get(&o.name).is_some_and(|q| *q != o.query_id))
                .map(|o| o.name.as_str())
                .collect();
            stale.sort_unstable();
            report["query_id_cache"] =
                json!({ "live_bundle_ops": live.len(), "stale_vs_catalog": stale });
        }
    }
    if arg_bool(args, "probe_premium", false)? {
        let client = client.ok_or_else(|| invalid("probe_premium needs an open client"))?;
        let me = client.whoami().await?;
        let fetched = premium_fetch_all(client, &me.screen_name, &me.id).await;
        let flags: Map<String, Value> = fetched
            .as_object()
            .map(|m| {
                m.iter().map(|(op, entry)| (op.clone(), json!({ "ok": entry["ok"] }))).collect()
            })
            .unwrap_or_default();
        report["premium_fetch"] = Value::Object(flags);
    }
    Ok(report)
}

/// Run a **network** operation once.
async fn network(ctx: OpContext<'_>, op: &str, args: &Value) -> Result<Value> {
    // Operations that do not need a session.
    match op {
        "catalog_sync" => {
            let report =
                crate::catalog_sync::sync_catalog_file(Path::new(arg_str(args, "path")?)).await?;
            return to_json(&report);
        },
        "coverage" => return coverage(ctx.client, args).await,
        "bundles_discover" => {
            let http = crate::runtime_query_ids::discovery_client()?;
            return to_json(&crate::runtime_query_ids::discover_bundles_public(&http).await?);
        },
        "query_ids_live" => {
            let http = crate::runtime_query_ids::discovery_client()?;
            let urls = crate::runtime_query_ids::discover_bundles_public(&http).await?;
            let mut ids = crate::runtime_query_ids::fetch_and_extract_all(&http, &urls).await;
            if arg(args, "operations").is_some() {
                let wanted: HashSet<String> =
                    arg_str_list(args, "operations")?.into_iter().collect();
                ids.retain(|name, _| wanted.contains(name));
            }
            let bundles: Vec<&str> =
                urls.iter().map(|u| u.rsplit('/').next().unwrap_or(u.as_str())).collect();
            return Ok(json!({ "ids": ids, "bundles": bundles, "bundle_urls": urls }));
        },
        _ => {},
    }
    let client = ctx.client()?;
    match op {
        // -- identity --------------------------------------------------------
        "whoami" => to_json(&client.whoami().await?),
        "user_by_screen_name" => {
            to_json(&client.user_by_screen_name(ids::handle(arg_str(args, "handle")?)).await?)
        },
        "user_id_for" => {
            let id = client.user_id_for(ids::handle(arg_str(args, "handle")?)).await?;
            Ok(json!({ "id": id }))
        },

        // -- tweets: write ---------------------------------------------------
        "create_tweet" => {
            let reply_to = reply_target(args)?;
            let media_ids = arg_str_list(args, "media_ids")?;
            to_json(
                &client
                    .create_tweet_with_media(
                        arg_str(args, "text")?,
                        reply_to.as_deref(),
                        &media_ids,
                    )
                    .await?,
            )
        },
        "create_tweet_rest" => {
            let reply_to = reply_target(args)?;
            to_json(&client.create_tweet_rest(arg_str(args, "text")?, reply_to.as_deref()).await?)
        },
        "note_tweet" => to_json(
            &client
                .note_tweet(arg_opt_str(args, "tweet_text")?, arg_str(args, "note_text")?)
                .await?,
        ),
        "delete_tweet" | "like" | "unlike" | "retweet" | "unretweet" | "bookmark"
        | "unbookmark" | "pin_tweet" | "unpin_tweet" => {
            let id = arg_tweet_id(args, "id")?;
            match op {
                "delete_tweet" => client.delete_tweet(&id).await?,
                "like" => client.like(&id).await?,
                "unlike" => client.unlike(&id).await?,
                "retweet" => client.retweet(&id).await?,
                "unretweet" => client.unretweet(&id).await?,
                "bookmark" => client.bookmark(&id).await?,
                "unbookmark" => client.unbookmark(&id).await?,
                "pin_tweet" => client.pin_tweet(&id).await?,
                _ => client.unpin_tweet(&id).await?,
            }
            Ok(json!({ "id": id }))
        },
        "follow" | "unfollow" | "block" | "unblock" | "mute" | "unmute" => {
            let user_id = arg_str(args, "user_id")?;
            match op {
                "follow" => client.follow(user_id).await?,
                "unfollow" => client.unfollow(user_id).await?,
                "block" => client.block(user_id).await?,
                "unblock" => client.unblock(user_id).await?,
                "mute" => client.mute(user_id).await?,
                _ => client.unmute(user_id).await?,
            }
            Ok(json!({ "user_id": user_id }))
        },
        "send_dm" => {
            let recipient = arg_str(args, "recipient_id")?;
            client.send_dm(recipient, arg_str(args, "text")?).await?;
            Ok(json!({ "user_id": recipient }))
        },

        // -- reads -----------------------------------------------------------
        "get_tweet" => {
            let depth = arg_u32(args, "quote_depth", 1)?;
            to_json(&client.get_tweet(&arg_tweet_id(args, "id")?, depth).await?)
        },
        "thread" => {
            let id = arg_tweet_id(args, "id")?;
            let p = paging(args)?;
            tweets_paged(&p, |cursor| {
                let (id, depth) = (id.clone(), p.quote_depth);
                async move { client.thread(&id, cursor.as_deref(), depth).await }
            })
            .await
        },
        "tweet_detail_raw" => {
            client.tweet_detail_raw(&arg_tweet_id(args, "id")?, arg_opt_str(args, "cursor")?).await
        },
        "search" => {
            let query = arg_str(args, "query")?.to_owned();
            let product = match arg_opt_str(args, "product")? {
                Some(product) => product.to_owned(),
                None if arg_bool(args, "top", false)? => "Top".to_owned(),
                None => "Latest".to_owned(),
            };
            let source = arg_opt_str(args, "query_source")?.unwrap_or("typed_query").to_owned();
            let p = paging(args)?;
            tweets_paged(&p, |cursor| {
                let (query, product, source) = (query.clone(), product.clone(), source.clone());
                let (count, depth) = (p.count, p.quote_depth);
                async move {
                    client
                        .search_with_source(
                            &query,
                            count,
                            cursor.as_deref(),
                            &product,
                            &source,
                            depth,
                        )
                        .await
                }
            })
            .await
        },
        "user_tweets" | "user_tweets_and_replies" | "user_media" | "likes" => {
            let user_id = target_user(client, args).await?;
            let p = paging(args)?;
            tweets_paged(&p, |cursor| {
                let user_id = user_id.clone();
                let (count, depth) = (p.count, p.quote_depth);
                async move {
                    match op {
                        "user_tweets" => {
                            client.user_tweets(&user_id, count, cursor.as_deref(), depth).await
                        },
                        "user_tweets_and_replies" => {
                            client
                                .user_tweets_and_replies(&user_id, count, cursor.as_deref(), depth)
                                .await
                        },
                        "user_media" => {
                            client.user_media(&user_id, count, cursor.as_deref(), depth).await
                        },
                        _ => client.likes(&user_id, count, cursor.as_deref(), depth).await,
                    }
                }
            })
            .await
        },
        "home" => {
            let latest = arg_bool(args, "latest", false)?;
            let p = paging(args)?;
            tweets_paged(&p, |cursor| {
                let (count, depth) = (p.count, p.quote_depth);
                async move { client.home(count, cursor.as_deref(), latest, depth).await }
            })
            .await
        },
        "home_timeline" => to_json(&client.home_timeline(arg_u32(args, "count", 20)?).await?),
        "bookmarks" => {
            let p = paging(args)?;
            tweets_paged(&p, |cursor| {
                let (count, depth) = (p.count, p.quote_depth);
                async move { client.bookmarks(count, cursor.as_deref(), depth).await }
            })
            .await
        },
        "following" | "followers" => {
            let user_id = target_user(client, args).await?;
            let p = paging(args)?;
            users_paged(&p, |cursor| {
                let user_id = user_id.clone();
                let count = p.count;
                async move {
                    if op == "following" {
                        client.following(&user_id, count, cursor.as_deref()).await
                    } else {
                        client.followers(&user_id, count, cursor.as_deref()).await
                    }
                }
            })
            .await
        },
        "list_timeline" => {
            let list = list_arg(args, "list")?;
            let p = paging(args)?;
            tweets_paged(&p, |cursor| {
                let list = list.clone();
                let (count, depth) = (p.count, p.quote_depth);
                async move { client.list_timeline(&list, count, cursor.as_deref(), depth).await }
            })
            .await
        },
        "lists" => {
            let user_id = target_user(client, args).await?;
            to_json(
                &client
                    .lists(
                        &user_id,
                        arg_bool(args, "member_of", false)?,
                        arg_u32(args, "count", 100)?,
                    )
                    .await?,
            )
        },
        "community_by_rest_id" => client.community_by_rest_id(&community_arg(args)?).await,
        "community_timeline" => {
            let community = community_arg(args)?;
            let p = paging(args)?;
            tweets_paged(&p, |cursor| {
                let community = community.clone();
                let (count, depth) = (p.count, p.quote_depth);
                async move {
                    client.community_timeline(&community, count, cursor.as_deref(), depth).await
                }
            })
            .await
        },
        "community_info_and_timeline" => {
            let (info, page) = client
                .community_info_and_timeline(
                    &community_arg(args)?,
                    arg_u32(args, "count", 20)?,
                    arg_u32(args, "quote_depth", 1)?,
                )
                .await?;
            Ok(json!({ "info": info, "tweets": page }))
        },
        "timeline_tweets" => {
            let page = client
                .timeline_tweets(
                    arg_str(args, "operation")?,
                    arg_value(args, "variables")?.clone(),
                    arg_u32(args, "quote_depth", 1)?,
                )
                .await?;
            to_json(&page)
        },
        "timeline_users" => to_json(
            &client
                .timeline_users(arg_str(args, "operation")?, arg_value(args, "variables")?.clone())
                .await?,
        ),
        "get_news" => {
            let defaults = NewsOptions::default();
            let tabs = if arg(args, "tabs").is_some() {
                arg_str_list(args, "tabs")?
            } else {
                defaults.tabs
            };
            let options = NewsOptions { tabs, ai_only: arg_bool(args, "ai_only", false)? };
            let count = usize::try_from(arg_u64(args, "count", 10)?).unwrap_or(usize::MAX);
            to_json(&client.get_news(count, &options).await?)
        },
        "explore" => {
            let (page, sidebar) = tokio::join!(
                client.graphql("ExplorePage", json!({}), None),
                client.graphql("ExploreSidebar", json!({}), None)
            );
            Ok(json!({
                "explore_page": page?,
                "explore_sidebar": sidebar?,
                "fetched_at": iso_now(),
            }))
        },

        // -- media and premium -----------------------------------------------
        "upload_media" => {
            let media_id = client
                .upload_media(Path::new(arg_str(args, "path")?), arg_opt_str(args, "alt")?)
                .await?;
            Ok(json!({ "media_id": media_id }))
        },
        "premium_upsells" => {
            let raw = client.graphql_waiting("Upsells", json!({}), None, PREMIUM_WAIT).await?;
            let parsed = premium::parse_upsells_response(&raw);
            Ok(json!({ "configs": parsed.configs, "raw": raw }))
        },
        "premium_bundle" => {
            let (upsells, flags, raw_upsells, raw_viewer, raw_user) =
                client.premium_bundle(ids::handle(arg_str(args, "handle")?)).await?;
            Ok(json!({
                "upsells": { "configs": upsells.configs, "raw": raw_upsells },
                "flags": flags,
                "raw": { "Upsells": raw_upsells, "Viewer": raw_viewer, "UserByScreenName": raw_user },
            }))
        },
        "premium_fetch_all" => {
            let (handle, user_id) = match (
                arg_opt_str(args, "handle")?.filter(|h| !h.is_empty()),
                arg_opt_str(args, "user_id")?.filter(|i| !i.is_empty()),
            ) {
                (Some(handle), Some(user_id)) => {
                    (ids::handle(handle).to_owned(), user_id.to_owned())
                },
                _ => {
                    let me = client.whoami().await?;
                    (me.screen_name, me.id)
                },
            };
            Ok(premium_fetch_all(client, &handle, &user_id).await)
        },

        // -- X Pro ------------------------------------------------------------
        "viewer_account_sync" => to_json(&client.viewer_account_sync().await?),
        "xpro_get_deck" => to_json(&client.xpro_get_deck(arg_str(args, "deck_id")?).await?),
        "xpro_create_deck" => {
            let columns = arg(args, "columns").cloned().unwrap_or_else(|| json!([]));
            let id = client.xpro_create_deck(arg_str(args, "name")?, columns).await?;
            Ok(json!({ "deck_id": id }))
        },
        "xpro_update_deck" => {
            let config: XProDeckConfig = from_json(arg_value(args, "config")?, "config")?;
            client.xpro_update_deck(arg_str(args, "deck_id")?, &config).await
        },
        "xpro_remove_deck" => client.xpro_remove_deck(arg_str(args, "deck_id")?).await,
        "xpro_reorder_decks" => {
            client
                .graphql(
                    "ReorderDecks",
                    json!({ "deckIds": arg_str_list(args, "deck_ids")? }),
                    None,
                )
                .await
        },
        "xpro_create_column" => {
            let vars = json!({ "deckId": arg_str(args, "deck_id")?, "column": arg_value(args, "column")? });
            client.graphql("CreateColumn", vars, None).await
        },
        "xpro_update_column" => {
            let vars = json!({
                "deckId": arg_str(args, "deck_id")?,
                "columnId": arg_str(args, "column_id")?,
                "column": arg_value(args, "column")?,
            });
            client.graphql("UpdateColumn", vars, None).await
        },
        "xpro_remove_column" => {
            let vars = json!({
                "deckId": arg_str(args, "deck_id")?,
                "columnId": arg_str(args, "column_id")?,
            });
            client.graphql("RemoveColumn", vars, None).await
        },
        "xpro_reorder_columns" => {
            let vars = json!({
                "deckId": arg_str(args, "deck_id")?,
                "columnIds": arg_str_list(args, "column_ids")?,
            });
            client.graphql("ReorderColumns", vars, None).await
        },
        "xpro_import_client_sync_columns" => {
            client.graphql("GryphonImportClientSyncColumns", json!({}), None).await
        },
        "xpro_probe" => Ok(match client.probe_xpro_access().await {
            Ok((ok, deck_count, active)) => json!({
                "ok": ok,
                "deck_count": deck_count,
                "active_deck_id": active,
                "graphql_ops": GRYPHON_GRAPHQL_OPS,
            }),
            Err(error) => json!({
                "ok": false,
                "deck_count": 0,
                "graphql_ops": GRYPHON_GRAPHQL_OPS,
                "error": error.to_string(),
            }),
        }),

        // -- raw ---------------------------------------------------------------
        "graphql" => {
            let operation = arg_str(args, "operation")?;
            let variables = arg(args, "variables").cloned().unwrap_or_else(|| json!({}));
            let extra = arg(args, "features").filter(|f| f.is_object()).cloned();
            if arg_bool(args, "wait", false)? {
                let max_wait = Duration::from_secs(arg_u64(args, "max_wait_secs", 900)?);
                client.graphql_waiting(operation, variables, extra, max_wait).await
            } else {
                client.graphql(operation, variables, extra).await
            }
        },
        "request" => request_op(client, args).await,

        // -- maintenance --------------------------------------------------------
        "query_ids_refresh" => {
            let names: Vec<String> = if arg(args, "operations").is_some() {
                arg_str_list(args, "operations")?
            } else {
                catalog::all().iter().map(|o| o.name.clone()).collect()
            };
            let targets: Vec<&str> = names.iter().map(String::as_str).collect();
            let snapshot =
                client.query_ids().refresh(&targets, arg_bool(args, "force", true)?).await?;
            Ok(snapshot_json(client.query_ids().cache_path(), &snapshot))
        },
        other => Err(invalid(format!("operation `{other}` has no implementation"))),
    }
}

// ---------------------------------------------------------------------------
// Envelopes and the runner
// ---------------------------------------------------------------------------

/// How [`execute`] runs one operation.
#[derive(Debug, Clone)]
pub struct RunOptions {
    /// Retry and waiting policy.
    pub retry: RetryPolicy,
    /// Pacing of mutating operations (shared by every call of a batch).
    pub pacing: Option<Arc<Pacer>>,
    /// Longest one HTTP request may take (a rate-limit wait is allowed on top of it).
    pub timeout: Duration,
    /// Whether the call belongs to a batch (batches wait out rate limits for mutations too, unless
    /// the policy says otherwise).
    pub batch: bool,
}

impl Default for RunOptions {
    fn default() -> Self {
        Self {
            retry: RetryPolicy::default(),
            pacing: None,
            timeout: Duration::from_secs(120),
            batch: false,
        }
    }
}

fn id_value(id: Option<&str>) -> Value {
    id.map_or(Value::Null, |id| Value::String(id.to_owned()))
}

fn millis(elapsed: Duration) -> u64 {
    u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
}

/// The envelope of a success.
pub fn ok_envelope(
    op: &str,
    id: Option<&str>,
    data: Value,
    rate_limit: Option<RateLimit>,
    attempts: u32,
    elapsed: Duration,
) -> Value {
    json!({
        "ok": true,
        "op": op,
        "id": id_value(id),
        "data": data,
        "rate_limit": rate_limit,
        "attempts": attempts,
        "elapsed_ms": millis(elapsed),
    })
}

/// The envelope of a failure.
pub fn error_envelope(
    op: &str,
    id: Option<&str>,
    error: &ErrorInfo,
    rate_limit: Option<RateLimit>,
    attempts: u32,
    elapsed: Duration,
) -> Value {
    json!({
        "ok": false,
        "op": op,
        "id": id_value(id),
        "error": error,
        "rate_limit": rate_limit,
        "attempts": attempts,
        "elapsed_ms": millis(elapsed),
    })
}

/// Whether an envelope is a result that running the operation again cannot improve: a success or a
/// `terminal` / `invalid` failure. A batch replays these from its checkpoint instead of re-running them.
pub fn envelope_is_final(envelope: &Value) -> bool {
    if envelope.get("ok").and_then(Value::as_bool) == Some(true) {
        return true;
    }
    matches!(envelope.pointer("/error/kind").and_then(Value::as_str), Some("terminal" | "invalid"))
}

/// The error kind of a failed envelope.
pub fn envelope_kind(envelope: &Value) -> Option<ErrorKind> {
    match envelope.pointer("/error/kind").and_then(Value::as_str)? {
        "auth" => Some(ErrorKind::Auth),
        "terminal" => Some(ErrorKind::Terminal),
        "rate_limit" => Some(ErrorKind::RateLimit),
        "transient" => Some(ErrorKind::Transient),
        "invalid" => Some(ErrorKind::Invalid),
        _ => Some(ErrorKind::Other),
    }
}

/// Run a pure or local operation and wrap it in an envelope (the synchronous entry of the FFI).
pub fn execute_local(client: Option<&XClient>, id: Option<&str>, op: &str, args: &Value) -> Value {
    let started = Instant::now();
    let outcome = match spec(op) {
        None => Err(invalid(format!("unknown operation `{op}`"))),
        Some(spec) if spec.kind == OpKind::Network => {
            Err(invalid(format!("`{op}` is a network operation: submit it as a job")))
        },
        Some(spec) if spec.needs_client && client.is_none() => {
            Err(invalid(format!("operation `{op}` needs an open client (a session)")))
        },
        Some(_) => run_local(OpContext { client }, op, args),
    };
    match outcome {
        Ok(data) => ok_envelope(op, id, data, None, 1, started.elapsed()),
        Err(error) => error_envelope(op, id, &classify(&error), None, 1, started.elapsed()),
    }
}

/// Run one operation of any kind with retry, rate-limit waiting and pacing, and return its envelope.
///
/// * `auth`, `terminal` and `invalid` failures end the call at once.
/// * `rate_limit` waits for the window (until the reset epoch the failure or the headers gave,
///   bounded by `max_wait_secs`) and retries without spending a retry; mutating operations wait in a
///   batch (or when [`RetryPolicy::wait_rate_limit_mutations`] is set), otherwise the throttle is
///   reported so a caller with its own governor stays in control.
/// * `transient` and `other` failures retry with exponential backoff, for idempotent operations (or
///   failures that provably did not reach the handler).
pub async fn execute(
    client: Option<&XClient>,
    id: Option<&str>,
    op: &str,
    args: &Value,
    options: &RunOptions,
) -> Value {
    let started = Instant::now();
    let Some(spec) = spec(op) else {
        let error = ErrorInfo::invalid(format!("unknown operation `{op}`"));
        return error_envelope(op, id, &error, None, 0, started.elapsed());
    };
    if spec.needs_client && client.is_none() {
        let error =
            ErrorInfo::invalid(format!("operation `{op}` needs an open client (a session)"));
        return error_envelope(op, id, &error, None, 0, started.elapsed());
    }
    if spec.kind != OpKind::Network {
        return execute_local(client, id, op, args);
    }

    let mutating = is_mutating(op, args);
    let idempotent = is_idempotent(op, args);
    let policy = &options.retry;
    let wait_allowed = !mutating || policy.wait_rate_limit_mutations.unwrap_or(options.batch);
    let soft_wait =
        if wait_allowed { Duration::from_secs(policy.max_wait_secs) } else { Duration::ZERO };
    // Each HTTP request is capped at `timeout` (see CallScope); this outer bound is a safety net for
    // operations that make several requests (queryId recovery, pagination helpers) plus the waits.
    let attempt_timeout = options.timeout * 4 + soft_wait;
    let pacer = options.pacing.as_ref().filter(|_| mutating);

    let mut attempts = 0u32;
    let mut retries = 0u32;
    let mut rate_limit_waits = 0u32;
    let mut last_rate_limit: Option<RateLimit> = None;
    loop {
        attempts += 1;
        if let Some(pacer) = pacer {
            pacer.acquire().await;
        }
        let scope = Arc::new(CallScope::new(soft_wait).with_request_timeout(options.timeout));
        let call = with_call_scope(scope.clone(), run(OpContext { client }, op, args));
        let outcome = match tokio::time::timeout(attempt_timeout, call).await {
            Ok(result) => result.map_err(|error| classify(&error)),
            Err(_) => Err(ErrorInfo::timeout(attempt_timeout.as_millis())),
        };
        if let Some(observed) = scope.observed() {
            last_rate_limit = Some(observed);
            if let Some(pacer) = pacer {
                pacer.observe(Some(observed));
            }
        }
        let mut info = match outcome {
            Ok(data) => {
                return ok_envelope(op, id, data, last_rate_limit, attempts, started.elapsed());
            },
            Err(info) => info,
        };
        // A throttle without its own reset (code 88, a bare 429) is waited out until the window the
        // response headers announced.
        if info.kind == ErrorKind::RateLimit && info.reset_epoch.is_none() {
            info.reset_epoch = last_rate_limit
                .filter(|limit| limit.reset_epoch > 0)
                .map(|limit| limit.reset_epoch);
        }
        let give_up = |info: &ErrorInfo| {
            error_envelope(op, id, info, last_rate_limit, attempts, started.elapsed())
        };
        match info.kind {
            ErrorKind::Auth | ErrorKind::Terminal | ErrorKind::Invalid => return give_up(&info),
            ErrorKind::RateLimit => {
                if let Some(pacer) = pacer {
                    pacer.penalise(last_rate_limit);
                }
                if !wait_allowed {
                    return give_up(&info);
                }
                rate_limit_waits += 1;
                if rate_limit_waits > policy.max_rate_limit_waits {
                    return give_up(&info);
                }
                let wait = policy.rate_limit_wait(&info, now_epoch());
                if wait > Duration::from_secs(policy.max_wait_secs) {
                    return give_up(&info);
                }
                tokio::time::sleep(wait).await;
                // A throttle is not a strike against the operation: the attempt counter keeps
                // counting, the retry budget does not.
            },
            ErrorKind::Transient | ErrorKind::Other => {
                if !policy.should_retry(&info, idempotent, retries) {
                    return give_up(&info);
                }
                retries += 1;
                tokio::time::sleep(policy.backoff(retries, jitter01())).await;
            },
        }
    }
}

#[cfg(test)]
#[path = "ops_tests.rs"]
mod tests;
