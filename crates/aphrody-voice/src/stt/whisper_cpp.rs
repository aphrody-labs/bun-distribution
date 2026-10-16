// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//
//! Offline speech-to-text by **driving** the upstream `whisper.cpp` binary.
//!
//! # Why drive rather than link
//!
//! aphrody already made this call once, for llama.cpp
//! (`aphrody_infer::llama`, `CLAUDE.md` §7): linking a fast-moving CUDA C++
//! project pins one build into aphrody's own build, drags a CUDA toolchain into
//! every compile, and collides with the `+crt-static` posture on MSVC. Spawning
//! the release binary keeps the build hermetic and turns a whisper.cpp bump
//! into a download rather than a recompile.
//!
//! The in-process backend still exists behind the `local-whisper` feature
//! (`super::local_whisper`), for callers who want no child process. The feature
//! is therefore a **choice of backend**, not an on/off switch for local
//! transcription: with it off, this module answers.
//!
//! # Resolution order
//!
//! Binary — mirrors `gemini_runtime::resolve_bin` and `aphrody_infer::llama`:
//!
//! 1. `$APHRODY_WHISPER_BIN` — explicit path to the executable
//! 2. `$APHRODY_WHISPER_DIR` — a directory holding the release binaries
//! 3. `~/.aphrody/runtimes/whisper-*/` — newest install wins
//! 4. `PATH`
//!
//! Weights — a catalog id (`whisper-base-en`, `whisper-large-v3-turbo-q8`)
//! resolved through `aphrody-models`' store, or a
//! path to a GGML file the caller already has.

use aphrody_proc::NoWindow as _;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use bytes::Bytes;
use futures::Stream;

use crate::stt::{
    SttError, SttOptions, SttProvider, Transcript, TranscriptDelta, TranscriptSegment, wav,
};

// -- Binary discovery ---------------------------------------------------------

/// The whisper.cpp executables aphrody knows how to drive.
///
/// Upstream renamed `main` to `whisper-cli` in 2024 and kept shipping both for
/// a while; releases in the wild still carry either name, so both are searched
/// under the same tool.
const CLI_STEMS: [&str; 2] = ["whisper-cli", "main"];

/// Where a whisper.cpp binary came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WhisperSource {
    /// `$APHRODY_WHISPER_BIN` pointed straight at it.
    Override(PathBuf),
    /// Found in `$APHRODY_WHISPER_DIR`.
    EnvDir(PathBuf),
    /// Found under `~/.aphrody/runtimes/whisper-*`.
    Managed(PathBuf),
    /// Found on `PATH`.
    Path(PathBuf),
}

impl WhisperSource {
    /// The resolved executable.
    #[must_use]
    pub fn path(&self) -> &Path {
        match self {
            Self::Override(p) | Self::EnvDir(p) | Self::Managed(p) | Self::Path(p) => p,
        }
    }

    /// Short label for capability reports.
    #[must_use]
    pub const fn label(&self) -> &'static str {
        match self {
            Self::Override(_) => "APHRODY_WHISPER_BIN",
            Self::EnvDir(_) => "APHRODY_WHISPER_DIR",
            Self::Managed(_) => "managed (~/.aphrody/runtimes)",
            Self::Path(_) => "PATH",
        }
    }
}

fn file_name(stem: &str) -> String {
    if cfg!(windows) { format!("{stem}.exe") } else { stem.to_owned() }
}

fn non_empty_env(var: &str) -> Option<String> {
    std::env::var(var).ok().filter(|v| !v.is_empty())
}

/// Subdirectories an unpacked whisper.cpp release puts its binaries in.
///
/// Upstream's own artefacts disagree with each other: the Windows zips nest
/// everything under `Release/`, the Linux tarballs use `build/bin/`, a local
/// CMake build lands in `bin/`, and a hand-made install has them at the root.
/// Searching only the root is how a correct install reads as "whisper.cpp is
/// not on this machine".
const BIN_SUBDIRS: [&str; 4] = ["", "bin", "Release", "build/bin"];

/// Look for the CLI directly in `dir`, without descending.
fn in_dir_flat(dir: &Path) -> Option<PathBuf> {
    CLI_STEMS.iter().find_map(|stem| {
        let candidate = dir.join(file_name(stem));
        candidate.is_file().then_some(candidate)
    })
}

/// Look for the CLI in `dir` and in each layout a release is known to use.
fn in_dir(dir: &Path) -> Option<PathBuf> {
    BIN_SUBDIRS.iter().find_map(|sub| {
        let root = if sub.is_empty() { dir.to_path_buf() } else { dir.join(sub) };
        in_dir_flat(&root)
    })
}

/// Scan a runtimes root for `whisper-*/…/whisper-cli`, newest first.
///
/// Split out from [`resolve`] so it is testable without writing to the process
/// environment.
#[must_use]
pub fn find_managed_in(root: &Path) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(root)
        .ok()?
        .filter_map(core::result::Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path.file_name().is_some_and(|n| n.to_string_lossy().starts_with("whisper-"))
        })
        .collect();

    // whisper.cpp tags are `v1.7.6`-style; reverse lexicographic order puts the
    // newest first for equal-width versions, which is the common case within
    // one major line.
    candidates.sort_by(|a, b| b.file_name().cmp(&a.file_name()));
    candidates.into_iter().find_map(|dir| in_dir(&dir))
}

/// Where aphrody keeps downloaded runtimes.
///
/// Delegates to `aphrody_models::paths`, the single authority. The copy that
/// lived here consulted `HOME` before `USERPROFILE`, so under Git Bash on
/// Windows — which sets both — it looked for whisper.cpp in a different tree
/// from the one `aphrody model pull` writes to, and simply reported the
/// binary as absent.
fn runtimes_dir() -> Option<PathBuf> {
    aphrody_models::paths::runtimes_dir().ok()
}

fn which_on_path() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    let dirs: Vec<PathBuf> = std::env::split_paths(&path).collect();
    CLI_STEMS.iter().find_map(|stem| {
        let name = file_name(stem);
        dirs.iter().find_map(|dir| {
            let candidate = dir.join(&name);
            candidate.is_file().then_some(candidate)
        })
    })
}

/// Locate the whisper.cpp CLI.
///
/// `None` is a normal state — it means whisper.cpp is not installed on this
/// machine, which callers report as a missing runtime rather than a failure.
#[must_use]
pub fn resolve() -> Option<WhisperSource> {
    if let Some(explicit) = non_empty_env("APHRODY_WHISPER_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Some(WhisperSource::Override(path));
        }
        // A user who set the variable meant "my whisper.cpp lives here", so
        // treat a stale file name as a directory hint rather than giving up.
        if let Some(found) = path.parent().and_then(in_dir) {
            return Some(WhisperSource::EnvDir(found));
        }
    }
    if let Some(dir) = non_empty_env("APHRODY_WHISPER_DIR")
        && let Some(found) = in_dir(Path::new(&dir))
    {
        return Some(WhisperSource::EnvDir(found));
    }
    // A distribution package (Bun OS: extra/whisper-cpp) wins over the
    // managed download.
    let system: &[&str] = if cfg!(unix) { &["/usr/bin", "/usr/local/bin"] } else { &[] };
    if let Some(found) = system.iter().find_map(|dir| in_dir(Path::new(dir))) {
        return Some(WhisperSource::Path(found));
    }
    if let Some(found) = runtimes_dir().as_deref().and_then(find_managed_in) {
        return Some(WhisperSource::Managed(found));
    }
    which_on_path().map(WhisperSource::Path)
}

// -- Weight resolution --------------------------------------------------------

/// Resolve a model spec to a GGML file on disk.
///
/// A spec is either a path the caller already holds, or a catalog id whose
/// weights live in the `aphrody-models` store. Nothing is downloaded here: a
/// transcription call must not silently pull half a gigabyte, so a missing
/// artefact is reported with the exact `aphrody model pull` command that fixes
/// it.
///
/// # Errors
///
/// [`SttError::Other`] when the spec is neither an existing file nor an
/// installed catalog entry.
pub fn resolve_weights(spec: &str) -> Result<PathBuf, SttError> {
    let as_path = Path::new(spec);
    if as_path.is_file() {
        return Ok(as_path.to_path_buf());
    }

    let catalog = aphrody_models::Catalog::builtin();
    let entry = catalog.get(spec).map_err(|_| {
        SttError::Other(format!(
            "unknown model spec `{spec}`: not a file on disk, and not a catalog id (try one of: \
             {})",
            catalog
                .by_task(aphrody_models::ModelTask::SpeechToText)
                .iter()
                .map(|e| e.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ))
    })?;

    let file = entry
        .primary()
        .ok_or_else(|| SttError::Other(format!("catalog entry `{spec}` declares no artefact")))?;

    let store = aphrody_models::ModelStore::open()
        .map_err(|e| SttError::Other(format!("cannot open the model store: {e}")))?;
    let path = store.path_for(&file.reference);
    if path.is_file() {
        // Record the use so the LRU garbage collector does not evict a model
        // that transcription depends on.
        let _ = store.touch(&file.reference);
        return Ok(path);
    }

    Err(SttError::Other(format!(
        "model `{spec}` is not installed; run `aphrody model pull {spec}`"
    )))
}

// -- The backend --------------------------------------------------------------

/// Offline STT provider that spawns the upstream `whisper.cpp` CLI.
///
/// # Example
///
/// ```rust,no_run
/// # use aphrody_voice::stt::whisper_cpp::WhisperCppBackend;
/// // A catalog id: the weights come from the aphrody model store.
/// let backend = WhisperCppBackend::new("whisper-base-en");
/// ```
#[derive(Debug, Clone)]
pub struct WhisperCppBackend {
    /// Catalog id or path to a GGML file.
    pub model: String,
    /// Worker threads handed to whisper.cpp. `None` lets it pick.
    pub threads: Option<u16>,
}

impl WhisperCppBackend {
    /// Build a backend for `model`, which is a catalog id or a GGML path.
    ///
    /// Construction is infallible and touches neither disk nor `PATH`; every
    /// resolution failure surfaces on the first transcription call, where it
    /// can be reported with context.
    pub fn new(model: impl Into<String>) -> Self {
        Self { model: model.into(), threads: None }
    }

    /// Pin the worker thread count.
    #[must_use]
    pub const fn with_threads(mut self, threads: u16) -> Self {
        self.threads = Some(threads);
        self
    }

    /// Whether this machine can run the backend at all, and with what.
    ///
    /// Returns the binary and the resolved weights, so a `doctor`-style report
    /// can print both without running an inference.
    ///
    /// # Errors
    ///
    /// [`SttError::NotImplemented`] when whisper.cpp is absent,
    /// [`SttError::Other`] when the weights are not installed.
    pub fn probe(&self) -> Result<(WhisperSource, PathBuf), SttError> {
        let binary = resolve().ok_or(SttError::NotImplemented {
            reason: "whisper.cpp is not installed: set $APHRODY_WHISPER_BIN, or drop a release \
                     under ~/.aphrody/runtimes/whisper-<version>/ (the in-process backend is the \
                     `local-whisper` Cargo feature)",
        })?;
        let weights = resolve_weights(&self.model)?;
        Ok((binary, weights))
    }
}

/// One `transcription[]` entry of whisper.cpp's JSON output.
#[derive(Debug, serde::Deserialize)]
struct JsonSegment {
    #[serde(default)]
    offsets: JsonOffsets,
    #[serde(default)]
    text: String,
}

#[derive(Debug, Default, serde::Deserialize)]
struct JsonOffsets {
    /// Milliseconds from the start of the audio.
    #[serde(default)]
    from: i64,
    #[serde(default)]
    to: i64,
}

#[derive(Debug, Default, serde::Deserialize)]
struct JsonResult {
    #[serde(default)]
    language: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct JsonOutput {
    #[serde(default)]
    result: JsonResult,
    #[serde(default)]
    transcription: Vec<JsonSegment>,
}

/// Parse whisper.cpp's `--output-json` document into a [`Transcript`].
///
/// Kept public to the crate and free of I/O so the shape of upstream's document
/// is covered by a unit test rather than only by a machine that has the binary.
///
/// # Errors
///
/// [`SttError::Deserialise`] when the document is not the expected shape.
pub(crate) fn parse_json_output(raw: &str) -> Result<Transcript, SttError> {
    let parsed: JsonOutput = serde_json::from_str(raw)?;

    let mut text = String::new();
    let mut segments = Vec::with_capacity(parsed.transcription.len());
    let mut last_end = 0.0f32;

    for (index, seg) in parsed.transcription.into_iter().enumerate() {
        // whisper.cpp emits a leading space on nearly every segment; joining
        // raw would double it at each boundary.
        let trimmed = seg.text.trim();
        if !trimmed.is_empty() {
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(trimmed);
        }
        #[expect(clippy::cast_precision_loss, reason = "offsets are milliseconds of audio")]
        let start = seg.offsets.from as f32 / 1000.0;
        #[expect(clippy::cast_precision_loss, reason = "offsets are milliseconds of audio")]
        let end = seg.offsets.to as f32 / 1000.0;
        last_end = last_end.max(end);
        segments.push(TranscriptSegment {
            id: u32::try_from(index).unwrap_or(u32::MAX),
            start,
            end,
            text: trimmed.to_owned(),
        });
    }

    Ok(Transcript {
        text,
        language: parsed.result.language.filter(|l| !l.is_empty() && l != "auto"),
        duration_s: (last_end > 0.0).then_some(last_end),
        segments,
    })
}

#[async_trait]
impl SttProvider for WhisperCppBackend {
    /// Transcribe `audio` with a local whisper.cpp process.
    ///
    /// Accepts a PCM WAV buffer (16- or 32-bit, mono or stereo) or raw
    /// little-endian `f32` samples; both are normalised to the 16 kHz mono
    /// 16-bit WAV whisper.cpp reads.
    ///
    /// # Errors
    ///
    /// - [`SttError::EmptyInput`] — `audio` is empty.
    /// - [`SttError::NotImplemented`] — whisper.cpp is not installed.
    /// - [`SttError::Other`] — weights missing, audio unparseable, or the child process exited
    ///   non-zero (its stderr is included).
    async fn transcribe(&self, audio: &[u8], opts: SttOptions) -> Result<Transcript, SttError> {
        if audio.is_empty() {
            return Err(SttError::EmptyInput);
        }
        let (binary, weights) = self.probe()?;

        let decoded = wav::decode_any(audio).map_err(|e| SttError::Other(e.to_string()))?;
        if decoded.samples.is_empty() {
            return Err(SttError::EmptyInput);
        }
        if decoded.sample_rate != wav::WHISPER_SAMPLE_RATE {
            // Resampling here would be a silent quality decision on the caller's
            // audio; refusing names the exact mismatch instead.
            return Err(SttError::Other(format!(
                "audio is {} Hz; whisper.cpp requires {} Hz mono (resample before calling)",
                decoded.sample_rate,
                wav::WHISPER_SAMPLE_RATE
            )));
        }

        let dir = tempfile::tempdir()
            .map_err(|e| SttError::Other(format!("cannot create a work directory: {e}")))?;
        let input = dir.path().join("audio.wav");
        let out_prefix = dir.path().join("out");
        tokio::fs::write(&input, wav::encode_pcm16(&decoded.samples, decoded.sample_rate))
            .await
            .map_err(|e| SttError::Other(format!("cannot write the work WAV: {e}")))?;

        let mut cmd = tokio::process::Command::new(binary.path()).no_window();
        cmd.arg("-m")
            .arg(&weights)
            .arg("-f")
            .arg(&input)
            .arg("--output-json")
            .arg("--output-file")
            .arg(&out_prefix)
            .arg("--no-prints");
        if let Some(lang) = opts.language.as_deref().filter(|l| !l.is_empty()) {
            cmd.arg("-l").arg(lang);
        } else {
            cmd.arg("-l").arg("auto");
        }
        if let Some(threads) = self.threads {
            cmd.arg("-t").arg(threads.to_string());
        }
        // A dropped future (caller timeout, cancelled request) must not leave a
        // multi-minute decode running in the background holding the CPU or GPU.
        cmd.kill_on_drop(true);

        let output = cmd.output().await.map_err(|e| {
            SttError::Other(format!("cannot spawn {}: {e}", binary.path().display()))
        })?;
        if !output.status.success() {
            return Err(SttError::Other(format!(
                "{} exited with {}: {}",
                binary.path().display(),
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }

        let json_path = out_prefix.with_extension("json");
        let raw = tokio::fs::read_to_string(&json_path).await.map_err(|e| {
            SttError::Other(format!(
                "whisper.cpp reported success but wrote no JSON at {}: {e}",
                json_path.display()
            ))
        })?;

        let mut transcript = parse_json_output(&raw)?;
        transcript.language = transcript.language.or_else(|| opts.language.clone());
        Ok(transcript)
    }

    /// Buffer the stream, then transcribe in one pass.
    ///
    /// whisper.cpp's CLI is file-in / file-out: there is no partial-result
    /// channel to forward, so emitting a single final delta is the honest
    /// shape. A caller that needs incremental output should chunk the audio
    /// itself and call [`Self::transcribe`] per chunk.
    async fn transcribe_stream(
        &self,
        audio: impl Stream<Item = Bytes> + Send + 'static,
        opts: SttOptions,
    ) -> Result<impl Stream<Item = Result<TranscriptDelta, SttError>> + Send, SttError> {
        use futures::StreamExt as _;

        let mut buf: Vec<u8> = Vec::new();
        futures::pin_mut!(audio);
        while let Some(chunk) = audio.next().await {
            buf.extend_from_slice(&chunk);
        }

        let transcript = self.transcribe(&buf, opts).await?;
        let delta = TranscriptDelta { text: transcript.text, is_final: true, segment_id: 0 };
        Ok(futures::stream::once(async move { Ok(delta) }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"stub").unwrap();
    }

    #[test]
    fn managed_scan_prefers_the_newest_release() {
        let dir = tempfile::tempdir().unwrap();
        for version in ["whisper-v1.7.2", "whisper-v1.7.6"] {
            touch(&dir.path().join(version).join(file_name("whisper-cli")));
        }
        let found = find_managed_in(dir.path()).unwrap();
        assert!(found.to_string_lossy().contains("v1.7.6"), "{}", found.display());
    }

    #[test]
    fn managed_scan_covers_every_release_layout() {
        // Each of these is a real upstream artefact layout: a local CMake
        // build, the Windows zip, and the Linux tarball respectively.
        for sub in ["bin", "Release", "build/bin"] {
            let dir = tempfile::tempdir().unwrap();
            let mut nested = dir.path().join("whisper-v1.7.6");
            for part in sub.split('/') {
                nested = nested.join(part);
            }
            touch(&nested.join(file_name("whisper-cli")));
            assert!(find_managed_in(dir.path()).is_some(), "layout {sub} not found");
        }
    }

    #[test]
    fn managed_scan_accepts_the_legacy_main_name() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("whisper-v1.5.0").join(file_name("main")));
        assert!(find_managed_in(dir.path()).is_some());
    }

    #[test]
    fn managed_scan_ignores_unrelated_runtimes() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("llama-b10549").join(file_name("whisper-cli")));
        assert!(find_managed_in(dir.path()).is_none());
    }

    #[test]
    fn scanning_an_absent_root_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(find_managed_in(&dir.path().join("nope")).is_none());
    }

    #[test]
    fn json_output_becomes_a_transcript_with_timed_segments() {
        // Shape emitted by `whisper-cli --output-json`, trimmed to the fields
        // this module reads.
        let raw = r#"{
          "systeminfo": "AVX = 1",
          "model": { "type": "base" },
          "result": { "language": "en" },
          "transcription": [
            { "timestamps": { "from": "00:00:00,000", "to": "00:00:02,000" },
              "offsets": { "from": 0, "to": 2000 },
              "text": " Hello there." },
            { "timestamps": { "from": "00:00:02,000", "to": "00:00:03,500" },
              "offsets": { "from": 2000, "to": 3500 },
              "text": " General Kenobi." }
          ]
        }"#;
        let transcript = parse_json_output(raw).unwrap();
        assert_eq!(transcript.text, "Hello there. General Kenobi.");
        assert_eq!(transcript.language.as_deref(), Some("en"));
        assert_eq!(transcript.segments.len(), 2);
        assert!((transcript.segments[1].start - 2.0).abs() < 1e-6);
        assert!((transcript.duration_s.unwrap() - 3.5).abs() < 1e-6);
        assert_eq!(transcript.segments[0].id, 0);
    }

    #[test]
    fn an_empty_transcription_array_is_an_empty_transcript_not_an_error() {
        // Silence is a legitimate result; turning it into an error would make
        // a batch job abort on a blank track.
        let transcript =
            parse_json_output(r#"{"result":{"language":"auto"},"transcription":[]}"#).unwrap();
        assert!(transcript.text.is_empty());
        assert!(transcript.segments.is_empty());
        assert!(transcript.duration_s.is_none());
        // `auto` is whisper.cpp echoing the request, not a detection.
        assert!(transcript.language.is_none());
    }

    #[test]
    fn malformed_json_is_a_deserialise_error() {
        assert!(matches!(parse_json_output("not json"), Err(SttError::Deserialise(_))));
    }

    #[tokio::test]
    async fn empty_audio_is_rejected_before_any_process_spawn() {
        let backend = WhisperCppBackend::new("whisper-base-en");
        assert!(matches!(
            backend.transcribe(b"", SttOptions::default()).await,
            Err(SttError::EmptyInput)
        ));
    }

    #[test]
    fn an_unknown_spec_names_the_catalog_alternatives() {
        let err = resolve_weights("definitely-not-a-model").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("whisper-base-en"), "{msg}");
    }

    #[test]
    fn a_file_path_spec_is_used_as_is() {
        let dir = tempfile::tempdir().unwrap();
        let weights = dir.path().join("ggml-base.en.bin");
        std::fs::write(&weights, b"stub").unwrap();
        assert_eq!(resolve_weights(weights.to_str().unwrap()).unwrap(), weights);
    }

    #[test]
    fn source_labels_name_their_origin() {
        let source = WhisperSource::Managed(PathBuf::from("/x/whisper-cli"));
        assert_eq!(source.label(), "managed (~/.aphrody/runtimes)");
        assert_eq!(source.path(), Path::new("/x/whisper-cli"));
    }
}
