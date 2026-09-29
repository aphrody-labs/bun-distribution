// SPDX-License-Identifier: Apache-2.0
//! `aphrody ocr dbfr …` — the Dragon Ball FR databooks API, natively.
//!
//! The corpus that consumes aphrody's OCR is not a folder: it is the databooks
//! section of `dragonballfr.com`, whose API stores one text per plate. Until
//! now the round trip went through `curl` and hand-written JSON, which meant
//! the safety rules of a deposit — never send a blank text, never send a page
//! the model could not read, never re-send what is already there — lived in
//! whatever shell line was typed that day.
//!
//! This module makes that round trip a command. Reads are public; writes carry
//! `Authorization: Bearer` and go through the API's own `merge` mode, which
//! only touches the plates named in the body and records a revision.
//!
//! # Deposit safety
//!
//! A push sends **only** pages whose stored status is `text`. A `no-text`,
//! `unreadable`, `needs-review` or `processing-error` page is counted and
//! reported, never sent: the API treats a blank text as "nothing to say" and
//! would otherwise let a failed read look like a completed one. And a push is
//! a dry run unless `--apply` is passed — a deposit into a public corpus is
//! not something a mistyped identifier should be able to do.

use std::path::{Path, PathBuf};

use aphrody_ocr::ocr_core::{OcrStatus, store::OcrStore};

/// Default site. Overridden by `$DBFR_BASE_URL` for a staging instance.
const DEFAULT_BASE_URL: &str = "https://dragonballfr.com";

/// Actions for `aphrody ocr dbfr`.
#[derive(clap::Subcommand, Debug, Clone)]
pub(crate) enum DbfrAction {
    /// List databook records.
    ///
    /// Example: aphrody ocr dbfr list --limit 5 --include-hidden
    List {
        /// Free-text query passed to the API.
        #[arg(long)]
        q: Option<String>,
        /// Maximum records to return. The API caps this at 200.
        #[arg(long, default_value_t = 20)]
        limit: u32,
        /// Skip this many records, for paging past the API's cap.
        #[arg(long, default_value_t = 0)]
        offset: u32,
        /// Include records not published publicly. Requires a token.
        #[arg(long)]
        include_hidden: bool,
        #[command(flatten)]
        output: crate::model_cmd::OutputOpts,
    },
    /// Report transcription progress across the whole corpus.
    ///
    /// Pages through every record — the API serves at most 200 per call — and
    /// counts plates, transcriptions and gaps. This is what says how much OCR
    /// work is left, and where.
    ///
    /// Example: aphrody ocr dbfr survey --include-hidden --top 20
    Survey {
        /// Include records not published publicly. Requires a token.
        #[arg(long)]
        include_hidden: bool,
        /// How many of the least-transcribed records to list.
        #[arg(long, default_value_t = 15)]
        top: usize,
        #[command(flatten)]
        output: crate::model_cmd::OutputOpts,
    },
    /// Report one record's plates: how many carry an image, and how many are
    /// still missing a transcription.
    ///
    /// Example: aphrody ocr dbfr pages 42
    Pages {
        /// Databook identifier.
        id: u64,
        /// List the plates that have an image and no text.
        #[arg(long)]
        missing: bool,
        #[command(flatten)]
        output: crate::model_cmd::OutputOpts,
    },
    /// Read the stored text of specific plates.
    ///
    /// Example: aphrody ocr dbfr textes 42 --pages 12,13,14
    Textes {
        /// Databook identifier.
        id: u64,
        /// Comma-separated plate numbers. The API serves at most 40.
        #[arg(long)]
        pages: String,
        #[command(flatten)]
        output: crate::model_cmd::OutputOpts,
    },
    /// Download a record's plate images into a lot directory, ready for OCR.
    ///
    /// Each file is named by its plate number, which is exactly what `push`
    /// reads back — so `fetch`, `batch` and `push` round-trip without a
    /// side-car mapping that could drift.
    ///
    /// Example: aphrody ocr dbfr fetch 22 --dir ./lots/22
    Fetch {
        /// Databook identifier.
        id: u64,
        /// Directory to fill. Created if needed.
        ///
        /// Named `--dir` rather than `--out`: `--out` is the global report
        /// destination, and one flag cannot mean two things.
        #[arg(long)]
        dir: PathBuf,
        /// Download every plate, not only those still missing a transcription.
        #[arg(long)]
        all: bool,
        /// Stop after this many downloads.
        #[arg(long)]
        limit: Option<usize>,
        #[command(flatten)]
        output: crate::model_cmd::OutputOpts,
    },
    /// Download every plate still missing a transcription, corpus-wide.
    ///
    /// One directory per record (`<root>/<id>/NNNN.jpg`), so each lot stays a
    /// unit that `batch` reads and `push <id> --lot` deposits back. Records
    /// with no gap are skipped, and files already on disk are kept, so this is
    /// safe to re-run as the corpus fills.
    ///
    /// Example: aphrody ocr dbfr fetch-all --dir ./var/ocr-lots
    FetchAll {
        /// Root directory to fill.
        #[arg(long)]
        dir: PathBuf,
        /// Include records not published publicly. Requires a token.
        #[arg(long)]
        include_hidden: bool,
        /// Stop after this many records.
        #[arg(long)]
        records: Option<usize>,
        #[command(flatten)]
        output: crate::model_cmd::OutputOpts,
    },
    /// Deposit transcriptions from the local OCR corpus into one record.
    ///
    /// The plate number is taken from the digits at the end of the image file
    /// name, which is how a lot exported for OCR is named. A page whose number
    /// cannot be read is reported, never guessed.
    ///
    /// Example: aphrody ocr dbfr push 42 --lot ./lot-042/images --apply
    Push {
        /// Databook identifier.
        id: u64,
        /// Only deposit pages whose stored path starts with this directory.
        /// Without it, every stored page is a candidate, which is almost never
        /// what one record wants.
        #[arg(long)]
        lot: Option<PathBuf>,
        /// Send the deposit. Without it the command reports what it would send
        /// and touches nothing.
        #[arg(long)]
        apply: bool,
        /// Overwrite the whole plate array instead of merging. Reserved for a
        /// full re-transcription: it drops plates absent from the body.
        #[arg(long)]
        replace: bool,
        /// Stop after this many pages.
        #[arg(long)]
        limit: Option<usize>,
        /// Corpus database. Defaults to `<state>/ocr/results.db`.
        #[arg(long)]
        db: Option<PathBuf>,
        #[command(flatten)]
        output: crate::model_cmd::OutputOpts,
    },
}

/// Base URL of the site, without a trailing slash.
fn base_url() -> String {
    std::env::var("DBFR_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_owned())
        .trim_end_matches('/')
        .to_owned()
}

/// The bearer token, from `$DBFR_TOKEN` then `$SHENRON_ADMIN_TOKEN`.
///
/// The token is never read from a file here: a command that goes looking
/// through a peer repository for a secret is a command that can pick up the
/// wrong one.
fn token() -> Option<String> {
    for name in ["DBFR_TOKEN", "SHENRON_ADMIN_TOKEN"] {
        if let Ok(value) = std::env::var(name) {
            let value = value.trim().to_owned();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

/// Require a token, naming both variables so the fix is obvious.
fn require_token() -> miette::Result<String> {
    token()
        .ok_or_else(|| miette::miette!("no API token: set $DBFR_TOKEN (or $SHENRON_ADMIN_TOKEN)"))
}

fn client() -> miette::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("aphrody/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| miette::miette!("build HTTP client: {e}"))
}

/// GET a JSON endpoint, attaching the token when there is one.
async fn get_json(path: &str, authenticated: bool) -> miette::Result<serde_json::Value> {
    let url = format!("{}{path}", base_url());
    let mut request = client()?.get(&url);
    if authenticated {
        request = request.bearer_auth(require_token()?);
    } else if let Some(token) = token() {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(|e| miette::miette!("GET {url}: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| miette::miette!("GET {url}: {e}"))?;
    if !status.is_success() {
        return Err(miette::miette!("GET {url}: HTTP {status}: {body}"));
    }
    serde_json::from_str(&body).map_err(|e| miette::miette!("GET {url}: invalid JSON: {e}"))
}

/// Run a `dbfr` action.
pub(crate) async fn run(action: DbfrAction) -> miette::Result<()> {
    match action {
        DbfrAction::List { q, limit, offset, include_hidden, output } => {
            list(q.as_deref(), limit, offset, include_hidden, &output).await
        },
        DbfrAction::Survey { include_hidden, top, output } => {
            survey(include_hidden, top, &output).await
        },
        DbfrAction::Pages { id, missing, output } => pages(id, missing, &output).await,
        DbfrAction::Fetch { id, dir, all, limit, output } => {
            fetch(id, &dir, all, limit, &output).await
        },
        DbfrAction::FetchAll { dir, include_hidden, records, output } => {
            fetch_all(&dir, include_hidden, records, &output).await
        },
        DbfrAction::Textes { id, pages, output } => textes(id, &pages, &output).await,
        DbfrAction::Push { id, lot, apply, replace, limit, db, output } => {
            push(id, lot.as_deref(), apply, replace, limit, db.as_deref(), &output).await
        },
    }
}

/// Count plates, images and transcriptions in one record.
///
/// A plate with an image and no text is the unit of remaining work; a plate
/// without an image is not something OCR can fix, so the two are counted
/// apart rather than folded into one "missing".
fn tally(record: &serde_json::Value) -> (usize, usize, usize) {
    let plates =
        record.get("pages").and_then(serde_json::Value::as_array).map_or(&[][..], Vec::as_slice);
    let mut with_image = 0;
    let mut transcribed = 0;
    for plate in plates {
        if plate.get("image").and_then(serde_json::Value::as_str).is_some() {
            with_image += 1;
        }
        if plate
            .get("text")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|text| !text.trim().is_empty())
        {
            transcribed += 1;
        }
    }
    (plates.len(), with_image, transcribed)
}

/// Fetch every record, paging past the API's per-call cap.
async fn all_records(include_hidden: bool) -> miette::Result<Vec<serde_json::Value>> {
    /// The API's own ceiling. Asking for more is silently truncated, which is
    /// how a survey ends up reporting a fraction of the corpus as the whole.
    const PAGE: u32 = 200;

    if include_hidden {
        require_token()?;
    }
    let mut records = Vec::new();
    let mut offset = 0_u32;
    loop {
        let mut path = format!("/api/databooks?limit={PAGE}&offset={offset}");
        if include_hidden {
            path.push_str("&includeHidden=1");
        }
        let json = get_json(&path, include_hidden).await?;
        let items =
            json.get("items").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
        let fetched = u32::try_from(items.len()).unwrap_or(0);
        records.extend(items);
        let total = json.get("total").and_then(serde_json::Value::as_u64).unwrap_or(0);
        offset += fetched;
        if fetched == 0 || u64::from(offset) >= total {
            break;
        }
    }
    Ok(records)
}

async fn survey(
    include_hidden: bool,
    top: usize,
    output: &crate::model_cmd::OutputOpts,
) -> miette::Result<()> {
    let records = all_records(include_hidden).await?;
    let mut rows: Vec<(u64, String, usize, usize, usize)> = Vec::with_capacity(records.len());
    let (mut plates, mut with_image, mut transcribed) = (0_usize, 0_usize, 0_usize);
    for record in &records {
        let (record_plates, record_images, record_text) = tally(record);
        plates += record_plates;
        with_image += record_images;
        transcribed += record_text;
        rows.push((
            record.get("id").and_then(serde_json::Value::as_u64).unwrap_or(0),
            record.get("title").and_then(serde_json::Value::as_str).unwrap_or("-").to_owned(),
            record_plates,
            record_images,
            record_text,
        ));
    }
    let missing = with_image.saturating_sub(transcribed);

    rows.sort_by_key(|row| std::cmp::Reverse(row.3.saturating_sub(row.4)));
    let mut table = aphrody_models::Report::new(
        "Databooks transcription",
        &["ID", "MISSING", "PLATES", "TITLE"],
    )
    .with_summary(format!(
        "{} record(s), {plates} plate(s), {with_image} with an image, {transcribed} transcribed, \
         {missing} still missing",
        records.len()
    ))
    .with_footer(if include_hidden {
        "public and hidden records".to_owned()
    } else {
        "public records only — pass --include-hidden for the whole corpus".to_owned()
    });
    for (id, title, record_plates, record_images, record_text) in rows.iter().take(top) {
        let gap = record_images.saturating_sub(*record_text);
        if gap == 0 {
            break;
        }
        table.push(vec![id.to_string(), gap.to_string(), record_plates.to_string(), title.clone()]);
    }

    let json = serde_json::json!({
        "records": records.len(),
        "plates": plates,
        "withImage": with_image,
        "transcribed": transcribed,
        "missing": missing,
        "worst": rows.iter()
            .filter(|row| row.3 > row.4)
            .take(top)
            .map(|(id, title, plates, images, text)| serde_json::json!({
                "id": id,
                "title": title,
                "plates": plates,
                "withImage": images,
                "transcribed": text,
                "missing": images - text,
            }))
            .collect::<Vec<_>>(),
    });
    output.emit_report(&table, &json)
}

async fn list(
    q: Option<&str>,
    limit: u32,
    offset: u32,
    include_hidden: bool,
    output: &crate::model_cmd::OutputOpts,
) -> miette::Result<()> {
    let mut path = format!("/api/databooks?limit={limit}&offset={offset}");
    if let Some(q) = q {
        path.push_str(&format!("&q={}", urlencode(q)));
    }
    if include_hidden {
        // The API only honours this for a bearer call; asking without a token
        // would silently return the public subset instead.
        require_token()?;
        path.push_str("&includeHidden=1");
    }
    let json = get_json(&path, include_hidden).await?;
    let items =
        json.get("items").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
    // The API caps a page at `limitMax` and says how many records match. Both
    // are reported: a listing that shows 200 of 370 without saying so reads as
    // the whole corpus.
    let total = json.get("total").and_then(serde_json::Value::as_u64).unwrap_or(0);
    let mut table = aphrody_models::Report::new("Databooks", &["ID", "TITLE", "VISIBLE", "PAGES"])
        .with_summary(format!(
            "{} record(s) shown, offset {offset}, {total} matching — `survey` counts them all",
            items.len()
        ));
    for item in &items {
        table.push(vec![
            item.get("id").map_or_else(|| "-".to_owned(), ToString::to_string),
            item.get("title").and_then(serde_json::Value::as_str).unwrap_or("-").to_owned(),
            item.get("visible").map_or_else(|| "-".to_owned(), ToString::to_string),
            item.get("pages")
                .and_then(serde_json::Value::as_array)
                .map_or_else(|| "-".to_owned(), |pages| pages.len().to_string()),
        ]);
    }
    output.emit_report(&table, &json)
}

async fn pages(
    id: u64,
    missing: bool,
    output: &crate::model_cmd::OutputOpts,
) -> miette::Result<()> {
    let record = get_json(&format!("/api/databooks/{id}"), false).await?;
    let plates =
        record.get("pages").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();

    let mut with_image = 0_usize;
    let mut with_text = 0_usize;
    let mut gaps = Vec::new();
    for plate in &plates {
        let number = plate.get("number").and_then(serde_json::Value::as_u64);
        let has_image = plate.get("image").and_then(serde_json::Value::as_str).is_some();
        let has_text = plate
            .get("text")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|text| !text.trim().is_empty());
        if has_image {
            with_image += 1;
        }
        if has_text {
            with_text += 1;
        } else if has_image {
            if let Some(number) = number {
                gaps.push(number);
            }
        }
    }

    let mut table = aphrody_models::Report::new(format!("Databook {id}"), &["FIELD", "VALUE"])
        .with_summary(format!(
            "{} plate(s), {with_image} with an image, {with_text} transcribed, {} still missing",
            plates.len(),
            gaps.len()
        ));
    table.push(vec![
        "title".into(),
        record.get("title").and_then(serde_json::Value::as_str).unwrap_or("-").to_owned(),
    ]);
    table.push(vec!["plates".into(), plates.len().to_string()]);
    table.push(vec!["transcribed".into(), with_text.to_string()]);
    table.push(vec!["missing".into(), gaps.len().to_string()]);
    if missing {
        for number in &gaps {
            table.push(vec!["missing plate".into(), number.to_string()]);
        }
    }
    let json = serde_json::json!({
        "id": id,
        "plates": plates.len(),
        "withImage": with_image,
        "transcribed": with_text,
        "missing": gaps,
    });
    output.emit_report(&table, &json)
}

async fn textes(id: u64, pages: &str, output: &crate::model_cmd::OutputOpts) -> miette::Result<()> {
    let json =
        get_json(&format!("/api/databooks/{id}/textes?pages={}", urlencode(pages)), false).await?;
    let items =
        json.get("pages").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
    let mut table =
        aphrody_models::Report::new(format!("Databook {id} — plates"), &["PLATE", "TEXT"])
            .with_summary(format!("{} plate(s)", items.len()));
    for item in &items {
        table.push(vec![
            item.get("number").map_or_else(|| "-".to_owned(), ToString::to_string),
            item.get("text").and_then(serde_json::Value::as_str).unwrap_or("").to_owned(),
        ]);
    }
    output.emit_report(&table, &json)
}

/// Absolute URL of a plate image.
///
/// The database stores `./assets/wiki/databooks/<uuid>.jpg`, which the site
/// serves under `/wiki/…` (a rewrite to the media host). `$DBFR_MEDIA_BASE_URL`
/// overrides the prefix for an instance that serves media elsewhere.
fn media_url(stored: &str) -> String {
    if stored.starts_with("http://") || stored.starts_with("https://") {
        return stored.to_owned();
    }
    let relative = stored.trim_start_matches("./").trim_start_matches('/');
    let relative = relative.strip_prefix("assets/wiki/").unwrap_or(relative);
    let prefix = std::env::var("DBFR_MEDIA_BASE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("{}/wiki", base_url()));
    format!("{}/{relative}", prefix.trim_end_matches('/'))
}

/// What one record's download did.
#[derive(Debug, Default)]
struct FetchCounts {
    downloaded: usize,
    already: usize,
    skipped_transcribed: usize,
    skipped_no_image: usize,
    failed: Vec<String>,
}

/// Download one record's plates into `out`, named by plate number.
async fn fetch_record(
    client: &reqwest::Client,
    record: &serde_json::Value,
    out: &Path,
    all: bool,
    limit: Option<usize>,
) -> miette::Result<FetchCounts> {
    let plates =
        record.get("pages").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
    std::fs::create_dir_all(out).map_err(|e| miette::miette!("create {}: {e}", out.display()))?;

    let mut downloaded = 0_usize;
    let mut already = 0_usize;
    let mut skipped_transcribed = 0_usize;
    let mut skipped_no_image = 0_usize;
    let mut failed: Vec<String> = Vec::new();

    for plate in &plates {
        let Some(number) = plate.get("number").and_then(serde_json::Value::as_u64) else {
            continue;
        };
        let Some(stored) = plate.get("image").and_then(serde_json::Value::as_str) else {
            skipped_no_image += 1;
            continue;
        };
        let transcribed = plate
            .get("text")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|text| !text.trim().is_empty());
        if transcribed && !all {
            skipped_transcribed += 1;
            continue;
        }
        let extension =
            Path::new(stored).extension().and_then(|extension| extension.to_str()).unwrap_or("jpg");
        let target = out.join(format!("{number:04}.{extension}"));
        if target.exists() {
            // Resumable by construction: a lot half-downloaded before an
            // interruption is finished, not fetched again.
            already += 1;
            continue;
        }
        let url = media_url(stored);
        let bytes = async {
            let response = client.get(&url).send().await?;
            let status = response.status();
            let bytes = response.bytes().await?;
            Ok::<_, reqwest::Error>((status, bytes))
        }
        .await;
        match bytes {
            Ok((status, bytes)) if status.is_success() && !bytes.is_empty() => {
                std::fs::write(&target, &bytes)
                    .map_err(|e| miette::miette!("write {}: {e}", target.display()))?;
                downloaded += 1;
            },
            Ok((status, _)) => failed.push(format!("plate {number}: HTTP {status}")),
            Err(e) => failed.push(format!("plate {number}: {e}")),
        }
        if limit.is_some_and(|limit| downloaded >= limit) {
            break;
        }
    }

    Ok(FetchCounts { downloaded, already, skipped_transcribed, skipped_no_image, failed })
}

async fn fetch(
    id: u64,
    out: &Path,
    all: bool,
    limit: Option<usize>,
    output: &crate::model_cmd::OutputOpts,
) -> miette::Result<()> {
    let record = get_json(&format!("/api/databooks/{id}"), false).await?;
    let plates = record.get("pages").and_then(serde_json::Value::as_array).map_or(0, Vec::len);
    let FetchCounts { downloaded, already, skipped_transcribed, skipped_no_image, failed } =
        fetch_record(&client()?, &record, out, all, limit).await?;

    let mut table =
        aphrody_models::Report::new(format!("Databook {id} images"), &["FIELD", "VALUE"])
            .with_summary(format!(
                "{downloaded} downloaded, {already} already on disk, {skipped_transcribed} \
                 already transcribed, {skipped_no_image} without an image, {} failed",
                failed.len()
            ));
    table.push(vec!["directory".into(), out.display().to_string()]);
    table.push(vec!["plates".into(), plates.to_string()]);
    for failure in failed.iter().take(10) {
        table.push(vec!["failed".into(), failure.clone()]);
    }

    let json = serde_json::json!({
        "id": id,
        "directory": out.display().to_string(),
        "downloaded": downloaded,
        "already": already,
        "skippedTranscribed": skipped_transcribed,
        "skippedNoImage": skipped_no_image,
        "failed": failed,
    });
    output.emit_report(&table, &json)
}

async fn fetch_all(
    root: &Path,
    include_hidden: bool,
    records_limit: Option<usize>,
    output: &crate::model_cmd::OutputOpts,
) -> miette::Result<()> {
    let records = all_records(include_hidden).await?;
    let client = client()?;
    let mut table = aphrody_models::Report::new(
        "Databooks images",
        &["ID", "DOWNLOADED", "ON DISK", "FAILED", "TITLE"],
    );
    let mut lots = Vec::new();
    let (mut downloaded, mut already, mut failures) = (0_usize, 0_usize, 0_usize);
    let mut touched = 0_usize;

    for record in &records {
        let (_, with_image, transcribed) = tally(record);
        // A record with no gap has nothing to download; skipping it keeps the
        // report about the work that remains.
        if with_image <= transcribed {
            continue;
        }
        let Some(id) = record.get("id").and_then(serde_json::Value::as_u64) else {
            continue;
        };
        let dir = root.join(id.to_string());
        let counts = fetch_record(&client, record, &dir, false, None).await?;
        downloaded += counts.downloaded;
        already += counts.already;
        failures += counts.failed.len();
        touched += 1;
        table.push(vec![
            id.to_string(),
            counts.downloaded.to_string(),
            counts.already.to_string(),
            counts.failed.len().to_string(),
            record.get("title").and_then(serde_json::Value::as_str).unwrap_or("-").to_owned(),
        ]);
        lots.push(serde_json::json!({
            "id": id,
            "directory": dir.display().to_string(),
            "downloaded": counts.downloaded,
            "already": counts.already,
            "failed": counts.failed,
        }));
        if records_limit.is_some_and(|limit| touched >= limit) {
            break;
        }
    }

    let table = table.with_summary(format!(
        "{touched} record(s) with a gap — {downloaded} plate(s) downloaded, {already} already on \
         disk, {failures} failed"
    ));
    let json = serde_json::json!({
        "root": root.display().to_string(),
        "records": touched,
        "downloaded": downloaded,
        "already": already,
        "failed": failures,
        "lots": lots,
    });
    output.emit_report(&table, &json)
}

/// The trailing digits of a file stem, which is the plate number in an
/// exported lot. Returns `None` rather than a guess when there are none.
pub(crate) fn plate_number(path: &Path) -> Option<u64> {
    let stem = path.file_stem()?.to_str()?;
    let digits: String = stem
        .chars()
        .rev()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    digits.parse().ok()
}

/// Percent-encode a query value. Plate lists and search terms are the only
/// values passed here, so the unreserved set is enough.
fn urlencode(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b',' => {
                encoded.push(byte as char);
            },
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[allow(clippy::too_many_lines)]
async fn push(
    id: u64,
    lot: Option<&Path>,
    apply: bool,
    replace: bool,
    limit: Option<usize>,
    db: Option<&Path>,
    output: &crate::model_cmd::OutputOpts,
) -> miette::Result<()> {
    let db_path = match db {
        Some(path) => path.to_path_buf(),
        None => aphrody_models::paths::ocr_dir()
            .map_err(|e| miette::miette!("locate the aphrody state directory: {e}"))?
            .join("results.db"),
    };
    let store =
        OcrStore::open(&db_path).map_err(|e| miette::miette!("open {}: {e}", db_path.display()))?;
    let stored = store
        .list(&aphrody_ocr::ocr_core::store::ListFilter::default())
        .map_err(|e| miette::miette!("{e}"))?;

    let mut payload = Vec::new();
    let mut skipped_status = 0_usize;
    let mut skipped_lot = 0_usize;
    let mut skipped_number = 0_usize;
    let mut skipped_empty = 0_usize;

    for page in &stored {
        if let Some(lot) = lot {
            if !page.path.starts_with(lot) {
                skipped_lot += 1;
                continue;
            }
        }
        if page.status != OcrStatus::Text {
            // Counted, not dropped: a corpus deposit that silently omits the
            // pages it refused hides exactly the pages worth looking at.
            skipped_status += 1;
            continue;
        }
        let Some(number) = plate_number(&page.path) else {
            skipped_number += 1;
            continue;
        };
        let record = store
            .record(&page.page_id, None)
            .map_err(|e| miette::miette!("{e}"))?
            .or(store.record(&page.page_id, Some("")).map_err(|e| miette::miette!("{e}"))?);
        let text = record.as_ref().and_then(|record| {
            record.markdown.clone().or_else(|| {
                let joined = record
                    .blocks
                    .iter()
                    .map(|block| block.text.as_str())
                    .collect::<Vec<_>>()
                    .join("\n");
                (!joined.trim().is_empty()).then_some(joined)
            })
        });
        match text {
            Some(text) if !text.trim().is_empty() => {
                payload.push(serde_json::json!({ "number": number, "text": text }));
            },
            // A page marked `text` whose text is empty is a contradiction, not
            // a plate to blank out on the site.
            _ => skipped_empty += 1,
        }
        if limit.is_some_and(|limit| payload.len() >= limit) {
            break;
        }
    }

    let mode = if replace { "replace" } else { "merge" };
    let mut sent = None;
    if apply && !payload.is_empty() {
        let token = require_token()?;
        let url = format!("{}/api/databooks/{id}/transcription", base_url());
        let body = serde_json::json!({ "mode": mode, "pages": payload });
        let response = client()?
            .post(&url)
            .bearer_auth(token)
            .json(&body)
            .send()
            .await
            .map_err(|e| miette::miette!("POST {url}: {e}"))?;
        let status = response.status();
        let text = response.text().await.map_err(|e| miette::miette!("POST {url}: {e}"))?;
        if !status.is_success() {
            return Err(miette::miette!("POST {url}: HTTP {status}: {text}"));
        }
        sent = Some(
            serde_json::from_str::<serde_json::Value>(&text)
                .unwrap_or_else(|_| serde_json::Value::String(text)),
        );
    }

    let mut table =
        aphrody_models::Report::new(format!("Databook {id} deposit"), &["FIELD", "VALUE"])
            .with_summary(format!(
                "{} plate(s) ready in `{mode}` mode — {} refused (status), {} outside the lot, {} \
                 without a plate number, {} empty",
                payload.len(),
                skipped_status,
                skipped_lot,
                skipped_number,
                skipped_empty
            ))
            .with_footer(if apply {
                "deposited".to_owned()
            } else {
                "dry run — pass --apply to deposit".to_owned()
            });
    table.push(vec!["database".into(), db_path.display().to_string()]);
    table.push(vec!["mode".into(), mode.to_owned()]);
    table.push(vec!["plates".into(), payload.len().to_string()]);
    for plate in payload.iter().take(10) {
        table.push(vec![
            format!("plate {}", plate.get("number").map_or_else(String::new, ToString::to_string)),
            plate
                .get("text")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("")
                .chars()
                .take(60)
                .collect(),
        ]);
    }

    let json = serde_json::json!({
        "id": id,
        "mode": mode,
        "applied": apply,
        "plates": payload.len(),
        "skipped": {
            "status": skipped_status,
            "lot": skipped_lot,
            "number": skipped_number,
            "empty": skipped_empty,
        },
        "response": sent,
    });
    output.emit_report(&table, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plate_number_comes_from_the_trailing_digits() {
        assert_eq!(plate_number(Path::new("/lot/0123.jpg")), Some(123));
        assert_eq!(plate_number(Path::new("/lot/page-007.png")), Some(7));
        assert_eq!(plate_number(Path::new("/lot/cover.jpg")), None);
    }

    #[test]
    fn a_query_value_is_encoded_without_touching_plate_lists() {
        assert_eq!(urlencode("12,13,14"), "12,13,14");
        assert_eq!(urlencode("son goku"), "son%20goku");
    }

    #[test]
    fn a_stored_asset_path_becomes_a_media_url() {
        // Serialized: these mutate the process environment.
        unsafe { std::env::set_var("DBFR_MEDIA_BASE_URL", "https://media.example/wiki/") };
        assert_eq!(
            media_url("./assets/wiki/databooks/abc.jpg"),
            "https://media.example/wiki/databooks/abc.jpg"
        );
        assert_eq!(
            media_url("assets/wiki/databooks/abc.jpg"),
            "https://media.example/wiki/databooks/abc.jpg"
        );
        unsafe { std::env::remove_var("DBFR_MEDIA_BASE_URL") };
    }

    #[test]
    fn the_base_url_has_no_trailing_slash() {
        assert!(!base_url().ends_with('/'));
    }
}
