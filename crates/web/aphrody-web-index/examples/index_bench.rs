//! Build + query benchmark.
//!
//! ```text
//! cargo run --release --example index_bench -- --n 100000 [--queries 500] [--dim 384]
//!     [--clusters 200] [--rank 16] [--subspace 0.6] [--noise 0.25]
//!     [--quant int8|f32] [--keep-float true|false] [--m 16] [--efc 128]
//!     [--ef 32,64,128,256] [--rescore 4,16] [--threads 0]
//!     [--save /tmp/bench.bxcidx]        # save, reload via mmap, query, delete
//!     [--index-file /path/idx.bxcidx]   # reuse if present, else build + keep
//! ```

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use aphrody_web_index::{
    Index, IndexParams, Quantization, SearchOptions, kernels,
    synth::{ClusterSpec, ClusteredGenerator, brute_force_topk, recall_at_k},
};

fn args() -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut it = std::env::args().skip(1);
    while let Some(k) = it.next() {
        if let Some(name) = k.strip_prefix("--") {
            map.insert(name.to_string(), it.next().unwrap_or_default());
        }
    }
    map
}

fn get<T: std::str::FromStr>(a: &HashMap<String, String>, k: &str, default: T) -> T {
    a.get(k).and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn rss_bytes() -> usize {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("VmRSS:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|v| v.parse::<usize>().ok())
        })
        .map_or(0, |kb| kb * 1024)
}

/// User + system CPU seconds consumed by this process.
fn cpu_seconds() -> f64 {
    std::fs::read_to_string("/proc/self/stat")
        .ok()
        .and_then(|s| {
            let rest = s.rsplit_once(')')?.1;
            let fields: Vec<&str> = rest.split_whitespace().collect();
            let utime: f64 = fields.get(11)?.parse().ok()?;
            let stime: f64 = fields.get(12)?.parse().ok()?;
            Some((utime + stime) / 100.0)
        })
        .unwrap_or(0.0)
}

#[cfg(target_os = "linux")]
fn thread_cpu_time() -> Duration {
    #[repr(C)]
    struct Timespec {
        tv_sec: i64,
        tv_nsec: i64,
    }
    unsafe extern "C" {
        fn clock_gettime(clock_id: i32, tp: *mut Timespec) -> i32;
    }
    const CLOCK_THREAD_CPUTIME_ID: i32 = 3;
    let mut ts = Timespec { tv_sec: 0, tv_nsec: 0 };
    // SAFETY: `ts` is a valid, writable timespec (64-bit Linux layout).
    let rc = unsafe { clock_gettime(CLOCK_THREAD_CPUTIME_ID, &mut ts) };
    if rc != 0 {
        return Duration::ZERO;
    }
    Duration::new(ts.tv_sec as u64, ts.tv_nsec as u32)
}

#[cfg(not(target_os = "linux"))]
fn thread_cpu_time() -> Duration {
    Duration::ZERO
}

fn mib(b: usize) -> f64 {
    b as f64 / (1024.0 * 1024.0)
}

fn percentile(sorted: &[Duration], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx].as_secs_f64() * 1e3
}

struct QueryRun {
    recall: f64,
    p50: f64,
    p95: f64,
    p99: f64,
    mean: f64,
    cpu_p50: f64,
    cpu_p99: f64,
    qps_parallel: f64,
}

fn run_queries(
    index: &Index,
    queries: &[f32],
    dim: usize,
    truth: &[Vec<u64>],
    opts: SearchOptions,
) -> QueryRun {
    // Warm-up pass over every query (page cache, allocator, visited pools).
    for q in queries.chunks_exact(dim) {
        let _ = index.search_with(q, opts, None).unwrap();
    }
    let mut lat = Vec::with_capacity(queries.len() / dim);
    let mut cpu = Vec::with_capacity(queries.len() / dim);
    let mut found = Vec::with_capacity(queries.len() / dim);
    for q in queries.chunks_exact(dim) {
        let c = thread_cpu_time();
        let t = Instant::now();
        let hits = index.search_with(q, opts, None).unwrap();
        lat.push(t.elapsed());
        cpu.push(thread_cpu_time().saturating_sub(c));
        found.push(hits.into_iter().map(|(k, _)| k).collect::<Vec<_>>());
    }
    let recall = recall_at_k(truth, &found, opts.k);
    let mean = lat.iter().map(Duration::as_secs_f64).sum::<f64>() / lat.len() as f64 * 1e3;
    lat.sort();
    cpu.sort();

    // Throughput with all cores, each thread replaying the query set.
    let threads = std::thread::available_parallelism().map_or(1, |t| t.get());
    let nq = queries.len() / dim;
    let t = Instant::now();
    std::thread::scope(|s| {
        for th in 0..threads {
            s.spawn(move || {
                for i in 0..nq {
                    let qi = (i + th * 37) % nq;
                    let _ =
                        index.search_with(&queries[qi * dim..(qi + 1) * dim], opts, None).unwrap();
                }
            });
        }
    });
    let qps_parallel = (threads * nq) as f64 / t.elapsed().as_secs_f64();

    QueryRun {
        recall,
        p50: percentile(&lat, 0.50),
        p95: percentile(&lat, 0.95),
        p99: percentile(&lat, 0.99),
        mean,
        cpu_p50: percentile(&cpu, 0.50),
        cpu_p99: percentile(&cpu, 0.99),
        qps_parallel,
    }
}

fn print_header(k: usize) {
    println!(
        "| config (k={k:<2})                | recall@{k:<2} | mean ms | p50 ms  | p95 ms  | p99 \
         ms  | cpu p50 | cpu p99 | QPS 12 thr |"
    );
    println!(
        "|------------------------------|-----------|---------|---------|---------|---------|---------|---------|------------|"
    );
}

fn print_run(label: &str, r: &QueryRun) {
    println!(
        "| {label:<28} | {:>9.4} | {:>7.3} | {:>7.3} | {:>7.3} | {:>7.3} | {:>7.3} | {:>7.3} | \
         {:>10.0} |",
        r.recall, r.mean, r.p50, r.p95, r.p99, r.cpu_p50, r.cpu_p99, r.qps_parallel
    );
}

fn main() {
    let a = args();
    let n: usize = get(&a, "n", 100_000);
    let nq: usize = get(&a, "queries", 500);
    let dim: usize = get(&a, "dim", 384);
    let k: usize = get(&a, "k", 10);
    let spec = ClusterSpec {
        dim,
        clusters: get(&a, "clusters", 200),
        rank: get(&a, "rank", 16),
        subspace_norm: get(&a, "subspace", 0.6),
        noise_norm: get(&a, "noise", 0.25),
        seed: get(&a, "seed", 0xB8C_2026),
    };
    let quantization = match a.get("quant").map(String::as_str) {
        Some("f32") | Some("none") => Quantization::None,
        _ => Quantization::Int8,
    };
    let params = IndexParams {
        m: get(&a, "m", 16),
        ef_construction: get(&a, "efc", 128),
        quantization,
        keep_float: get(&a, "keep-float", true),
        build_threads: get(&a, "threads", 0),
        ..IndexParams::new(dim)
    };
    let list = |name: &str, default: Vec<usize>| -> Vec<usize> {
        a.get(name)
            .map(|s| s.split(',').filter_map(|x| x.parse().ok()).collect())
            .unwrap_or(default)
    };
    let efs = list("ef", vec![128]);
    let rescores = list("rescore", vec![4]);

    println!("# bxc-index bench");
    println!("n={n} queries={nq} dim={dim} k={k} spec={spec:?} kernels={}", kernels::kernel_name());
    println!("params={}", serde_json::to_string(&params).unwrap());

    let t = Instant::now();
    let generator = ClusteredGenerator::new(spec);
    let base = generator.generate(n, 1);
    let queries = generator.generate(nq, 2);
    println!("data generation: {:.2?}", t.elapsed());

    let t = Instant::now();
    let truth: Vec<Vec<u64>> = brute_force_topk(&base, &queries, dim, k)
        .into_iter()
        .map(|ids| ids.into_iter().map(u64::from).collect())
        .collect();
    println!("brute force ground truth ({nq} queries, parallel): {:.2?}", t.elapsed());

    let rss_before = rss_bytes();
    let index_file = a.get("index-file").cloned();
    let index = match &index_file {
        Some(path) if std::path::Path::new(path).exists() => {
            let t = Instant::now();
            let index = Index::load(path).unwrap();
            println!("loaded existing index {path} in {:.2?}", t.elapsed());
            index
        },
        _ => {
            let index = Index::new(params).unwrap();
            let keys: Vec<u64> = (0..n as u64).collect();
            let cpu_before = cpu_seconds();
            let t = Instant::now();
            index.add_batch_flat(&keys, &base).unwrap();
            let build = t.elapsed();
            let cpu = cpu_seconds() - cpu_before;
            println!(
                "build: {:.2?} ({:.0} inserts/s), process CPU {:.0}s (avg {:.1} cores busy)",
                build,
                n as f64 / build.as_secs_f64(),
                cpu,
                cpu / build.as_secs_f64()
            );
            if let Some(path) = &index_file {
                index.save(path).unwrap();
            }
            index
        },
    };
    let stats = index.stats();
    let rss_after = rss_bytes();
    println!("max_level={}", stats.max_level);
    println!(
        "index memory: {} bytes ({:.1} MiB, {:.0} bytes/vector); RSS delta {:.1} MiB",
        stats.memory_bytes,
        mib(stats.memory_bytes),
        stats.memory_bytes as f64 / n as f64,
        mib(rss_after.saturating_sub(rss_before))
    );

    println!();
    print_header(k);
    for &ef in &efs {
        let run = run_queries(
            &index,
            &queries,
            dim,
            &truth,
            SearchOptions { k, ef: Some(ef), rescore_multiplier: None },
        );
        print_run(&format!("ef={ef} default"), &run);
        for &mult in rescores.iter().filter(|&&m| m != index.params().rescore_multiplier) {
            if !index.params().rescoring() {
                break;
            }
            let run = run_queries(
                &index,
                &queries,
                dim,
                &truth,
                SearchOptions { k, ef: Some(ef), rescore_multiplier: Some(mult) },
            );
            print_run(&format!("ef={ef} rescore x{mult}"), &run);
        }
        if index.params().rescoring() {
            let run = run_queries(
                &index,
                &queries,
                dim,
                &truth,
                SearchOptions { k, ef: Some(ef), rescore_multiplier: Some(0) },
            );
            print_run(&format!("ef={ef} int8 no rescore"), &run);
        }
    }

    if let Some(path) = a.get("save") {
        println!();
        let t = Instant::now();
        index.save(path).unwrap();
        let save = t.elapsed();
        let size = std::fs::metadata(path).map_or(0, |m| m.len());
        drop(index);
        let t = Instant::now();
        let loaded = Index::load(path).unwrap();
        let load = t.elapsed();
        let ls = loaded.stats();
        println!(
            "save: {save:.2?}, file {:.1} MiB; load (mmap + checksum + validation): {load:.2?}; \
             heap after load {:.1} MiB, mapped {:.1} MiB",
            mib(size as usize),
            mib(ls.memory_bytes),
            mib(ls.mapped_bytes)
        );
        let run = run_queries(
            &loaded,
            &queries,
            dim,
            &truth,
            SearchOptions { k, ef: Some(128), rescore_multiplier: None },
        );
        print_header(k);
        print_run("ef=128 after mmap load", &run);
        let _ = std::fs::remove_file(path);
    }
}
