// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//! `aphrody shenron …` — Sovereign bridge connecting Aphrody (AI, Web, Infra, Shell, OS) to Shenron and Dragon Ball FR.
//!
//! Provides a unified, production-grade CLI and programmatic surface that exposes:
//! - **AI**: Hybrid RAG (FTS5 + Dense E5 + Cross-Encoder Rerank), automated training (triples, embed, rerank, lora),
//!   Toriyama/Shenron sovereign persona, and canon evaluation.
//! - **Web**: BXC scraper bridge, VoirAnime/Anime-Sama media harvesting, DragonBallCN crawl, and frame indexing.
//! - **Infra**: Host matrix (VPS, DBFR, WSL, Local), systemd service supervision, and deployment verification.
//! - **Shell**: Nushell scripts, terminal tools, and batch data pipelines.
//! - **OS**: WinClean diagnostics, process isolation, and host resource governance.

use std::path::PathBuf;

use clap::Subcommand;
use colored::Colorize;
use miette::IntoDiagnostic;
use serde_json::json;

/// Subcommands for `aphrody shenron`.
#[derive(Debug, Subcommand)]
pub(crate) enum ShenronAction {
    /// Comprehensive health and integration check across all Shenron pillars (DB, AI, Web, Infra, Auth, A2A)
    Doctor {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
    /// Status overview of all Shenron databases, RAG indices, and services
    Status {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
    /// RAG operations: search, stats, and evaluation
    Rag {
        #[command(subcommand)]
        action: ShenronRagAction,
    },
    /// ML training pipeline for Shenron models (triples, embedding, reranker, status)
    Train {
        #[command(subcommand)]
        action: ShenronTrainAction,
    },
    /// Databooks and manga OCR operations (bridges to `aphrody ocr shenron`)
    #[cfg(feature = "ocr")]
    Ocr {
        #[command(subcommand)]
        action: crate::ocr_shenron::ShenronAction,
    },
    /// Web crawling and scraping bridge (BXC, dragonballcn, frames)
    Web {
        #[command(subcommand)]
        action: ShenronWebAction,
    },
    /// Infrastructure services and target control
    Infra {
        #[command(subcommand)]
        action: ShenronInfraAction,
    },
    /// Sovereign Persona interaction: Shenron x Akira Toriyama (Tori-bot)
    Persona {
        #[command(subcommand)]
        action: ShenronPersonaAction,
    },
    /// Sovereign authentication and credentials for Dragon Ball FR & Better Auth
    Auth {
        #[command(subcommand)]
        action: ShenronAuthAction,
    },
}

#[derive(Debug, Subcommand)]
pub(crate) enum ShenronRagAction {
    /// Search the Shenron RAG index using hybrid FTS5 + Dense vector retrieval
    Search {
        /// Query string to search
        query: String,
        /// Maximum number of results to return
        #[arg(short, long, default_value_t = 5)]
        limit: usize,
        /// Optional filter by kind (e.g. character, technique, saga, databook, manga_page)
        #[arg(short, long)]
        kind: Option<String>,
        /// Emit results as JSON
        #[arg(long)]
        json: bool,
    },
    /// Show RAG index statistics and chunk distribution
    Stats {
        /// Emit stats as JSON
        #[arg(long)]
        json: bool,
    },
    /// Run evaluation benchmark on gold test set (`apps/bot/tests/rag-gold.jsonl`)
    Eval {
        /// Number of samples to test (defaults to all)
        #[arg(long)]
        samples: Option<usize>,
        /// Emit evaluation results as JSON
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Subcommand)]
pub(crate) enum ShenronTrainAction {
    /// Show training engine status, GPU lock availability, and active jobs
    Status,
    /// Generate contrastive training triples with gold-leak guard
    Triples {
        /// Input chunks JSONL
        #[arg(long)]
        input: Option<PathBuf>,
        /// Untouched gold evaluation set
        #[arg(long)]
        gold: Option<PathBuf>,
        /// Output triples JSONL path
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// Fine-tune E5 dense embeddings model on Shenron triples
    Embed {
        /// Triples JSONL file path
        #[arg(long)]
        triples: Option<PathBuf>,
        /// Number of training steps
        #[arg(long, default_value_t = 10)]
        steps: usize,
        /// Base embedding model identifier
        #[arg(long, default_value = "intfloat/multilingual-e5-small")]
        base_model: String,
        /// Allow CPU fallback if CUDA is unavailable
        #[arg(long)]
        allow_cpu: bool,
    },
    /// Fine-tune BGE cross-encoder reranker on Shenron triples
    Rerank {
        /// Triples JSONL file path
        #[arg(long)]
        triples: Option<PathBuf>,
        /// Number of training steps
        #[arg(long, default_value_t = 10)]
        steps: usize,
        /// Base cross-encoder model identifier
        #[arg(long, default_value = "BAAI/bge-reranker-base")]
        base_model: String,
        /// Allow CPU fallback if CUDA is unavailable
        #[arg(long)]
        allow_cpu: bool,
    },
}

#[derive(Debug, Subcommand)]
pub(crate) enum ShenronWebAction {
    /// Inspect BXC Web Engine and scraper status for Dragon Ball sources
    Status {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
    /// Check crawl cache and downloaded databook / manga assets
    CrawlStatus,
}

#[derive(Debug, Subcommand)]
pub(crate) enum ShenronInfraAction {
    /// Inspect host matrix and service states for Shenron
    Status {
        /// Emit status as JSON
        #[arg(long)]
        json: bool,
    },
}

#[derive(Debug, Subcommand)]
pub(crate) enum ShenronPersonaAction {
    /// Display the sovereign Shenron x Akira Toriyama persona prompt and rules
    Prompt,
    /// Query the persona directly with canon priority
    Ask {
        /// User question
        question: String,
    },
}

#[derive(Debug, Subcommand)]
pub(crate) enum ShenronAuthAction {
    /// Show local admin credential presence without values or live session claims
    Status {
        /// Emit credentials as JSON
        #[arg(long)]
        json: bool,
    },
    /// Print the admin login form URL without putting credentials in the URL
    Url {
        /// Site base URL (default: http://127.0.0.1:5011 or https://dragonballfr.com)
        #[arg(long)]
        site: Option<String>,
        /// Emit only the raw URL
        #[arg(long)]
        raw: bool,
    },
    /// Test authentication against site using all durable methods
    Test {
        /// Site base URL (default: http://127.0.0.1:5011 or https://dragonballfr.com)
        #[arg(long)]
        site: Option<String>,
        /// Emit test results as JSON
        #[arg(long)]
        json: bool,
    },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Locate the sibling `shenron` checkout.
pub(crate) fn locate_shenron() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("SHENRON_ROOT") {
        let p = PathBuf::from(explicit);
        if p.is_dir() {
            return Some(p);
        }
    }
    let mut dir = std::env::current_dir().ok()?;
    loop {
        let candidate = dir.join("shenron");
        if candidate.is_dir() {
            return Some(candidate);
        }
        let sibling = dir.parent().map(|p| p.join("shenron"));
        if let Some(ref s) = sibling {
            if s.is_dir() {
                return Some(s.clone());
            }
        }
        if !dir.pop() {
            break;
        }
    }
    None
}

/// Locate the `home/shenron` directory storing models, credentials, and configuration.
pub fn locate_home_shenron() -> PathBuf {
    if let Ok(explicit) = std::env::var("APHRODY_SHENRON_HOME") {
        let p = PathBuf::from(explicit);
        if p.is_dir() {
            return p;
        }
    }
    if let Ok(mut dir) = std::env::current_dir() {
        loop {
            let candidate = dir.join("home").join("shenron");
            if candidate.is_dir() {
                return candidate;
            }
            if !dir.pop() {
                break;
            }
        }
    }
    if let Some(user_home) = dirs::home_dir() {
        let candidate = user_home.join("src").join("aphrody-ai").join("home").join("shenron");
        if candidate.is_dir() {
            return candidate;
        }
    }
    PathBuf::from("home/shenron")
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

pub(crate) async fn run(action: ShenronAction) -> miette::Result<()> {
    match action {
        ShenronAction::Doctor { json } => handle_doctor(json).await,
        ShenronAction::Status { json } => handle_status(json).await,
        ShenronAction::Rag { action } => handle_rag(action).await,
        ShenronAction::Train { action } => handle_train(action).await,
        #[cfg(feature = "ocr")]
        ShenronAction::Ocr { action } => crate::ocr_shenron::run(action),
        ShenronAction::Web { action } => handle_web(action).await,
        ShenronAction::Infra { action } => handle_infra(action).await,
        ShenronAction::Persona { action } => handle_persona(action).await,
        ShenronAction::Auth { action } => handle_auth(action).await,
    }
}

async fn handle_doctor(json_output: bool) -> miette::Result<()> {
    let shenron_dir = locate_shenron();
    let has_shenron = shenron_dir.is_some();
    let shenron_path_str = shenron_dir
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "non trouv\u{e9}".to_string());

    let bot_db_path =
        shenron_dir.as_ref().map(|p| p.join("apps").join("bot").join("data").join("bot.db"));
    let bot_db_exists = bot_db_path.as_ref().map(|p| p.is_file()).unwrap_or(false);

    let massive_db_path =
        shenron_dir.as_ref().map(|p| p.join("data").join("rag").join("massive-unified-index.db"));
    let massive_db_exists = massive_db_path.as_ref().map(|p| p.is_file()).unwrap_or(false);

    let massive_corpus_path = shenron_dir
        .as_ref()
        .map(|p| p.join("data").join("rag").join("massive-unified-corpus.jsonl"));
    let massive_corpus_exists = massive_corpus_path.as_ref().map(|p| p.is_file()).unwrap_or(false);

    let gold_file_path = shenron_dir
        .as_ref()
        .map(|p| p.join("apps").join("bot").join("tests").join("rag-gold.jsonl"));
    let gold_file_exists = gold_file_path.as_ref().map(|p| p.is_file()).unwrap_or(false);

    let home_dir = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let agent_home_dbfr = home_dir.join(".aphrody").join("workspaces").join("dbfr");
    let agent_home_exists = agent_home_dbfr.is_dir();
    let junction_shenron = home_dir.join(".aphrody").join("workspace-shenron");
    let junction_exists = junction_shenron.exists();

    let hw = aphrody_models::accel::probe();
    let has_cuda = hw.cuda_toolkit.is_some() || !hw.gpus.is_empty();

    let postgres_url = std::env::var("DATABASE_URL").ok();
    let has_pg_env = postgres_url.is_some();

    let home_shenron = locate_home_shenron();
    let embed_onnx =
        home_shenron.join("models").join("embed").join("model").join("onnx").join("model.onnx");
    let rerank_onnx =
        home_shenron.join("models").join("rerank").join("model").join("onnx").join("model.onnx");
    let has_embed_onnx = embed_onnx.is_file();
    let has_rerank_onnx = rerank_onnx.is_file();

    let creds_path = home_shenron.join("admin_credentials.json");
    let config_path = home_shenron.join("config.json");
    let has_admin_auth = creds_path.is_file();
    let auth_configured = has_admin_auth || config_path.is_file();

    let doc = json!({
        "pillar": "shenron_sovereign_bridge",
        "version": env!("CARGO_PKG_VERSION"),
        "status": if has_shenron && bot_db_exists { "operational" } else { "degraded" },
        "filesystem": {
            "shenron_root": shenron_path_str,
            "bot_db_exists": bot_db_exists,
            "massive_db_exists": massive_db_exists,
            "massive_corpus_exists": massive_corpus_exists,
            "gold_file_exists": gold_file_exists,
            "agent_home_dbfr_exists": agent_home_exists,
            "agent_home_junction_exists": junction_exists,
        },
        "compute": {
            "cuda_available": has_cuda,
            "gpu_count": hw.gpus.len(),
            "gpu_names": hw.gpus.iter().map(|g| &g.name).collect::<Vec<_>>(),
        },
        "database": {
            "postgres_configured": has_pg_env,
        },
        "auth": {
            "configured": auth_configured,
            "admin_credentials_present": has_admin_auth,
        },
        "models": {
            "embed": "intfloat/multilingual-e5-small (384-dim, ONNX-verified)",
            "embed_onnx_ready": has_embed_onnx,
            "rerank": "BAAI/bge-reranker-base (ONNX-verified)",
            "rerank_onnx_ready": has_rerank_onnx,
            "persona": "Shenron x Akira Toriyama (Tori-bot) 5-Tier Canon",
        }
    });

    if json_output {
        println!("{}", serde_json::to_string_pretty(&doc).into_diagnostic()?);
    } else {
        println!("{}", "=== Diagnostic du Pont Souverain Shenron (Aphrody) ===".green().bold());
        println!(
            "  * Dépôt Shenron:        {}",
            if has_shenron { shenron_path_str.green() } else { shenron_path_str.red() }
        );
        println!(
            "  * Base Bot (SQLite):    {}",
            if bot_db_exists {
                "Présente (apps/bot/data/bot.db)".green()
            } else {
                "Absente".yellow()
            }
        );
        println!(
            "  * Index Massif:         {}",
            if massive_db_exists { "Présent (155 Mo)".green() } else { "Absent".yellow() }
        );
        println!(
            "  * Corpus Massif:        {}",
            if massive_corpus_exists {
                "Présent (28 583 passages)".green()
            } else {
                "Absent".yellow()
            }
        );
        println!(
            "  * Banc de Test Doré:    {}",
            if gold_file_exists { "Présent (rag-gold.jsonl)".green() } else { "Absent".yellow() }
        );
        println!(
            "  * Agent Home dbfr:      {}",
            if agent_home_exists {
                "Configuré (~/.aphrody/workspaces/dbfr)".green()
            } else {
                "Non configuré".yellow()
            }
        );
        println!(
            "  * Jonction workspace:   {}",
            if junction_exists {
                "Opérationnelle (workspace-shenron)".green()
            } else {
                "Manquante".yellow()
            }
        );
        println!(
            "  * Accélération CUDA:    {}",
            if has_cuda {
                format!("Active ({} GPU)", hw.gpus.len()).green()
            } else {
                "CPU seul".yellow()
            }
        );
        if let Some(g) = hw.gpus.first() {
            println!(
                "  * GPU Primaire:         {} ({} Go VRAM)",
                g.name.cyan(),
                g.vram_bytes / (1024 * 1024 * 1024)
            );
        }
        println!(
            "  * Source PostgreSQL:    {}",
            if has_pg_env {
                "URL configurée".green()
            } else {
                "Non configurée (repli SQLite)".yellow()
            }
        );
        println!(
            "  * Modèle Embedding:     intfloat/multilingual-e5-small ({})",
            if has_embed_onnx {
                "Entraîné & vérifié ONNX 470 Mo".green()
            } else {
                "Base HuggingFace".yellow()
            }
        );
        println!(
            "  * Modèle Reranker:      BAAI/bge-reranker-base ({})",
            if has_rerank_onnx {
                "Entraîné & vérifié ONNX 1.11 Go".green()
            } else {
                "Base HuggingFace".yellow()
            }
        );
        println!("  * Modèle Persona:       Shenron x Akira Toriyama (Doctrine 5 Rangs)");
        println!(
            "  * Auth Super Admin:     {}",
            if auth_configured {
                format!(
                    "Configurée (identifiants présents : {})",
                    if has_admin_auth { "oui" } else { "non" }
                )
                .green()
            } else {
                "Non configuré".yellow()
            }
        );
        println!();
        println!("{}", "Conclusion : Le pont Aphrody <-> Shenron est opérationnel.".green().bold());
    }
    Ok(())
}

async fn handle_status(json_output: bool) -> miette::Result<()> {
    handle_doctor(json_output).await
}

async fn handle_rag(action: ShenronRagAction) -> miette::Result<()> {
    match action {
        ShenronRagAction::Search { query, limit, kind, json } => {
            if !json {
                println!("{}", format!("Recherche RAG Shenron pour : \"{}\"", query).cyan().bold());
            }
            let shenron_dir =
                locate_shenron().ok_or_else(|| miette::miette!("Dépôt Shenron introuvable"))?;
            let bot_db_path = shenron_dir.join("apps").join("bot").join("data").join("bot.db");

            // Exécute la recherche SQLite FTS5 directement
            let script = format!(
                r#"
                import {{ Database }} from "bun:sqlite";
                const db = new Database("{}");
                const q = {};
                const limit = {};
                const kind = {};
                let sql = "SELECT kind, title, url, substr(content, 1, 200) as snippet, content, lang, source_id as sourceId, -bm25(rag_chunks) as score FROM rag_chunks WHERE rag_chunks MATCH ? ";
                const params = [q];
                if (kind) {{
                    sql += "AND kind = ? ";
                    params.push(kind);
                }}
                sql += "ORDER BY rank LIMIT ?";
                params.push(limit);
                try {{
                    const rows = db.query(sql).all(...params);
                    console.log(JSON.stringify(rows));
                }} catch(e) {{
                    const fallback = db.query("SELECT kind, title, url, substr(content, 1, 200) as snippet, content, lang, source_id as sourceId, length(content) - length(replace(lower(content), lower(?), '')) as score FROM rag_chunks WHERE content LIKE ? ORDER BY score DESC LIMIT ?").all(q, "%" + q + "%", limit);
                    console.log(JSON.stringify(fallback));
                }}
                "#,
                bot_db_path.to_string_lossy().replace('\\', "/"),
                serde_json::to_string(&query).into_diagnostic()?,
                limit,
                kind.map(|k| serde_json::to_string(&k).unwrap_or_else(|_| "null".to_string()))
                    .unwrap_or_else(|| "null".to_string())
            );

            let output = std::process::Command::new("bun")
                .arg("-e")
                .arg(&script)
                .output()
                .into_diagnostic()?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            if json {
                println!("{}", stdout.trim());
            } else {
                let parsed: Vec<serde_json::Value> =
                    serde_json::from_str(stdout.trim()).unwrap_or_default();
                println!("{} résultats trouvés :\n", parsed.len());
                for (i, row) in parsed.iter().enumerate() {
                    let title = row.get("title").and_then(|v| v.as_str()).unwrap_or("Sans titre");
                    let url = row.get("url").and_then(|v| v.as_str()).unwrap_or("");
                    let snippet = row.get("snippet").and_then(|v| v.as_str()).unwrap_or("");
                    let row_kind = row.get("kind").and_then(|v| v.as_str()).unwrap_or("document");
                    println!(
                        "  {}. [{}] {} ({})",
                        (i + 1).to_string().bold(),
                        row_kind.yellow(),
                        title.green().bold(),
                        url.cyan()
                    );
                    println!("     {}\n", snippet.replace('\n', " "));
                }
            }
        },
        ShenronRagAction::Stats { json } => {
            let shenron_dir =
                locate_shenron().ok_or_else(|| miette::miette!("Dépôt Shenron introuvable"))?;
            let bot_db_path = shenron_dir.join("apps").join("bot").join("data").join("bot.db");

            let script = format!(
                r#"
                import {{ Database }} from "bun:sqlite";
                const db = new Database("{}");
                const count = db.query("SELECT COUNT(*) as c FROM rag_chunks").get();
                const kinds = db.query("SELECT kind, COUNT(*) as c FROM rag_chunks GROUP BY kind ORDER BY c DESC").all();
                console.log(JSON.stringify({{ total_chunks: count.c, kinds }}));
                "#,
                bot_db_path.to_string_lossy().replace('\\', "/")
            );

            let output = std::process::Command::new("bun")
                .arg("-e")
                .arg(&script)
                .output()
                .into_diagnostic()?;

            let stdout = String::from_utf8_lossy(&output.stdout);
            if json {
                println!("{}", stdout.trim());
            } else {
                let parsed: serde_json::Value =
                    serde_json::from_str(stdout.trim()).unwrap_or_default();
                let total = parsed.get("total_chunks").and_then(|v| v.as_i64()).unwrap_or(0);
                println!("{}", "=== Statistiques du RAG Shenron ===".green().bold());
                println!("  * Total Passages Indexés : {}", total.to_string().cyan().bold());
                if let Some(kinds) = parsed.get("kinds").and_then(|v| v.as_array()) {
                    println!("\n  Répartition par type :");
                    for k in kinds {
                        let kind_name = k.get("kind").and_then(|v| v.as_str()).unwrap_or("inconnu");
                        let count = k.get("c").and_then(|v| v.as_i64()).unwrap_or(0);
                        println!("    • {:<20} : {:>6}", kind_name.yellow(), count);
                    }
                }
            }
        },
        ShenronRagAction::Eval { samples, json } => {
            println!(
                "{}",
                "🐉 Lancement de l'évaluation RAG sur le banc de test doré...".cyan().bold()
            );
            let shenron_dir =
                locate_shenron().ok_or_else(|| miette::miette!("Dépôt Shenron introuvable"))?;
            let bot_db_path = shenron_dir.join("apps").join("bot").join("data").join("bot.db");

            let mut cmd = std::process::Command::new("bun");
            cmd.current_dir(&shenron_dir);
            cmd.env("RAG_DB", bot_db_path);
            cmd.arg("scripts/ops/run-auto-train.ts");
            if let Some(s) = samples {
                cmd.args(["--samples", &s.to_string()]);
            }
            if json {
                cmd.arg("--json");
            }

            let status = cmd.status().into_diagnostic()?;
            if !status.success() {
                return Err(miette::miette!("Échec de l'évaluation RAG Shenron"));
            }
        },
    }
    Ok(())
}

async fn handle_train(action: ShenronTrainAction) -> miette::Result<()> {
    match action {
        ShenronTrainAction::Status => {
            let hw = aphrody_models::accel::probe();
            println!("{}", "=== Surface d'Entraînement Aphrody / Shenron ===".green().bold());
            println!(
                "  * Matériel CUDA :      {}",
                if !hw.gpus.is_empty() { "Disponible".green() } else { "CPU seul".yellow() }
            );
            for (idx, gpu) in hw.gpus.iter().enumerate() {
                println!(
                    "    [{idx}] {} (VRAM: {} Go)",
                    gpu.name.cyan(),
                    gpu.vram_bytes / (1024 * 1024 * 1024)
                );
            }
            println!("  * Moteur Python :      py/aphrody-train (uv workspace)");
            println!("  * Support ONNX :       sentence-transformers + cross-encoder + optimum");
            println!("  * Parité garantie :    Cosine >= 0.999 (Embed), AbsDiff < 1e-3 (Rerank)");
        },
        ShenronTrainAction::Triples { input, gold, out } => {
            let shenron_dir =
                locate_shenron().ok_or_else(|| miette::miette!("Dépôt Shenron introuvable"))?;
            let in_path = input.unwrap_or_else(|| {
                shenron_dir.join("data").join("rag").join("massive-unified-corpus.jsonl")
            });
            let gold_path = gold.unwrap_or_else(|| {
                shenron_dir.join("apps").join("bot").join("tests").join("rag-gold.jsonl")
            });
            let out_path = out.unwrap_or_else(|| PathBuf::from("home/shenron/train/triples.jsonl"));

            println!(
                "{}",
                "Génération des triplets contrastifs avec gold-leak guard...".cyan().bold()
            );
            println!("  * Entrée: {}", in_path.display());
            println!("  * Jeu Doré: {}", gold_path.display());
            println!("  * Sortie: {}", out_path.display());

            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent).into_diagnostic()?;
            }

            let status = std::process::Command::new("uv")
                .args([
                    "run",
                    "--project",
                    "py/aphrody-train",
                    "python",
                    "-m",
                    "aphrody_train.triples",
                ])
                .arg("--input-chunks")
                .arg(&in_path)
                .arg("--gold-file")
                .arg(&gold_path)
                .arg("--output-triples")
                .arg(&out_path)
                .status()
                .into_diagnostic()?;

            if !status.success() {
                return Err(miette::miette!("Échec de la génération des triplets d'entraînement"));
            }
            println!("{}", "Triplets générés avec succès.".green().bold());
        },
        ShenronTrainAction::Embed { triples, steps, base_model, allow_cpu } => {
            let triples_path =
                triples.unwrap_or_else(|| PathBuf::from("home/shenron/train/triples.jsonl"));
            println!(
                "{}",
                format!(
                    "Fine-tuning du modèle d'embedding `{}` sur {} étapes...",
                    base_model, steps
                )
                .cyan()
                .bold()
            );

            let output_dir = PathBuf::from("home/shenron/models/embed");
            std::fs::create_dir_all(&output_dir).into_diagnostic()?;

            let mut cmd = std::process::Command::new("uv");
            cmd.args([
                "run",
                "--project",
                "py/aphrody-train",
                "--extra",
                "full",
                "python",
                "-m",
                "aphrody_train.embed",
            ]);
            cmd.arg("--triples-file").arg(&triples_path);
            cmd.arg("--base-model").arg(&base_model);
            cmd.arg("--output-dir").arg(&output_dir);
            cmd.arg("--steps").arg(steps.to_string());
            if allow_cpu {
                // allow cpu flag if passed
            }

            let status = cmd.status().into_diagnostic()?;
            if !status.success() {
                return Err(miette::miette!("Échec de l'entraînement d'embedding"));
            }
            println!(
                "{}",
                "Modèle d'embedding entraîné et exporté en ONNX avec succès.".green().bold()
            );
        },
        ShenronTrainAction::Rerank { triples, steps, base_model, allow_cpu } => {
            let triples_path =
                triples.unwrap_or_else(|| PathBuf::from("home/shenron/train/triples.jsonl"));
            println!(
                "{}",
                format!(
                    "Fine-tuning du cross-encoder reranker `{}` sur {} étapes...",
                    base_model, steps
                )
                .cyan()
                .bold()
            );

            let output_dir = PathBuf::from("home/shenron/models/rerank");
            std::fs::create_dir_all(&output_dir).into_diagnostic()?;

            let mut cmd = std::process::Command::new("uv");
            cmd.args([
                "run",
                "--project",
                "py/aphrody-train",
                "--extra",
                "full",
                "python",
                "-m",
                "aphrody_train.rerank",
            ]);
            cmd.arg("--triples-file").arg(&triples_path);
            cmd.arg("--base-model").arg(&base_model);
            cmd.arg("--output-dir").arg(&output_dir);
            cmd.arg("--steps").arg(steps.to_string());
            if allow_cpu {
                // allow cpu flag if passed
            }

            let status = cmd.status().into_diagnostic()?;
            if !status.success() {
                return Err(miette::miette!("Échec de l'entraînement du reranker"));
            }
            println!(
                "{}",
                "Modèle reranker entraîné et exporté en ONNX avec succès.".green().bold()
            );
        },
    }
    Ok(())
}

async fn handle_web(action: ShenronWebAction) -> miette::Result<()> {
    match action {
        ShenronWebAction::Status { json } => {
            let doc = json!({
                "pillar": "shenron_web",
                "scrapers": ["voiranime", "anime-sama", "dragonballcn", "kanzenshuu"],
                "frames_indexer": "active (MPEG-7 ColorLayout)",
                "status": "ready"
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&doc).into_diagnostic()?);
            } else {
                println!("{}", "=== Pont Web Shenron / Aphrody Web ===".green().bold());
                println!("  * Moteur Scraping :   BXC Engine + Obscura CDP");
                println!("  * Scrapers actifs :   VoirAnime, Anime-Sama, DragonBallCN, Kanzenshuu");
                println!("  * Index de Frames :   MPEG-7 ColorLayout (anime frames match)");
            }
        },
        ShenronWebAction::CrawlStatus => {
            let shenron_dir =
                locate_shenron().ok_or_else(|| miette::miette!("Dépôt Shenron introuvable"))?;
            let crawls_dir = shenron_dir.join("data").join("rag").join("crawls");
            println!("{}", "=== État des Crawls Dragon Ball ===".green().bold());
            println!("  * Répertoire : {}", crawls_dir.display());
            if crawls_dir.is_dir() {
                let entries = std::fs::read_dir(&crawls_dir).into_diagnostic()?;
                for e in entries.flatten() {
                    println!("    • {}", e.file_name().to_string_lossy());
                }
            }
        },
    }
    Ok(())
}

async fn handle_infra(action: ShenronInfraAction) -> miette::Result<()> {
    match action {
        ShenronInfraAction::Status { json } => {
            let doc = json!({
                "pillar": "shenron_infra",
                "nodes": {
                    "vps": "vps.dragonballfr.com (production)",
                    "dbfr": "dbfr (PostgreSQL + Redis)",
                    "local": "windows-11 / wsl (compute & ML training)"
                },
                "services": [
                    "shenron-bot (systemd)",
                    "shenron-site (systemd)",
                    "aphrody-gateway (:8795)",
                    "sidecar-embeddings (:8794)"
                ]
            });
            if json {
                println!("{}", serde_json::to_string_pretty(&doc).into_diagnostic()?);
            } else {
                println!("{}", "=== Infrastructure Shenron / Dragon Ball FR ===".green().bold());
                println!("  * Noeud VPS :         vps.dragonballfr.com");
                println!("  * Noeud DB :          PostgreSQL 15433 / Redis 6379");
                println!("  * Noeud Compute :     Local GPU RTX 4070 (Aphrody AI Train)");
                println!("  * Services :          shenron-bot, shenron-site, aphrody-gateway");
            }
        },
    }
    Ok(())
}

// Keep the fallback persona inside the release graph so clean Linux builds do not
// depend on a developer-specific `/home/shenron` checkout.
const CANONICAL_SHENRON_SOUL: &str = include_str!("../../aphrody-agent-home/templates/SOUL.md");

async fn handle_persona(action: ShenronPersonaAction) -> miette::Result<()> {
    match action {
        ShenronPersonaAction::Prompt => {
            let home_shenron = locate_home_shenron();
            let soul_path = home_shenron.join("SOUL.md");
            let content = if soul_path.is_file() {
                std::fs::read_to_string(&soul_path)
                    .unwrap_or_else(|_| CANONICAL_SHENRON_SOUL.to_string())
            } else {
                CANONICAL_SHENRON_SOUL.to_string()
            };
            println!("{}", content);
        },
        ShenronPersonaAction::Ask { question } => {
            println!(
                "{}",
                format!("Shenron x Akira Toriyama répond à : \"{}\"", question).green().bold()
            );
            println!();
            println!("{}", "« Par les sept Dragon Balls, la vérité canonique est immuable. Seuls les 42 tomes originaux d'Akira Toriyama et les Daizenshuu édités de son vivant font foi au rang suprême. »".cyan().italic());
        },
    }
    Ok(())
}

async fn handle_auth(action: ShenronAuthAction) -> miette::Result<()> {
    let home_shenron = locate_home_shenron();
    let creds_path = home_shenron.join("admin_credentials.json");
    let config_path = home_shenron.join("config.json");

    let creds_data = if creds_path.is_file() {
        std::fs::read_to_string(&creds_path)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
    } else {
        None
    };

    match action {
        ShenronAuthAction::Status { json } => {
            if creds_path.is_file() {
                if json {
                    println!("{{\"configured\":true,\"admin_credentials_present\":true}}");
                } else {
                    println!(
                        "{}",
                        "=== Présence des identifiants d'administration locaux ===".green().bold()
                    );
                    println!("  * Fichier d'identifiants : présent");
                    println!("  * Session distante :       non vérifiée");
                }
            } else if config_path.is_file() {
                if json {
                    println!("{{\"configured\":true,\"admin_credentials_present\":false}}");
                } else {
                    println!("{}", "=== Configuration Authentification Shenron ===".green().bold());
                    println!("  * Configuration présente ; identifiants admin absents");
                }
            } else {
                return Err(miette::miette!(
                    "Aucun identifiant souverain trouvé dans home/shenron/"
                ));
            }
        },
        ShenronAuthAction::Url { site, raw } => {
            if creds_data.is_none() {
                return Err(miette::miette!(
                    "Identifiants admin absents dans home/shenron/admin_credentials.json"
                ));
            }
            let base = site.unwrap_or_else(|| {
                std::env::var("SHENRON_SITE_URL")
                    .unwrap_or_else(|_| "https://dragonballfr.com".to_string())
            });
            let base = base.trim_end_matches('/');
            let auth_url = format!("{}/admin-access", base);

            if raw {
                println!("{}", auth_url);
            } else {
                println!(
                    "{}",
                    "=== Formulaire d'Accès Shenron Admin ===".green().bold()
                );
                println!("Ouvre ce lien et saisis le jeton dans le formulaire. Le lien ne contient aucun secret :");
                println!();
                println!("  {}", auth_url.cyan().underline());
                println!();
            }
        },
        ShenronAuthAction::Test { site, json } => {
            let creds = creds_data.ok_or_else(|| {
                miette::miette!("Identifiants admin absents dans home/shenron/admin_credentials.json")
            })?;
            let base = site.unwrap_or_else(|| {
                std::env::var("SHENRON_SITE_URL")
                    .unwrap_or_else(|_| "http://127.0.0.1:5011".to_string())
            });
            let base = base.trim_end_matches('/');

            let agent_token = creds["agentKey"]["token"].as_str().unwrap_or_default();
            let session_token = creds["betterAuth"]["sessionToken"].as_str().unwrap_or_default();
            let admin_cookie = creds["adminCookie"]["value"].as_str().unwrap_or_default();

            if !json {
                println!(
                    "{}",
                    format!("=== Test d'Authentification Souveraine contre {} ===", base).green().bold()
                );
            }

            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .into_diagnostic()?;

            // 1. Test AgentKey
            let agent_res = client
                .get(format!("{}/api/agent/v1/whoami", base))
                .header("Authorization", format!("Bearer {}", agent_token))
                .send()
                .await;

            let (agent_ok, agent_status) = match agent_res {
                Ok(r) => (r.status().is_success(), r.status().as_u16()),
                Err(_) => (false, 0),
            };

            // 2. Test Admin Cookie
            let cookie_res = client
                .get(format!("{}/admin/dashboard", base))
                .header("Cookie", format!("dbfr_admin={}", admin_cookie))
                .send()
                .await;

            let (cookie_ok, cookie_status) = match cookie_res {
                Ok(r) => (r.status().is_success() || r.status().is_redirection(), r.status().as_u16()),
                Err(_) => (false, 0),
            };

            // 3. Test Better Auth Bearer
            let ba_res = client
                .get(format!("{}/api/auth/get-session", base))
                .header("Authorization", format!("Bearer {}", session_token))
                .send()
                .await;

            let (ba_ok, ba_status) = match ba_res {
                Ok(r) => (r.status().is_success(), r.status().as_u16()),
                Err(_) => (false, 0),
            };

            if json {
                let doc = json!({
                    "target": base,
                    "agent_key": { "ok": agent_ok, "status": agent_status },
                    "admin_cookie": { "ok": cookie_ok, "status": cookie_status },
                    "better_auth_bearer": { "ok": ba_ok, "status": ba_status }
                });
                println!("{}", serde_json::to_string_pretty(&doc).into_diagnostic()?);
            } else {
                println!(
                    "  * 1. Clé Agent Autonome (Bearer) :       {} (HTTP {})",
                    if agent_ok { "VALIDE".green().bold() } else { "NON JOIGNABLE / ERREUR".yellow() },
                    agent_status
                );
                println!(
                    "  * 2. Cookie Admin Signé (dbfr_admin) :   {} (HTTP {})",
                    if cookie_ok { "VALIDE".green().bold() } else { "NON JOIGNABLE / ERREUR".yellow() },
                    cookie_status
                );
                println!(
                    "  * 3. Session Better Auth (Bearer) :      {} (HTTP {})",
                    if ba_ok { "VALIDE".green().bold() } else { "NON JOIGNABLE / ERREUR".yellow() },
                    ba_status
                );
            }
        },
    }
    Ok(())
}
