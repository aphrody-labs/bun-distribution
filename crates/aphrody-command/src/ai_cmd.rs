// SPDX-License-Identifier: Apache-2.0
//! Unified Local-First AI Subsystem (`aphrody ai`).
//!
//! Groups AI command routes; availability depends on compiled features and runtime configuration.
//! - `rag` (Raptor F64 vector store in SQLite, hybrid & lexical search)
//! - `model` (Local model catalog, pull, inspect, verify, evict under ~/.aphrody/models)
//! - `infer` (ONNX Runtime discovery and provider probing)
//! - `voice` (Offline speech-to-text with Whisper GGML)
//! - `ocr` (Local vision-language models and PP-OCRv5)
//! - `translate` (Web translation backends with a local result cache)
//! - `memory` (Local SQLite memory store)
//! - `gateway` (OpenAI-compatible HTTP AI gateway)
//! - `train` (Machine learning training engine)
//! - `agent` (Local agent execution & app-server protocol v2)
//! - `status` (Overview of local models, acceleration, memory, and providers)

use std::path::PathBuf;

use clap::Subcommand;

use crate::context::TerminalCommand;

fn is_installed_whisper(
    model: &aphrody_models::InstalledModel,
    catalog: &aphrody_models::Catalog,
) -> bool {
    catalog
        .by_task(aphrody_models::ModelTask::SpeechToText)
        .iter()
        .any(|entry| entry.primary().is_some_and(|file| file.reference == model.reference))
        || matches!(
            model.inspection.as_ref().and_then(|inspection| inspection.details.as_ref()),
            Some(aphrody_models::Details::Ggml(_))
        )
}

fn translation_backend(value: &str) -> Result<String, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "local" | "offline" => {
            Err("No local/offline translation runtime is connected; refusing to use a web backend."
                .to_owned())
        },
        "auto" | "web" | "web-google" | "web_google" | "google" | "google-rpc" | "rpc" | "gtx"
        | "mymemory" | "memory" => Ok(value.to_owned()),
        _ => Err(format!("Unknown translation backend: {value}")),
    }
}

#[cfg(test)]
mod routing_tests {
    use clap::Parser;

    fn installed(reference: aphrody_models::ModelRef) -> aphrody_models::InstalledModel {
        aphrody_models::InstalledModel {
            reference,
            path: std::path::PathBuf::new(),
            stored_path: String::new(),
            bytes: 0,
            sha256: String::new(),
            format: aphrody_models::ArtifactFormat::Unknown,
            installed_at: 0,
            last_used_at: None,
            catalog_id: None,
            inspection: None,
        }
    }

    #[test]
    fn voice_status_recognizes_catalogued_hub_weights_by_task() {
        let catalog = aphrody_models::Catalog::builtin();
        let mut speech_models = 0;
        for entry in &catalog.entries {
            for file in &entry.files {
                let model = installed(file.reference.clone());
                let expected = entry.task == aphrody_models::ModelTask::SpeechToText
                    && entry.primary().is_some_and(|primary| primary.reference == file.reference);
                assert_eq!(super::is_installed_whisper(&model, catalog), expected, "{}", entry.id);
                speech_models += usize::from(expected);
            }
        }
        assert!(speech_models > 0);
    }

    #[test]
    fn voice_status_accepts_inspected_whisper_and_refuses_name_only() {
        let catalog = aphrody_models::Catalog::builtin();
        let mut model = installed(
            aphrody_models::ModelRef::parse("hf:fixture/whisper/fake-whisper.bin").unwrap(),
        );
        assert!(!super::is_installed_whisper(&model, catalog));
        let mut header = b"lmgg".to_vec();
        for field in [51864_i32, 1500, 512, 6, 4, 448, 512, 6, 4, 80, 1] {
            header.extend_from_slice(&field.to_le_bytes());
        }
        model.inspection = Some(aphrody_models::inspect_prefix(&header, "custom.bin"));
        assert!(super::is_installed_whisper(&model, catalog));
        model.inspection = Some(aphrody_models::inspect_prefix(b"lmgg", "custom.bin"));
        assert!(!super::is_installed_whisper(&model, catalog));
    }

    #[test]
    fn offline_translation_requests_cannot_fall_back_to_web() {
        for backend in ["local", "offline", "LOCAL", " offline "] {
            let error = match crate::Cli::try_parse_from([
                "aphrody",
                "ai",
                "translate",
                "private text",
                "--backend",
                backend,
            ]) {
                Ok(_) => panic!("offline translation must fail before dispatch"),
                Err(error) => error,
            };
            assert!(error.to_string().contains("refusing to use a web backend"));
        }
    }

    #[test]
    fn document_ai_preserves_owner_help_and_arguments() {
        for tail in [vec!["--help"], vec!["translate", "a file.md", "fr", "--owner-option"]] {
            let mut argv = vec!["aphrody", "ai", "doc-ai"];
            argv.extend(tail.iter().copied());
            let cli = crate::Cli::try_parse_from(argv)
                .expect("document AI owner arguments must pass through");
            match cli.command {
                Some(crate::Commands::Ai { action: super::AiAction::DocAi { args } }) => {
                    assert_eq!(args, tail);
                },
                _ => panic!("document AI must route through the AI namespace"),
            }
        }
    }
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum AiAction {
    /// Documentation generation and translation through the existing Bun capability owner.
    #[command(disable_help_flag = true)]
    DocAi {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// Local code and documentation retrieval (Raptor F64 vector store in SQLite, hybrid & lexical).
    #[cfg(feature = "rag")]
    Rag(crate::rag_cmd::RagArgs),

    /// Local model lifecycle (catalog, pull, inspect, verify, evict under ~/.aphrody/models).
    Model {
        #[command(subcommand)]
        action: crate::model_cmd::ModelAction,
    },

    /// Local ONNX inference backend (runtime discovery and provider probing).
    #[cfg(feature = "infer")]
    Infer {
        #[command(subcommand)]
        action: crate::infer_cmd::InferAction,
    },

    /// Offline Speech-To-Text / Text-To-Speech (local Whisper GGML).
    Voice {
        #[command(subcommand)]
        action: VoiceAction,
    },

    /// Read images with local vision-language models or PP-OCRv5.
    #[cfg(feature = "ocr")]
    Ocr {
        #[command(subcommand)]
        action: crate::ocr_cmd::OcrAction,
    },

    /// Web translation through aphrody-translate, with a local result cache.
    Translate {
        /// Text to translate directly
        #[arg(value_name = "TEXT")]
        text: Option<String>,
        /// Source language (auto, ja, en...)
        #[arg(short, long, default_value = "auto")]
        source: String,
        /// Target language (fr, en, ja...)
        #[arg(short, long, default_value = "fr")]
        target: String,
        /// Translation backend: auto, web, google-rpc or mymemory (network required on cache misses).
        #[arg(short, long, default_value = "auto", value_parser = translation_backend)]
        backend: String,
        /// File to translate
        #[arg(short, long)]
        file: Option<PathBuf>,
        /// Return strict machine-readable JSON
        #[arg(long)]
        json: bool,
    },

    /// Local memory store (write, recall, list, delete, clear, migrate).
    Memory {
        #[command(subcommand)]
        action: crate::MemoryAction,
    },

    /// Local OpenAI-compatible HTTP AI Gateway (127.0.0.1:8786).
    Gateway {
        #[command(subcommand)]
        action: Option<crate::gateway_cmd::GatewayAction>,
    },

    /// Local machine learning training and fine-tuning engine.
    #[cfg(feature = "train")]
    Train(crate::train_cmd::TrainArgs),

    /// Local agent execution and app-server protocol v2 JSON-RPC daemon.
    Agent(crate::codex_cmd::CodexArgs),

    /// Status of all local AI engines (models, providers, acceleration).
    Status {
        #[arg(long)]
        json: bool,
    },
}

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum VoiceAction {
    /// Transcribe a WAV audio file using local Whisper GGML weights.
    Transcribe {
        /// Path to WAV audio file.
        file: PathBuf,
        /// Model identifier (e.g. whisper-base-en, whisper-tiny-en).
        #[arg(short, long)]
        model: Option<String>,
        /// Emit structured JSON output.
        #[arg(long)]
        json: bool,
    },
    /// Status of local Whisper speech recognition engine and installed weights.
    Status {
        #[arg(long)]
        json: bool,
    },
}

pub(crate) async fn run(
    action: AiAction,
    overrides: &aphrody_config::CliOverrides,
    ctx: &crate::context::GoogleContext,
) -> miette::Result<()> {
    match action {
        AiAction::DocAi { args } => {
            let code = crate::multicall::bun_bridge::dispatch(
                "doc-ai",
                args.into_iter().map(std::ffi::OsString::from),
            );
            if code != 0 {
                return Err(miette::miette!(
                    "Document AI capability owner exited with code {code}"
                ));
            }
        },
        #[cfg(feature = "rag")]
        AiAction::Rag(args) => {
            crate::rag_cmd::run(args, overrides.clone()).await?;
        },
        AiAction::Model { action } => {
            crate::model_cmd::run(action).await?;
        },
        #[cfg(feature = "infer")]
        AiAction::Infer { action } => {
            crate::infer_cmd::run(action)?;
        },
        AiAction::Voice { action } => {
            run_voice(action).await?;
        },
        #[cfg(feature = "ocr")]
        AiAction::Ocr { action } => {
            crate::ocr_cmd::run(action).await?;
        },
        AiAction::Translate { text, source, target, backend, file, json } => {
            crate::commands::TranslateCommand { text, source, target, backend, file, json }
                .execute(ctx)
                .await?;
        },
        AiAction::Memory { action } => match action {
            crate::MemoryAction::Local(action) => {
                crate::memory_cmd::execute_local(action, overrides).await?;
            },
            crate::MemoryAction::Migrate {
                from,
                to,
                agent_id,
                dry_run,
                json,
                pretty,
                from_sqlite_path,
                to_sqlite_path,
                from_lancedb_path,
                to_lancedb_path,
                lancedb_ndims,
            } => {
                let profile_sqlite_path = if (from
                    == crate::memory_cmd::MemoryProviderArg::SqliteLocal
                    && from_sqlite_path.is_none())
                    || (to == crate::memory_cmd::MemoryProviderArg::SqliteLocal
                        && to_sqlite_path.is_none())
                {
                    Some(crate::memory_cmd::profile_sqlite_path(overrides)?)
                } else {
                    None
                };
                crate::memory_cmd::MigrateCommand {
                    from,
                    to,
                    agent_id,
                    dry_run,
                    json: json || pretty,
                    pretty,
                    from_sqlite_path: from_sqlite_path.or_else(|| {
                        (from == crate::memory_cmd::MemoryProviderArg::SqliteLocal)
                            .then(|| profile_sqlite_path.clone())
                            .flatten()
                    }),
                    to_sqlite_path: to_sqlite_path.or_else(|| {
                        (to == crate::memory_cmd::MemoryProviderArg::SqliteLocal)
                            .then(|| profile_sqlite_path.clone())
                            .flatten()
                    }),
                    from_lancedb_path,
                    to_lancedb_path,
                    lancedb_ndims,
                }
                .execute(ctx)
                .await?;
            },
        },
        AiAction::Gateway { action } => {
            crate::gateway_cmd::run(action.unwrap_or_default()).await?;
        },
        #[cfg(feature = "train")]
        AiAction::Train(args) => {
            crate::train_cmd::run(args).await?;
        },
        AiAction::Agent(args) => {
            crate::codex_cmd::run(args).await?;
        },
        AiAction::Status { json } => {
            run_ai_status(json).await?;
        },
    }
    Ok(())
}

pub(crate) async fn run_voice(action: VoiceAction) -> miette::Result<()> {
    match action {
        VoiceAction::Transcribe { file, model, json } => {
            if !file.exists() {
                return Err(miette::miette!("Audio file not found: {}", file.display()));
            }
            let model_name = model.as_deref().unwrap_or("whisper-base-en");
            let model_path = match aphrody_voice::stt::whisper_cpp::resolve_weights(model_name) {
                Ok(path) => path,
                Err(_) => {
                    return Err(miette::miette!(
                        "Whisper weights for '{model_name}' not resolved. Run `aphrody ai model pull {model_name}` to fetch them locally."
                    ));
                },
            };
            let data = std::fs::read(&file).map_err(|e| {
                miette::miette!("Failed to read audio file {}: {e}", file.display())
            })?;
            let backend = aphrody_voice::stt::whisper_cpp::WhisperCppBackend::new(
                model_path.to_string_lossy().to_string(),
            );
            let opts = aphrody_voice::stt::SttOptions::default();
            use aphrody_voice::stt::SttProvider;
            let transcript = backend
                .transcribe(&data, opts)
                .await
                .map_err(|e| miette::miette!("Whisper transcription failed: {e}"))?;

            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "file": file.display().to_string(),
                        "model": model_name,
                        "text": transcript.text,
                        "language": transcript.language,
                        "duration_s": transcript.duration_s,
                    }))
                    .unwrap()
                );
            } else {
                println!("=== Aphrody Voice Transcription ({model_name}) ===");
                println!("{}", transcript.text);
            }
        },
        VoiceAction::Status { json } => {
            let store = aphrody_models::ModelStore::open()
                .map_err(|e| miette::miette!("open model store: {e}"))?;
            let installed =
                store.list().map_err(|error| miette::miette!("list model store: {error}"))?;
            let catalog = aphrody_models::Catalog::builtin();
            let whisper_models: Vec<_> = installed
                .into_iter()
                .filter(|model| is_installed_whisper(model, catalog))
                .map(|m| {
                    serde_json::json!({
                        "id": m.reference.to_string(),
                        "bytes": m.bytes,
                    })
                })
                .collect();
            let whisper_source = aphrody_voice::stt::whisper_cpp::resolve();

            if json {
                println!(
                    "{}",
                    serde_json::to_string_pretty(&serde_json::json!({
                        "engine": "whisper.cpp",
                        "resolved_source": whisper_source.map(|s| format!("{s:?}")),
                        "installed_models": whisper_models,
                        "offline": true,
                        "keyless": true,
                    }))
                    .unwrap()
                );
            } else {
                println!("=== Aphrody Voice (Offline STT) ===");
                println!("  * Engine:          whisper.cpp (offline)");
                println!(
                    "  * Binary Source:   {}",
                    whisper_source.map_or_else(
                        || "none detected (managed runtime fallback)".to_string(),
                        |s| format!("{s:?}")
                    )
                );
                println!("  * Local Weights:   {} installed", whisper_models.len());
                for m in &whisper_models {
                    println!("    - {}", m["id"].as_str().unwrap_or(""));
                }
            }
        },
    }
    Ok(())
}

pub(crate) async fn run_ai_status(json: bool) -> miette::Result<()> {
    let topology = aphrody_native::native::NativePlatform::get_topology();
    let (installed_models, model_store_error) =
        match aphrody_models::ModelStore::open().and_then(|store| store.list()) {
            Ok(models) => (models, None),
            Err(error) => (Vec::new(), Some(error.to_string())),
        };

    let summary = serde_json::json!({
        "status": "inventory",
        "runtime_readiness": "not_probed",
        "authentication": "backend_dependent",
        "hardware": {
            "cpus": topology.cpu_count,
            "memory_available_mb": topology.memory_available_mb,
            "memory_total_mb": topology.memory_total_mb,
            "has_avx2": topology.has_avx2,
            "has_cuda": topology.has_cuda,
            "cuda_devices": topology.cuda_device_count,
        },
        "models": {
            "enumeration_error": model_store_error,
            "installed_count": installed_models.len(),
            "models": installed_models.iter().map(|m| serde_json::json!({
                "id": m.reference.to_string(),
                "bytes": m.bytes,
            })).collect::<Vec<_>>(),
        },
        "subsystems": {
            "rag": { "compiled": cfg!(feature = "rag"), "runtime": "not_probed" },
            "infer": { "compiled": cfg!(feature = "infer"), "runtime": "not_probed" },
            "ocr": { "compiled": cfg!(feature = "ocr"), "runtime": "not_probed" },
            "train": { "compiled": cfg!(feature = "train"), "runtime": "not_probed" },
            "voice": { "runtime": "not_probed" },
            "translate": { "runtime": "backend_dependent" },
            "memory": { "runtime": "not_probed" },
            "gateway": { "local_inference": "not_connected" },
            "agent": { "turn_execution": "not_connected" },
        }
    });

    if json {
        println!("{}", serde_json::to_string_pretty(&summary).unwrap());
    } else {
        println!("=== Aphrody AI inventory ===");
        println!("  * Status:        inventory; runtime readiness has not been probed");
        println!("  * Authentication: depends on the selected backend");
        println!(
            "  * Compute:       {} CPUs, {}/{} MiB RAM, AVX2={}, CUDA={} ({} devices)",
            topology.cpu_count,
            topology.memory_available_mb,
            topology.memory_total_mb,
            topology.has_avx2,
            topology.has_cuda,
            topology.cuda_device_count
        );
        println!("  * Local Models:  {} weights in ~/.aphrody/models", installed_models.len());
        for m in &installed_models {
            println!(
                "    - {:30} ({})",
                m.reference.to_string(),
                aphrody_models::human_bytes(m.bytes)
            );
        }
        println!(
            "  * Feature routes: rag={}, infer={}, ocr={}, train={}",
            cfg!(feature = "rag"),
            cfg!(feature = "infer"),
            cfg!(feature = "ocr"),
            cfg!(feature = "train")
        );
        if let Some(error) = summary["models"]["enumeration_error"].as_str() {
            println!("  * Model store:   {error}");
        }
    }
    Ok(())
}
