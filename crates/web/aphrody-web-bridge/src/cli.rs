// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! The second seam: driving the `bxc` executable.
//!
//! The cdylib covers computation on bytes we already hold. Everything that
//! needs a browser, a stealth profile, a cookie jar or bxc's own cache lives
//! behind the binary, and is reached the way `aphrody-infer` reaches
//! llama.cpp and `aphrody-voice` reaches whisper.cpp: spawn the released
//! artefact, do not link it (`CLAUDE.md` §7).
//!
//! # Measured contract, and what it forces
//!
//! Against `bxc 0.9.4` on 2026-09-07:
//!
//! | invocation | exit | note |
//! |---|---|---|
//! | `recon <url> --profile static` | `0` | Markdown on stdout, prefixed by `[recon] ` progress lines |
//! | `recon <dead-domain>` | `65` | only progress lines; bxc escalates the profile by itself |
//! | `scrape <url> --markdown` | *never exits* | writes the page, then hangs |
//! | `search <q> --json` | `0` with hits, `65` with none | JSON on stdout either way |
//! | `<sub> --help` | `1` | help on stdout |
//!
//! Three consequences are baked into this module:
//!
//! 1. **Every child is bounded.** `scrape` emits its output and then never returns, so a
//!    `wait()`-shaped call would pin a worker forever. Runs carry a deadline and, on expiry, the
//!    child is killed and whatever reached stdout is kept - a killed child that already produced
//!    the page is a success with an asterisk, not a failure.
//! 2. **A non-zero exit is never read as "bxc is missing".** `--help` exits 1 and an empty SERP
//!    exits 65; conflating either with an absent install is how a working tool gets reported as
//!    uninstalled.
//! 3. **stderr is not an error channel.** bxc logs Redis connection failures there on every run and
//!    carries on. Only the exit code and stdout are load-bearing; stderr is carried for diagnostics
//!    and nothing else.

use std::{path::Path, time::Duration};

use crate::{
    error::{BxcError, Result},
    resolve::{self, Source},
};

/// A bxc fetch profile.
///
/// bxc escalates on its own when a profile fails (`static` -> `http` ->
/// `fast` -> `stealth` -> `max`), so this is a starting point, not a
/// guarantee - which is why [`Run`] reports what actually happened rather
/// than assuming the request was honoured.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Profile {
    /// Plain HTTP, no browser.
    Static,
    /// Fast browser path.
    Fast,
    /// HTTP with bxc header shaping.
    Http,
    /// Anti-bot evasion.
    Stealth,
    /// Everything bxc can bring to bear.
    Max,
}

impl Profile {
    /// The spelling bxc expects on the command line.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Static => "static",
            Self::Fast => "fast",
            Self::Http => "http",
            Self::Stealth => "stealth",
            Self::Max => "max",
        }
    }

    /// Parse a profile name, case-insensitively.
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "static" => Some(Self::Static),
            "fast" => Some(Self::Fast),
            "http" => Some(Self::Http),
            "stealth" => Some(Self::Stealth),
            "max" => Some(Self::Max),
            _ => None,
        }
    }

    /// Whether this profile drives a real browser.
    ///
    /// Browser profiles need Chromium on the machine; without it bxc fails
    /// with `Process exited before emitting ws url`, a message that names
    /// neither Chromium nor the profile. Callers use this to say something
    /// more useful than bxc did.
    #[must_use]
    pub const fn needs_browser(self) -> bool {
        matches!(self, Self::Fast | Self::Stealth | Self::Max)
    }
}

/// Default budget for `recon`: measured at 31 s cold on `example.com` with no
/// Redis cache, so the budget is generous enough that a slow origin is not
/// mistaken for the known hang.
pub const RECON_BUDGET: Duration = Duration::from_secs(90);

/// Default budget for `scrape`. This one **always** expires: `scrape` does not
/// exit.
///
/// It cannot be short, and the reason is worth writing down because the obvious
/// guess is wrong. The output does *not* arrive promptly and then hang.
/// Measured on 2026-09-07 against `https://example.com`, stdout piped:
///
/// | budget | killed at | bytes on stdout |
/// |---|---|---|
/// | 20 s | 20 s | **0** |
/// | 45 s | 46 s | 177 |
/// | 75 s | 75 s | 177 |
/// | 150 s | 150 s | 177 |
///
/// The delay is bxc waiting out its Redis reconnection back-off
/// (`Max reconnection attempts reached`) on a machine with no Redis - the page
/// itself is fetched immediately. So a budget tuned to "the content is already
/// there" silently returns nothing at all. 90 s leaves headroom over the
/// 45 s that was measured sufficient.
pub const SCRAPE_BUDGET: Duration = Duration::from_secs(90);

/// Default budget for `search`.
pub const SEARCH_BUDGET: Duration = Duration::from_secs(60);

/// One completed (or killed) bxc run.
#[derive(Debug, Clone)]
pub struct Run {
    /// Arguments, for reproduction in an error message.
    pub args: Vec<String>,
    /// Exit code, absent when the child was killed or died from a signal.
    pub code: Option<i32>,
    /// stdout, lossily decoded.
    pub stdout: String,
    /// stderr, lossily decoded. Diagnostics only - see the module docs.
    pub stderr: String,
    /// Whether the deadline expired and the child was killed.
    pub timed_out: bool,
}

impl Run {
    /// Whether bxc reported success.
    #[must_use]
    pub const fn ok(&self) -> bool {
        matches!(self.code, Some(0))
    }

    /// A bounded excerpt of stderr, for attaching to an error.
    #[must_use]
    pub fn stderr_excerpt(&self) -> String {
        let trimmed = self.stderr.trim();
        if trimmed.is_empty() {
            return String::new();
        }
        let head: String = trimmed.chars().take(400).collect();
        format!("\nstderr: {head}")
    }
}

/// A located `bxc` executable.
#[derive(Debug, Clone)]
pub struct BxcCli {
    source: Source,
}

impl BxcCli {
    /// Locate `bxc`.
    ///
    /// # Errors
    ///
    /// [`BxcError::BinaryMissing`], listing every candidate that was probed.
    pub fn discover() -> Result<Self> {
        Ok(Self { source: resolve::binary()? })
    }

    /// Wrap an already-resolved path.
    #[must_use]
    pub const fn from_source(source: Source) -> Self {
        Self { source }
    }

    /// The executable.
    #[must_use]
    pub fn path(&self) -> &Path {
        self.source.path()
    }

    /// How it was found.
    #[must_use]
    pub const fn source(&self) -> &Source {
        &self.source
    }

    /// Run bxc with a deadline, capturing both streams.
    ///
    /// Returns `Ok` for any exit code: distinguishing 0 from 65 from 1 is the
    /// caller's job, and this layer refuses to flatten them. Only a spawn
    /// failure is an error here.
    ///
    /// On expiry the child is killed and the partial output is returned with
    /// `timed_out: true`, because `scrape` writes the whole page before it
    /// hangs and throwing that away would be throwing away the answer.
    ///
    /// # Errors
    ///
    /// [`BxcError::Spawn`] when the process cannot be started.
    pub async fn run(&self, args: &[String], budget: Duration) -> Result<Run> {
        use tokio::io::AsyncReadExt as _;

        let mut child = tokio::process::Command::new(self.path())
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            // Without this a task cancelled mid-run leaves a 130 MB Bun
            // standalone alive with nobody waiting on it.
            .kill_on_drop(true)
            .spawn()
            .map_err(|source| BxcError::Spawn { bin: self.path().to_path_buf(), source })?;

        let mut out = child.stdout.take().expect("stdout was piped");
        let mut err = child.stderr.take().expect("stderr was piped");
        let out_task = tokio::spawn(async move {
            let mut buf = Vec::new();
            let _ = out.read_to_end(&mut buf).await;
            buf
        });
        let err_task = tokio::spawn(async move {
            let mut buf = Vec::new();
            let _ = err.read_to_end(&mut buf).await;
            buf
        });

        let (code, timed_out) = match tokio::time::timeout(budget, child.wait()).await {
            Ok(Ok(status)) => (status.code(), false),
            Ok(Err(source)) => {
                return Err(BxcError::Spawn { bin: self.path().to_path_buf(), source });
            },
            Err(_elapsed) => {
                // Killing closes the pipes, which is what lets the two reader
                // tasks below finish instead of hanging with the child.
                let _ = child.kill().await;
                (None, true)
            },
        };

        let stdout = out_task.await.unwrap_or_default();
        let stderr = err_task.await.unwrap_or_default();

        Ok(Run {
            args: args.to_vec(),
            code,
            stdout: String::from_utf8_lossy(&stdout).into_owned(),
            stderr: String::from_utf8_lossy(&stderr).into_owned(),
            timed_out,
        })
    }

    /// `bxc scrape <url> --markdown [--profile ...]`.
    ///
    /// Always hits the deadline - see [`SCRAPE_BUDGET`]. The timeout is
    /// therefore not reported as a failure when output arrived; it becomes a
    /// note on the result.
    ///
    /// # Errors
    ///
    /// [`BxcError::CliTimeout`] when the deadline expired with **no** output,
    /// [`BxcError::CliFailed`] when bxc exited non-zero with no output.
    pub async fn scrape_markdown(
        &self,
        url: &str,
        profile: Option<Profile>,
        budget: Duration,
    ) -> Result<(String, Run)> {
        let mut args = vec!["scrape".to_owned(), url.to_owned(), "--markdown".to_owned()];
        if let Some(p) = profile {
            args.push("--profile".to_owned());
            args.push(p.as_str().to_owned());
        }
        let run = self.run(&args, budget).await?;
        let (body, _dropped) = strip_progress_lines(&run.stdout);

        if body.trim().is_empty() {
            return Err(self.explain_empty(&run, budget));
        }
        Ok((body, run))
    }

    /// `bxc recon <url> [--profile ...]`.
    ///
    /// The only subcommand with a verified exit contract (0 / 65), so this one
    /// does insist on a clean exit.
    ///
    /// # Errors
    ///
    /// [`BxcError::CliFailed`] on a non-zero exit, [`BxcError::CliTimeout`] on
    /// expiry.
    pub async fn recon(
        &self,
        url: &str,
        profile: Option<Profile>,
        budget: Duration,
    ) -> Result<(String, Run)> {
        let mut args = vec!["recon".to_owned(), url.to_owned()];
        if let Some(p) = profile {
            args.push("--profile".to_owned());
            args.push(p.as_str().to_owned());
        }
        let run = self.run(&args, budget).await?;
        if !run.ok() {
            return Err(self.explain_empty(&run, budget));
        }
        let (body, _dropped) = strip_progress_lines(&run.stdout);

        // An exit of 0 is not proof that a report was produced. On a failing
        // origin, `recon` escalates through all five profiles and writes only
        // its `[recon] Probing target using profile: X` lines — which
        // `strip_progress_lines` then removes, leaving nothing. Returning
        // `Ok("")` there hands the caller an empty page under a success code:
        // a body with no content and exit 0 is a false green, and the caller
        // cannot tell it from a genuinely blank document.
        if body.trim().is_empty() {
            return Err(self.explain_empty(&run, budget));
        }
        Ok((body, run))
    }

    /// `bxc search <query> --json`.
    ///
    /// # Errors
    ///
    /// [`BxcError::CliOutput`] when stdout is not the documented JSON object,
    /// [`BxcError::CliTimeout`] on expiry, [`BxcError::Spawn`] on spawn failure.
    /// An exit of 65 with a well-formed empty body is **not** an error: bxc
    /// ran, and "no results" is a finding.
    pub async fn search(&self, query: &str, num: Option<u32>, budget: Duration) -> Result<Search> {
        let mut args = vec!["search".to_owned(), query.to_owned(), "--json".to_owned()];
        if let Some(n) = num {
            args.push("--num".to_owned());
            args.push(n.to_string());
        }
        let run = self.run(&args, budget).await?;
        let (body, _dropped) = strip_progress_lines(&run.stdout);

        if body.trim().is_empty() {
            return Err(self.explain_empty(&run, budget));
        }
        let value: serde_json::Value =
            serde_json::from_str(body.trim()).map_err(|e| BxcError::CliOutput {
                bin: self.path().to_path_buf(),
                expected: "JSON",
                detail: format!(
                    "{e}; body starts with {:?}",
                    body.chars().take(160).collect::<String>()
                ),
            })?;
        Ok(Search::from_json(&value, &run))
    }

    /// `bxc google translate <text> --target <target> [--source <source>]`.
    ///
    /// Translates text using bxc's multi-tiered Google Translate engine
    /// (RPC Tier 1 / Web Mobile Tier 2 / Session fallback).
    pub async fn google_translate(
        &self,
        text: &str,
        target: &str,
        source: Option<&str>,
        budget: Duration,
    ) -> Result<String> {
        let mut args = vec![
            "google".to_owned(),
            "translate".to_owned(),
            text.to_owned(),
            "--target".to_owned(),
            target.to_owned(),
        ];
        if let Some(src) = source {
            args.push("--source".to_owned());
            args.push(src.to_owned());
        }
        let run = self.run(&args, budget).await?;
        let (body, _dropped) = strip_progress_lines(&run.stdout);
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Err(self.explain_empty(&run, budget));
        }
        Ok(trimmed.to_string())
    }

    /// `bxc google search <query> [--profile <profile>]`.
    pub async fn google_search(
        &self,
        query: &str,
        profile: Option<Profile>,
        budget: Duration,
    ) -> Result<String> {
        let mut args = vec!["google".to_owned(), "search".to_owned(), query.to_owned()];
        if let Some(p) = profile {
            args.push("--profile".to_owned());
            args.push(p.as_str().to_owned());
        }
        let run = self.run(&args, budget).await?;
        let (body, _dropped) = strip_progress_lines(&run.stdout);
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Err(self.explain_empty(&run, budget));
        }
        Ok(trimmed.to_string())
    }

    /// `bxc google dns <name> [type]`.
    pub async fn google_dns(
        &self,
        name: &str,
        record_type: Option<&str>,
        budget: Duration,
    ) -> Result<String> {
        let mut args = vec!["google".to_owned(), "dns".to_owned(), name.to_owned()];
        if let Some(t) = record_type {
            args.push(t.to_owned());
        }
        let run = self.run(&args, budget).await?;
        let (body, _dropped) = strip_progress_lines(&run.stdout);
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Err(self.explain_empty(&run, budget));
        }
        Ok(trimmed.to_string())
    }

    /// `bxc google tts <text> [--target <target>] [--speed <speed>]`.
    pub async fn google_tts(
        &self,
        text: &str,
        target: Option<&str>,
        speed: Option<f64>,
        budget: Duration,
    ) -> Result<String> {
        let mut args = vec!["google".to_owned(), "tts".to_owned(), text.to_owned()];
        if let Some(t) = target {
            args.push("--target".to_owned());
            args.push(t.to_owned());
        }
        if let Some(s) = speed {
            args.push("--speed".to_owned());
            args.push(s.to_string());
        }
        let run = self.run(&args, budget).await?;
        let (body, _dropped) = strip_progress_lines(&run.stdout);
        let trimmed = body.trim();
        if trimmed.is_empty() {
            return Err(self.explain_empty(&run, budget));
        }
        Ok(trimmed.to_string())
    }

    /// Build the right error for a run that produced nothing usable.
    fn explain_empty(&self, run: &Run, budget: Duration) -> BxcError {
        if run.timed_out {
            return BxcError::CliTimeout {
                bin: self.path().to_path_buf(),
                secs: budget.as_secs(),
                bytes: run.stdout.len(),
            };
        }
        let mut detail = run.stderr_excerpt();
        if run.code == Some(65) {
            detail.push_str(
                "\nExit 65 is bxc for \"ran fine, produced nothing\": a dead host, or a browser \
                 profile with no Chromium installed.",
            );
        }
        BxcError::CliFailed {
            bin: self.path().to_path_buf(),
            args: run.args.join(" "),
            code: run.code.map_or_else(|| "no exit code".to_owned(), |c| c.to_string()),
            detail,
        }
    }
}

/// bxc progress prefixes that appear on **stdout**, interleaved with content.
///
/// Only these exact prefixes are removed. A looser rule - anything in square
/// brackets at the start of a line - would eat Markdown link reference
/// definitions (`[spec]: https://...`) out of the very documents this bridge
/// exists to deliver.
const PROGRESS_PREFIXES: [&str; 5] =
    ["[recon] ", "[scrape] ", "[search] ", "[mirror] ", "[google] "];

/// Drop bxc progress lines from stdout, returning the body and the count.
///
/// The count is returned, not discarded. A filter that removes without saying
/// how much it removed is the failure mode this repository has already paid
/// for once (`CLAUDE.md` §7): it raises nothing, and things simply go missing.
#[must_use]
pub fn strip_progress_lines(stdout: &str) -> (String, usize) {
    let mut dropped = 0usize;
    let kept: Vec<&str> = stdout
        .lines()
        .filter(|line| {
            let is_progress = PROGRESS_PREFIXES.iter().any(|p| line.starts_with(p));
            if is_progress {
                dropped += 1;
            }
            !is_progress
        })
        .collect();
    (kept.join("\n").trim_start_matches('\n').to_owned(), dropped)
}

/// One organic search result.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Hit {
    /// Result title.
    pub title: String,
    /// Target URL.
    pub link: String,
    /// Snippet, empty when bxc gave none.
    pub snippet: String,
}

/// A parsed `bxc search --json` answer.
#[derive(Debug, Clone, serde::Serialize)]
pub struct Search {
    /// The query bxc echoed back.
    pub query: String,
    /// Organic results this bridge could read.
    pub hits: Vec<Hit>,
    /// Entries present in `organic` that carried neither a title nor a link.
    ///
    /// Counted rather than silently skipped: if bxc renames its fields, this
    /// number goes up while `hits` goes to zero, and the difference between
    /// "Google returned nothing" and "the bridge stopped understanding the
    /// payload" stays visible.
    pub unreadable: usize,
    /// Entries kept as hits but missing half of what a hit needs.
    ///
    /// A result with a title and no link cannot be opened; one with a link
    /// and no title is shown under its own URL. Both are still returned —
    /// dropping them would be the discarding filter §7 warns about — but they
    /// are counted, so a payload change that starts stripping links surfaces
    /// as a rising number instead of as quietly degraded results.
    pub partial: usize,

    /// The fetch profile bxc reported using.
    pub profile: Option<String>,
    /// Whether bxc used an authenticated cookie jar.
    pub authenticated: bool,
    /// Whether the answer came from bxc cache.
    pub from_cache: bool,
    /// Exit code bxc reported (65 means "ran, found nothing").
    pub exit_code: Option<i32>,
}

/// Pull a string out of an object under the first key that carries one.
fn first_str(obj: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| obj.get(*k).and_then(serde_json::Value::as_str)).map(str::to_owned)
}

impl Search {
    /// Read the JSON object bxc emits.
    ///
    /// Field names are probed rather than hard-bound: the measured payload is
    /// `{query, organic, peopleAlsoAsk, relatedSearches, servedFromCache,
    /// profileUsed, authenticated}`, and the elements of `organic` could not
    /// be measured on the build machine (Google blocked the anonymous
    /// request), so the reader accepts the obvious spellings and *counts* what
    /// it cannot read instead of pretending the list was empty.
    #[must_use]
    pub fn from_json(value: &serde_json::Value, run: &Run) -> Self {
        let mut hits = Vec::new();
        let mut unreadable = 0usize;
        let mut partial = 0usize;

        if let Some(list) = value.get("organic").and_then(serde_json::Value::as_array) {
            for entry in list {
                let title = first_str(entry, &["title", "name", "heading"]);
                let link = first_str(entry, &["link", "url", "href"]);
                match (title, link) {
                    (Some(title), Some(link)) => hits.push(Hit {
                        title,
                        link,
                        snippet: first_str(entry, &["snippet", "description", "text"])
                            .unwrap_or_default(),
                    }),
                    (Some(title), None) => {
                        partial += 1;
                        hits.push(Hit { title, link: String::new(), snippet: String::new() });
                    },
                    (None, Some(link)) => {
                        partial += 1;
                        hits.push(Hit { title: link.clone(), link, snippet: String::new() });
                    },
                    (None, None) => unreadable += 1,
                }
            }
        }

        Self {
            query: first_str(value, &["query"]).unwrap_or_default(),
            hits,
            unreadable,
            partial,
            profile: first_str(value, &["profileUsed", "profile"]),
            authenticated: value
                .get("authenticated")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
            from_cache: value
                .get("servedFromCache")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false),
            exit_code: run.code,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_lines_are_removed_and_counted() {
        let raw = "[recon] Probing target using profile: static\n# Title\n\nbody\n";
        let (body, dropped) = strip_progress_lines(raw);
        assert_eq!(dropped, 1);
        assert!(body.starts_with("# Title"), "{body:?}");
        assert!(body.contains("body"));
    }

    /// The rule must not eat Markdown. A link reference definition starts a
    /// line with a bracket too, and those live in exactly the documents this
    /// bridge is built to deliver.
    #[test]
    fn a_markdown_link_reference_survives_the_filter() {
        let raw = "[spec]: https://example.com/spec\n[recon] noise\ntext [ref] inline\n";
        let (body, dropped) = strip_progress_lines(raw);
        assert_eq!(dropped, 1, "only the bxc progress line may go");
        assert!(body.contains("[spec]: https://example.com/spec"), "{body:?}");
        assert!(body.contains("text [ref] inline"), "{body:?}");
    }

    #[test]
    fn clean_output_is_untouched() {
        let raw = "# Example Domain\n\nThis domain is for use in examples.";
        let (body, dropped) = strip_progress_lines(raw);
        assert_eq!(dropped, 0);
        assert_eq!(body, raw);
    }

    #[test]
    fn profiles_round_trip_and_browser_profiles_are_flagged() {
        for p in [Profile::Static, Profile::Fast, Profile::Http, Profile::Stealth, Profile::Max] {
            assert_eq!(Profile::parse(p.as_str()), Some(p));
        }
        assert_eq!(Profile::parse("  STEALTH "), Some(Profile::Stealth));
        assert_eq!(Profile::parse("turbo"), None);
        assert!(!Profile::Static.needs_browser());
        assert!(!Profile::Http.needs_browser());
        assert!(Profile::Max.needs_browser());
    }

    /// The exact payload measured on 2026-09-07: an empty SERP with exit 65.
    /// It must read as "bxc ran and found nothing", not as a parse failure.
    #[test]
    fn an_empty_serp_parses_as_zero_hits_not_as_a_broken_payload() {
        let value: serde_json::Value = serde_json::from_str(
            r#"{"query":"rust libloading crate","organic":[],"peopleAlsoAsk":[],
                "relatedSearches":[],"servedFromCache":false,"profileUsed":"fetch",
                "authenticated":false}"#,
        )
        .unwrap();
        let run = Run {
            args: vec!["search".into()],
            code: Some(65),
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
        };
        let parsed = Search::from_json(&value, &run);
        assert_eq!(parsed.query, "rust libloading crate");
        assert!(parsed.hits.is_empty());
        assert_eq!(parsed.unreadable, 0);
        assert_eq!(parsed.profile.as_deref(), Some("fetch"));
        assert!(!parsed.authenticated);
        assert_eq!(parsed.exit_code, Some(65));
    }

    #[test]
    fn hits_are_read_under_either_field_spelling() {
        let value: serde_json::Value = serde_json::from_str(
            r#"{"query":"q","organic":[
                 {"title":"A","link":"https://a.example","snippet":"sa"},
                 {"name":"B","url":"https://b.example","description":"sb"}]}"#,
        )
        .unwrap();
        let run = Run {
            args: vec![],
            code: Some(0),
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
        };
        let parsed = Search::from_json(&value, &run);
        assert_eq!(parsed.hits.len(), 2);
        assert_eq!(parsed.hits[1].title, "B");
        assert_eq!(parsed.hits[1].link, "https://b.example");
        assert_eq!(parsed.hits[1].snippet, "sb");
        assert_eq!(parsed.unreadable, 0);
    }

    /// If bxc renames its fields, the count must move - otherwise the day the
    /// payload changes looks exactly like the day Google returns nothing.
    #[test]
    fn entries_the_reader_cannot_understand_are_counted_not_dropped() {
        let value: serde_json::Value =
            serde_json::from_str(r#"{"organic":[{"zzz":1},{"qqq":2},{"title":"ok"}]}"#).unwrap();
        let run = Run {
            args: vec![],
            code: Some(0),
            stdout: String::new(),
            stderr: String::new(),
            timed_out: false,
        };
        let parsed = Search::from_json(&value, &run);
        assert_eq!(parsed.hits.len(), 1);
        assert_eq!(parsed.unreadable, 2, "silently losing two results is the bug this guards");
    }

    #[test]
    fn a_run_that_exited_nonzero_is_not_ok_but_keeps_its_streams() {
        let run = Run {
            args: vec!["recon".into()],
            code: Some(65),
            stdout: "partial".into(),
            stderr: "  [error] redis  ".into(),
            timed_out: false,
        };
        assert!(!run.ok());
        assert!(run.stderr_excerpt().contains("redis"));
    }
}
