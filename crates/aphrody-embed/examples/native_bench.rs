//! Throughput benchmark on deterministic web-like chunks.
//!
//! ```text
//! cargo run --release --example bench -- [--task embed|rerank] [--chunks 2000]
//!                                         [--threads 8,12] [--batch 16,32,64]
//!                                         [--mode stream,bulk] [--model <id>] [--max-seq-len N]
//!                                         [--backend native|candle] [--dump-corpus corpus.json]
//! ```
//!
//! * `stream`: the corpus is sent as consecutive `embed_batch` calls of `batch` texts (what a
//!   crawler pipeline does); reports chunks/s and p50/p95 latency per call.
//! * `bulk`: the whole corpus in one call; the embedder buckets by length internally and runs
//!   forward passes of at most `batch` texts in parallel.
//! * `--task rerank`: consecutive `Reranker::score` calls with one 8-word query and `batch`
//!   passages each (stream mode only); throughput is in pairs/s.

use std::time::{Duration, Instant};

use aphrody_embed::native::{
    Backend, EmbedOptions, Embedder, ModelFiles, TextKind, ensure_model, find_model,
};

const WORDS: &[&str] = &[
    "the",
    "of",
    "and",
    "to",
    "in",
    "a",
    "is",
    "that",
    "for",
    "it",
    "as",
    "was",
    "with",
    "be",
    "by",
    "on",
    "not",
    "he",
    "this",
    "are",
    "or",
    "his",
    "from",
    "at",
    "which",
    "but",
    "have",
    "an",
    "had",
    "they",
    "you",
    "were",
    "their",
    "one",
    "all",
    "we",
    "can",
    "her",
    "has",
    "there",
    "been",
    "if",
    "more",
    "when",
    "will",
    "would",
    "who",
    "so",
    "no",
    "page",
    "search",
    "results",
    "privacy",
    "policy",
    "cookies",
    "account",
    "login",
    "download",
    "release",
    "version",
    "update",
    "server",
    "client",
    "browser",
    "network",
    "request",
    "response",
    "latency",
    "cache",
    "index",
    "crawler",
    "sitemap",
    "domain",
    "subscription",
    "pricing",
    "customers",
    "product",
    "features",
    "documentation",
    "tutorial",
    "installation",
    "configuration",
    "database",
    "performance",
    "security",
    "authentication",
    "token",
    "session",
    "framework",
    "javascript",
    "rendering",
    "hydration",
    "component",
    "deployment",
    "kubernetes",
    "container",
    "analytics",
    "dashboard",
    "metrics",
    "football",
    "transfer",
    "season",
    "league",
    "players",
    "championship",
    "recipe",
    "chocolate",
    "oven",
    "minutes",
    "ingredients",
    "travel",
    "hotel",
    "flights",
    "booking",
    "museum",
    "history",
    "century",
    "government",
    "election",
    "policy",
    "economy",
    "inflation",
    "market",
    "shares",
    "investors",
    "climate",
    "temperature",
    "research",
    "university",
    "students",
    "science",
    "quantum",
    "neural",
    "embedding",
    "vector",
    "transformer",
    "attention",
    "language",
    "model",
    "anime",
    "episode",
    "character",
    "studio",
    "manga",
    "chapter",
    "streaming",
    "subtitles",
    "weather",
    "forecast",
    "rain",
    "tomorrow",
    "morning",
    "shipping",
    "delivery",
    "warranty",
    "returns",
    "support",
    "contact",
    "email",
    "phone",
    "address",
    "open",
    "hours",
    "monday",
    "reviews",
    "rating",
    "stars",
    "comments",
    "share",
    "newsletter",
    "subscribe",
    "follow",
    "copyright",
    "rights",
    "reserved",
    "terms",
    "conditions",
    "2024",
    "2025",
    "42",
    "3.14",
    "https://example.com/docs",
    "v1.2.3",
    "API",
    "JSON",
    "HTTP/2",
    "CEO",
    "EU",
    "U.S.",
    "unprecedented",
    "straightforward",
    "interoperability",
    "notwithstanding",
];

/// Minimal deterministic PRNG (SplitMix64) so the corpus is identical on every run.
struct SplitMix64(u64);

impl SplitMix64 {
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
}

/// `count` chunks of 60–200 words made of 6–24-word sentences.
pub fn web_corpus(count: usize, seed: u64) -> Vec<String> {
    let mut rng = SplitMix64(seed);
    (0..count)
        .map(|_| {
            let target = 60 + rng.below(141);
            let mut out = String::with_capacity(target * 8);
            let mut words = 0;
            while words < target {
                let sentence = (6 + rng.below(19)).min(target - words).max(1);
                for w in 0..sentence {
                    let word = WORDS[rng.below(WORDS.len())];
                    if w == 0 {
                        let mut chars = word.chars();
                        if let Some(first) = chars.next() {
                            out.extend(first.to_uppercase());
                            out.push_str(chars.as_str());
                        }
                    } else {
                        out.push(' ');
                        out.push_str(word);
                    }
                }
                out.push_str(if rng.below(8) == 0 { "? " } else { ". " });
                words += sentence;
            }
            out.trim_end().to_string()
        })
        .collect()
}

fn list(args: &[String], flag: &str, default: &str) -> Vec<String> {
    args.iter()
        .position(|a| a == flag)
        .and_then(|i| args.get(i + 1))
        .map(String::as_str)
        .unwrap_or(default)
        .split(',')
        .map(str::to_string)
        .collect()
}

fn peak_rss_mib() -> f64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("VmHWM:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|kb| kb.parse::<f64>().ok())
        })
        .map(|kb| kb / 1024.0)
        .unwrap_or(f64::NAN)
}

/// User + system CPU time consumed by this process so far (Linux, clock ticks = 100 Hz).
fn cpu_seconds() -> f64 {
    std::fs::read_to_string("/proc/self/stat")
        .ok()
        .and_then(|s| {
            let rest = &s[s.rfind(')')? + 2..];
            let fields: Vec<&str> = rest.split_whitespace().collect();
            let utime: f64 = fields.get(11)?.parse().ok()?;
            let stime: f64 = fields.get(12)?.parse().ok()?;
            Some((utime + stime) / 100.0)
        })
        .unwrap_or(f64::NAN)
}

fn reset_peak_rss() {
    // Linux >= 4.0: writing 5 resets VmHWM to the current RSS.
    let _ = std::fs::write("/proc/self/clear_refs", "5");
}

fn percentile(sorted: &[Duration], p: f64) -> Duration {
    if sorted.is_empty() {
        return Duration::ZERO;
    }
    let rank = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[rank.min(sorted.len() - 1)]
}

struct Row<'a> {
    mode: &'a str,
    threads: usize,
    batch: usize,
    items: usize,
    elapsed: Duration,
    cpu: f64,
    latencies: Vec<Duration>,
}

fn print_row(mut row: Row<'_>) {
    row.latencies.sort();
    let (p50, p95) = if row.latencies.is_empty() {
        ("-".to_string(), "-".to_string())
    } else {
        (
            format!("{:.0}", percentile(&row.latencies, 0.5).as_secs_f64() * 1e3),
            format!(
                "{:.0}",
                percentile(&row.latencies, 0.95).as_secs_f64() * 1e3
            ),
        )
    };
    println!(
        "| {} | {} | {} | {:.1} | {:.1} | {p50} | {p95} | {:.0} |",
        row.mode,
        row.threads,
        row.batch,
        row.items as f64 / row.elapsed.as_secs_f64(),
        row.items as f64 / row.cpu,
        peak_rss_mib()
    );
}

fn load_average() -> String {
    std::fs::read_to_string("/proc/loadavg")
        .map(|s| s.split_whitespace().take(3).collect::<Vec<_>>().join(" "))
        .unwrap_or_default()
}

type AnyResult<T> = Result<T, Box<dyn std::error::Error>>;

fn main() -> AnyResult<()> {
    let args: Vec<String> = std::env::args().collect();
    let chunks: usize = list(&args, "--chunks", "2000")[0].parse()?;
    let threads: Vec<usize> = list(&args, "--threads", "8,12")
        .iter()
        .map(|s| s.parse())
        .collect::<Result<_, _>>()?;
    let batches: Vec<usize> = list(&args, "--batch", "16,32,64")
        .iter()
        .map(|s| s.parse())
        .collect::<Result<_, _>>()?;
    let modes = list(&args, "--mode", "stream,bulk");
    let task = list(&args, "--task", "embed").remove(0);
    let max_seq_len: usize = list(&args, "--max-seq-len", "0")[0].parse()?;
    let backend = match list(&args, "--backend", "native")[0].as_str() {
        "native" => Backend::Native,
        "candle" => Backend::Candle,
        other => return Err(format!("unknown backend {other}").into()),
    };

    let corpus = web_corpus(chunks, 0x0B0C_5EED);
    if let Some(path) = list(&args, "--dump-corpus", "")
        .first()
        .filter(|p| !p.is_empty())
    {
        // Lets external baselines (PyTorch, ONNX Runtime) run on the identical corpus.
        std::fs::write(path, serde_json::to_string(&corpus)?)?;
        println!("wrote {chunks} chunks to {path}");
        return Ok(());
    }
    let refs: Vec<&str> = corpus.iter().map(String::as_str).collect();
    let cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(0);
    println!("load average before: {}", load_average());
    let unit = if task == "rerank" { "pairs" } else { "chunks" };
    println!(
        "| mode | threads | batch | {unit}/s | {unit}/CPU-s | p50 ms/call | p95 ms/call | peak \
         RSS MiB |"
    );
    println!("|---|---:|---:|---:|---:|---:|---:|---:|");

    match task.as_str() {
        "embed" => {
            let model_id =
                list(&args, "--model", aphrody_embed::native::DEFAULT_MODEL_ID).remove(0);
            let spec = find_model(&model_id).ok_or_else(|| format!("unknown model {model_id}"))?;
            let dir = ensure_model(&spec, &spec.default_dir())?;
            for &t in &threads {
                for &b in &batches {
                    let opts = EmbedOptions {
                        max_seq_len,
                        batch_size: b,
                        threads: t,
                        backend,
                    };
                    let embedder = Embedder::load(&dir, &spec, opts)?;
                    // Warm-up: page in weights and grow allocator arenas.
                    embedder.embed_batch(&refs[..b.min(refs.len())], TextKind::Passage)?;
                    for mode in &modes {
                        reset_peak_rss();
                        let mut latencies = Vec::new();
                        let cpu_start = cpu_seconds();
                        let start = Instant::now();
                        match mode.as_str() {
                            "stream" => {
                                for batch in refs.chunks(b) {
                                    let t0 = Instant::now();
                                    let out = embedder.embed_batch(batch, TextKind::Passage)?;
                                    latencies.push(t0.elapsed());
                                    assert_eq!(out.len(), batch.len());
                                }
                            }
                            "bulk" => {
                                let out = embedder.embed_batch(&refs, TextKind::Passage)?;
                                assert_eq!(out.len(), refs.len());
                            }
                            other => return Err(format!("unknown mode {other}").into()),
                        }
                        print_row(Row {
                            mode,
                            threads: t,
                            batch: b,
                            items: refs.len(),
                            elapsed: start.elapsed(),
                            cpu: cpu_seconds() - cpu_start,
                            latencies,
                        });
                    }
                }
            }
            let tokens: usize = Embedder::load(&dir, &spec, EmbedOptions::default())?
                .count_tokens(&refs, TextKind::Passage)?
                .iter()
                .sum();
            let words: usize = corpus.iter().map(|c| c.split_whitespace().count()).sum();
            println!(
                "\nmodel={} backend={backend:?} chunks={chunks} avg_words={:.1} avg_tokens={:.1} \
                 cpus={cpus}",
                spec.versioned_id(),
                words as f64 / chunks as f64,
                tokens as f64 / chunks as f64,
            );
        }
        "rerank" => {
            let model_id =
                list(&args, "--model", aphrody_embed::native::DEFAULT_RERANKER_ID).remove(0);
            let spec = aphrody_embed::native::find_reranker(&model_id)
                .ok_or_else(|| format!("unknown reranker {model_id}"))?;
            let dir = ensure_model(&spec, &spec.default_dir())?;
            let queries = web_corpus(64, 0x5EED_0001);
            let queries: Vec<String> = queries
                .iter()
                .map(|q| q.split_whitespace().take(8).collect::<Vec<_>>().join(" "))
                .collect();
            for &t in &threads {
                for &b in &batches {
                    let opts = EmbedOptions {
                        max_seq_len,
                        batch_size: b,
                        threads: t,
                        backend,
                    };
                    let reranker = aphrody_embed::native::Reranker::load(&dir, &spec, opts)?;
                    reranker.score(&queries[0], &refs[..b.min(refs.len())])?;
                    reset_peak_rss();
                    let mut latencies = Vec::new();
                    let cpu_start = cpu_seconds();
                    let start = Instant::now();
                    for (i, passages) in refs.chunks(b).enumerate() {
                        let t0 = Instant::now();
                        let scores = reranker.score(&queries[i % queries.len()], passages)?;
                        latencies.push(t0.elapsed());
                        assert_eq!(scores.len(), passages.len());
                    }
                    print_row(Row {
                        mode: "stream",
                        threads: t,
                        batch: b,
                        items: refs.len(),
                        elapsed: start.elapsed(),
                        cpu: cpu_seconds() - cpu_start,
                        latencies,
                    });
                }
            }
            println!(
                "\nreranker={} pairs={chunks} (8-word query + 60-200-word passage) cpus={cpus}",
                spec.versioned_id()
            );
        }
        other => return Err(format!("unknown task {other}").into()),
    }
    println!("load average after: {}", load_average());
    Ok(())
}
