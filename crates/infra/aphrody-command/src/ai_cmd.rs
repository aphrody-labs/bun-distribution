// SPDX-License-Identifier: Apache-2.0
//! Unified Local-First AI Subsystem (`aphrody ai`).
//!
//! Groups all native AI capabilities into a single, cohesive, keyless surface:
//! - `rag` (Raptor F64 vector store in SQLite, hybrid & lexical search)
//! - `model` (Local model catalog, pull, inspect, verify, evict under ~/.aphrody/models)
//! - `infer` (ONNX Runtime and GGUF local inference and provider probing)
//! - `voice` (Offline speech-to-text with Whisper GGML)
//! - `ocr` (Local vision-language models and PP-OCRv5)
//! - `translate` (Local neural translation via aphrody-translate)
//! - `memory` (Local SQLite memory store)
//! - `gateway` (OpenAI-compatible HTTP AI gateway)
//! - `train` (Machine learning training engine)
//! - `agent` (Local agent execution & app-server protocol v2)
//! - `status` (Overview of local models, acceleration, memory, and providers)

use std::path::PathBuf;

use clap::Subcommand;

use crate::context::TerminalCommand;

#[derive(Subcommand, Debug, Clone)]
pub(crate) enum AiAction {
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

    /// Local and offline neural translation via aphrody-translate.
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
        /// Translation backend: auto, local, offline, web
        #[arg(short, long, default_value = "auto")]
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
                let profile_sqlite_path = if (from == crate::memory_cmd::MemoryProviderArg::SqliteLocal
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
            let data = std::fs::read(&file)
                .map_err(|e| miette::miette!("Failed to read audio file {}: {e}", file.display()))?;
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
            let installed = store.list().unwrap_or_default();
            let whisper_models: Vec<_> = installed
                .into_iter()
                .filter(|m| m.reference.to_string().starts_with("whisper"))
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
                    whisper_source.map_or_else(|| "none detected (managed runtime fallback)".to_string(), |s| format!("{s:?}"))
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
    let topology = aphrody_native::NativePlatform::get_topology();
    let store = aphrody_models::ModelStore::open().ok();
    let installed_models = store.and_then(|s| s.list().ok()).unwrap_or_default();

    let summary = serde_json::json!({
        "status": "ready",
        "keyless": true,
        "local_first": true,
        "hardware": {
            "cpus": topology.cpu_count,
            "memory_available_mb": topology.memory_available_mb,
            "memory_total_mb": topology.memory_total_mb,
            "has_avx2": topology.has_avx2,
            "has_cuda": topology.has_cuda,
            "cuda_devices": topology.cuda_device_count,
        },
        "models": {
            "installed_count": installed_models.len(),
            "models": installed_models.iter().map(|m| serde_json::json!({
                "id": m.reference.to_string(),
                "bytes": m.bytes,
            })).collect::<Vec<_>>(),
        },
        "subsystems": {
            "rag": "Raptor F64 vector store in SQLite (hybrid & lexical)",
            "infer": "ONNX Runtime & GGUF local engines",
            "voice": "Whisper GGML offline STT",
            "ocr": "PP-OCRv5 & local VLM",
            "translate": "aphrody-translate offline cache",
            "memory": "SQLite local memory",
            "gateway": "OpenAI-compatible local gateway (127.0.0.1:8786)",
            "agent": "App-Server protocol v2 JSON-RPC daemon",
        }
    });

    if json {
        println!("{}", serde_json::to_string_pretty(&summary).unwrap());
    } else {
        println!("=== Aphrody Unified AI Subsystem (100% Local & Keyless) ===");
        println!("  * Status:        [OK] Ready");
        println!("  * Cloud Keys:    None required (100% local, on-device)");
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
            println!("    - {:30} ({})", m.reference.to_string(), aphrody_models::human_bytes(m.bytes));
        }
        println!("  * Subsystems:    rag, model, infer, voice, ocr, translate, memory, gateway, train, agent");
    }
    Ok(())
}
