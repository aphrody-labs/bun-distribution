//! Banc V8 de reference (METHOD S2, S4c, S6, S7) sur le vrai runtime d'Obscura.
//! `cargo run --release -p obscura-js --example bench_v8 -- [realms] [calls]`
//! Sortie : une ligne JSON. Le snapshot de `bootstrap.js` est celui du build.
use deno_core::{op2, JsRuntime, RuntimeOptions};
use obscura_js::runtime::ObscuraJsRuntime;
use std::time::Instant;

#[op2(fast)]
fn op_bench_noop(#[smi] x: u32) -> u32 {
    x
}

deno_core::extension!(bench_ext, ops = [op_bench_noop]);

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn status_kib(key: &str) -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with(key))
                .and_then(|l| l.split_whitespace().nth(1)?.parse().ok())
        })
        .unwrap_or(0)
}

fn stats(mut v: Vec<f64>) -> serde_json::Value {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    let med = if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 };
    let p95 = v[((n as f64 * 0.95).ceil() as usize).min(n) - 1];
    serde_json::json!({"min": v[0], "median": med, "p95": p95, "samples": v})
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let realms: usize = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(30);
    let calls: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1_000_000);

    // S2/S4c : creation d'un runtime Obscura (isolat + restauration du snapshot de bootstrap.js).
    let t = Instant::now();
    let mut first = ObscuraJsRuntime::new();
    let first_new_ms = ms(t);
    let t = Instant::now();
    first.evaluate("1+1").unwrap();
    let first_eval_ms = ms(t);
    drop(first);

    let mut create = Vec::new();
    let mut create_eval = Vec::new();
    for _ in 0..realms {
        let t = Instant::now();
        let mut rt = ObscuraJsRuntime::new();
        create.push(ms(t));
        let t = Instant::now();
        rt.evaluate("1+1").ok();
        create_eval.push(ms(t));
        drop(rt);
    }
    let hwm_after_create = status_kib("VmHWM:");

    // S6 : RSS marginal de 20 runtimes vivants.
    let before = status_kib("VmRSS:");
    let live: Vec<_> = (0..20).map(|_| ObscuraJsRuntime::new()).collect();
    let after = status_kib("VmRSS:");
    let per_runtime_kib = after.saturating_sub(before) / 20;
    drop(live);

    // S7 : appels synchrones depuis JS. Op rapide deno_core pure, puis API de page.
    let mut raw = JsRuntime::new(RuntimeOptions {
        extensions: vec![bench_ext::init()],
        ..Default::default()
    });
    let loop_src = |body: &str| {
        format!(
            "(()=>{{const N={calls};const t0=performance.now();let a=0;for(let i=0;i<N;i++){{{body}}}return (performance.now()-t0)+a*0}})()"
        )
    };
    let run_raw = |rt: &mut JsRuntime, body: &str| -> f64 {
        let v = rt.execute_script("<s7>", loop_src(body)).unwrap();
        deno_core::scope!(scope, rt);
        deno_core::v8::Local::new(scope, v).number_value(scope).unwrap()
    };
    let mut s7_empty = Vec::new();
    let mut s7_op = Vec::new();
    for _ in 0..5 {
        s7_empty.push(run_raw(&mut raw, "a+=i;"));
        s7_op.push(run_raw(&mut raw, "a+=Deno.core.ops.op_bench_noop(i);"));
    }
    let mut obs = ObscuraJsRuntime::new();
    let mut s7_obs_empty = Vec::new();
    let mut s7_perf = Vec::new();
    for _ in 0..5 {
        s7_obs_empty.push(obs.evaluate(&loop_src("a+=i;")).unwrap().as_f64().unwrap());
        s7_perf.push(obs.evaluate(&loop_src("a+=performance.now();")).unwrap().as_f64().unwrap());
    }

    let out = serde_json::json!({
        "v8": "150.4.0 (15.0.245.2)",
        "first_runtime_new_ms": first_new_ms,
        "first_eval_ms": first_eval_ms,
        "runtime_new_ms": stats(create),
        "first_eval_after_new_ms": stats(create_eval),
        "rss_per_live_runtime_kib": per_runtime_kib,
        "vm_hwm_kib": hwm_after_create,
        "s7_calls": calls,
        "s7_empty_loop_ms": stats(s7_empty),
        "s7_deno_core_fast_op_ms": stats(s7_op),
        "s7_obscura_empty_loop_ms": stats(s7_obs_empty),
        "s7_obscura_performance_now_ms": stats(s7_perf),
    });
    println!("{out}");
}
