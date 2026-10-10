# bxc-index benchmarks

All numbers below were produced by `examples/index_bench.rs` and `tests/recall.rs`
from this crate on 2026-09-17.

## Machine

| | |
|---|---|
| `nproc` | 12 |
| CPU (`/proc/cpuinfo`) | `Intel Core Processor (Haswell, no TSX)`, KVM guest, 12 sockets x 1 thread, 16 MiB cache reported per vCPU |
| SIMD path selected at runtime | `avx2+fma` (no `-C target-cpu` flags, portable binary) |
| RAM | 45 GiB (swap in use by other tenants) |
| Kernel / toolchain | Linux 7.0.0-28, rustc 1.100.0-nightly (2026-09-11), release profile with `lto = "thin"`, `codegen-units = 1` |

**The host was shared and heavily oversubscribed while these runs happened
(load average 26 to 43 on 12 vCPUs, from other tenants' processes).** So:

* wall-clock build times are pessimistic. The bench prints the process CPU
  seconds, and those do not depend on the load. During the 1M build the index
  got only 2.8 to 4.2 cores on average, not 12.
* wall-clock latency percentiles include preemption. The `cpu p50`/`cpu p99`
  columns are per-query thread CPU time (`CLOCK_THREAD_CPUTIME_ID`), which
  shows what the query costs on its own.
* "QPS 12 thr" is 12 threads each replaying the 500 queries. Take it as a
  rough number only.

## Dataset

`bxc_index::synth::ClusteredGenerator`: deterministic (seed `0xB8C2026`),
dim 384, L2-normalised, and meant to look like sentence embeddings:

* 200 clusters. Cluster sizes are uneven: a cluster's weight is `1/sqrt(c+1)`,
  so the largest cluster holds 3.7 % of the points and the smallest 0.26 %.
* Each point is `center_c + B_c z + e`, where `B_c` is a random rank-16 basis
  (in-cluster variation of norm about 0.6) and `e` is isotropic noise of norm
  about 0.25.
* Queries come from the same distribution but are not in the index.
  Brute-force ground truth uses exact f32 dot products.

Cluster centres are random directions in 384-d, so any two clusters are close
to orthogonal. That makes routing between clusters harder than on real
embeddings, where topics blend into each other (see the 1M section).

## Reproduce

```bash
cd rust-bridge/crates/bxc-index
cargo test --release --test recall -- --nocapture
cargo run --release --example index_bench -- --n 100000 --ef 32,64,128,256 --rescore 4,16 --save /tmp/100k.bxcidx
cargo run --release --example index_bench -- --n 100000 --ef 128 --keep-float false
cargo run --release --example index_bench -- --n 100000 --ef 128 --quant f32
cargo run --release --example index_bench -- --n 1000000 --ef 64,128,256 --rescore 4,16 --save /path/on/disk/1m.bxcidx
```

Defaults: `M = 16` (`M0 = 32`), `ef_construction = 128`, `ef_search = 128`,
int8 traversal, `keep_float = true`, `rescore_multiplier = 4`,
`keep_pruned_connections = true`, k = 10, 500 queries.

In the tables, "default" means int8 traversal with the top `k*4` candidates
rescored on exact f32. "rescore x16" rescores the top `k*16`. "int8 no rescore"
returns the int8 scores directly.

## Recall test (`tests/recall.rs`, 20k vectors, 200 queries)

| configuration | recall@10 | parallel build |
|---|---|---|
| int8 + rescore x4 (defaults) | **1.0000** | 1.52 s |
| int8, no rescoring | 0.9915 | same index |
| f32 traversal (`Quantization::None`) | **1.0000** | 2.25 s |

The test asserts at least 0.95 for both default configurations and at least
0.80 for int8 without rescoring. Parallel construction is not bit-for-bit
deterministic: across runs the int8 default has come out between 0.9995 and
1.0000.

## 100k vectors, dim 384 (load average 28 to 31)

Build (defaults): **9.22 s wall, 27 CPU-s**, 10 847 inserts/s wall (3.9k
inserts per CPU-second), max level 4.

| config (k=10) | recall@10 | mean ms | p50 ms | p95 ms | p99 ms | cpu p50 | cpu p99 | QPS 12 thr |
|---|---|---|---|---|---|---|---|---|
| ef=32 default | 0.9938 | 0.183 | 0.146 | 0.224 | 0.325 | 0.147 | 0.261 | 10954 |
| ef=32 rescore x16 | 1.0000 | 0.438 | 0.346 | 0.632 | 3.095 | 0.343 | 0.635 | 7118 |
| ef=32 int8 no rescore | 0.9780 | 0.131 | 0.120 | 0.175 | 0.220 | 0.122 | 0.208 | 19680 |
| ef=64 default | 0.9958 | 0.251 | 0.214 | 0.340 | 0.933 | 0.215 | 0.379 | 11244 |
| ef=64 int8 no rescore | 0.9848 | 0.454 | 0.144 | 0.236 | 0.468 | 0.145 | 0.301 | 28753 |
| **ef=128 default** | **1.0000** | 0.390 | 0.252 | 0.503 | 3.472 | 0.252 | 0.532 | 6578 |
| ef=128 rescore x16 | 1.0000 | 0.663 | 0.333 | 0.642 | 5.572 | 0.334 | 0.622 | 6466 |
| ef=128 int8 no rescore | 0.9890 | 0.465 | 0.252 | 0.460 | 5.000 | 0.253 | 0.526 | 9809 |
| ef=256 default | 1.0000 | 0.528 | 0.338 | 1.230 | 3.772 | 0.338 | 0.672 | 10451 |
| ef=256 int8 no rescore | 0.9890 | 0.378 | 0.297 | 0.523 | 0.686 | 0.298 | 0.602 | 9681 |

Persistence at 100k: `save` 0.63 s for a 198.1 MiB file. `load` takes
**110 ms**, covering the mmap, the XXH64 check of the whole file and full
graph validation. After loading, 0.1 MiB is on the heap and 198.1 MiB is read
in place from the mapping. A query right after loading (ef=128 default):
recall 1.0000, p50 0.224 ms, p99 0.458 ms, cpu p99 0.416 ms.

Other storage configurations at 100k (ef=128):

| configuration | index memory | bytes/vector | build (wall / CPU) | recall@10 | p50 ms | cpu p99 ms |
|---|---|---|---|---|---|---|
| int8 + f32 kept, rescore x4 (default) | 206.1 MiB | 2161 | 9.2 s / 27 s | 1.0000 | 0.252 | 0.532 |
| int8 only (`keep_float = false`) | 59.6 MiB | **625** | 5.7 s / 26 s | 0.9890 | 0.246 | 0.471 |
| f32 only (`Quantization::None`) | 169.1 MiB | 1773 | 10.8 s / 49 s | 0.9998 | 0.378 | 0.770 |

The int8 kernels make the build about 1.8x cheaper in CPU time than f32
traversal, and queries on int8 cost about 1.5x less.

## 1M vectors, dim 384 (load average 33 to 43)

Build (defaults): **208.9 s wall, 583 CPU-s**, 4 788 inserts/s wall. The index
got only 2.8 cores on average during the build, so that is about 1.7k inserts
per CPU-second. An earlier run of the same query code, under a lighter load
(load average about 11 to 13, 4.2 cores available), built in 133 s using
557 CPU-s. On an idle 12-core machine a build should take roughly 1 to 1.5
minutes; that figure is extrapolated, not measured.

Index memory: **2 159 253 948 bytes (2 059 MiB), 2 159 bytes/vector.**
Brute-force ground truth for 500 queries took 12.8 s across 12 threads.

| config (k=10) | recall@10 | mean ms | p50 ms | p95 ms | p99 ms | cpu p50 | cpu p99 | QPS 12 thr |
|---|---|---|---|---|---|---|---|---|
| ef=64 default | 0.9806 | 0.519 | 0.401 | 0.622 | 5.431 | 0.402 | 0.722 | 4544 |
| ef=64 rescore x16 | 0.9836 | 5.438 | 1.089 | 17.255 | 79.039 | 0.983 | 1.823 | 2954 |
| ef=64 int8 no rescore | 0.9638 | 0.728 | 0.369 | 3.296 | 4.401 | 0.371 | 0.748 | 6734 |
| **ef=128 default** | **0.9816** | 0.975 | 0.728 | 2.234 | **4.897** | 0.725 | **1.381** | 5109 |
| ef=128 rescore x16 | 0.9836 | 1.302 | 0.966 | 3.977 | 4.353 | 0.951 | 1.451 | 3759 |
| ef=128 int8 no rescore | 0.9646 | 0.780 | 0.700 | 1.142 | 1.645 | 0.684 | 1.172 | 6281 |
| ef=256 default | 0.9836 | 1.606 | 1.171 | 4.203 | 4.889 | 1.147 | 1.972 | 3208 |
| ef=256 rescore x16 | 0.9836 | 1.968 | 1.277 | 4.779 | 7.597 | 1.217 | 1.943 | 2904 |
| ef=256 int8 no rescore | 0.9666 | 2.782 | 1.138 | 7.580 | 12.091 | 0.989 | 1.701 | 2057 |

The ef=64 rescore x16 row ran right after the build, while the other tenants
had pushed part of the process into swap. Its wall-clock tail is page-fault
noise. The CPU columns for that row are fine.

Here is ef=128 default from the lighter-load run: recall 0.9820, p50 0.565 ms,
p95 0.786 ms, **p99 1.239 ms**. The plan's target of **p99 under 10 ms at 1M**
is met in both runs, with a p99 of 1.2 to 4.9 ms wall and 1.4 ms CPU.

Persistence at 1M: `save` took 6.8 s for a 1 981.4 MiB file (5.9 s under the
lighter load). `load` took **1.72 s** under load and **0.43 s** under the
lighter load; almost all of that is the full-file XXH64. After loading, 0.2 MiB
is on the heap and 1 981.3 MiB is mapped. A query right after loading
(ef=128 default): recall 0.9816, p50 0.568 ms, p99 1.726 ms, cpu p99 0.888 ms.

### Why 1M recall levels off around 0.98 (and a check against hnswlib)

A sweep on the same 1M dataset with a larger candidate pool shows the ceiling:

| ef | rescore x4 | rescore x16 | rescore x64 | int8 no rescore |
|---|---|---|---|---|
| 128 | 0.9820 | 0.9840 | 0.9882 | 0.9650 |
| 512 | 0.9880 | 0.9880 | 0.9882 | 0.9710 |

Some tests on the saved 1M graph:

* 28 nodes (0.003 %) have no incoming link on layer 0. None of them are among
  the missed neighbours.
* A self-query (a node's own vector, ef=128) fails for 24 of 1 000 sampled
  nodes. These nodes exist in the graph, but greedy routing cannot reach them.
* The cause is the dataset. The 200 cluster centres are nearly orthogonal, so
  from inside the wrong cluster every node looks equally far from the query,
  and greedy search on the upper layers has no gradient to follow.

hnswlib 0.8.0 (pip wheel, `space="ip"`, M=16, ef_construction=128, 12 build
threads, single-thread queries) on the **same dumped vectors and ground
truth**:

| | hnswlib 0.8.0 | bxc-index |
|---|---|---|
| 1M build (wall, both on the loaded host) | 270.4 s | 133 to 209 s |
| 1M recall@10, ef=128 | 0.9658 | 0.9646 (int8 no rescore) / **0.9816** (default) |
| 1M recall@10, ef=512 | 0.9878 | 0.9880 (default) |
| 1M self-search failures (1 000 sampled, ef=128) | 22 | 24 |
| 1M mean query ms, ef=128 | 1.315 | 0.67 to 0.98 |
| 100k clustered: build / recall@10 at ef=128 | 14.9 s / 1.0000 | 4.6 to 9.2 s / 1.0000 |
| 100k uniform on the sphere (worst case): recall@10 at ef=128 / 512 | 0.1482 / 0.4106 | 0.1428 / 0.3992 |

On this data, graph quality matches hnswlib. The plateau and the self-search
failures show up in both, so they are not a bug in this crate. Rescoring gets
back about 1.7 points of recall@10 that int8 scoring loses. The timing columns
are only indicative: the wheel's compiler flags are unknown and the host was
loaded.

Harder variants at 100k (defaults, ef=128): rank-64 subspace with noise 0.4
gives 0.9978. Rank-128 with noise 0.5 gives 0.9920. Rank 0 with noise 1.0
(isotropic clusters) gives 0.9918. Uniform random on the 384-d sphere (no
structure at all) gives 0.14. That last case defeats every graph ANN method,
including hnswlib, as the table shows.

## Memory per vector (dim 384, M = 16)

| component | bytes/vector |
|---|---|
| f32 vector (`keep_float`) | 1536 |
| int8 codes | 384 |
| per-vector scale (plus squared norm for L2) | 4 (8) |
| external key | 8 |
| level | 1 |
| layer-0 adjacency `(2M+1) x 4` | 132 |
| upper-layer offsets | 8 |
| upper-layer adjacency, expected `(M+1) x 4 / (M-1)` | about 4.5 |
| key hash map (hashbrown, power-of-two buckets) | about 17 to 22 |
| tombstone bitmap | 0.125 |
| **measured total, default** | **2 159 to 2 161** |
| **measured total, `keep_float = false`** | **625** |
| file size on disk, default (no hash map) | 2 077 |

There is also a fixed overhead of 64 KiB of lock stripes, plus one pooled
visited list of `4 * slots` bytes for each thread that has searched.
