use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

use aphrody_web_index::{
    Index, IndexError, IndexParams, Metric, Quantization, SearchOptions, rng::SplitMix64,
};

fn temp_path(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("bxc-index-tests-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(name)
}

fn random_vectors(n: usize, dim: usize, seed: u64) -> Vec<Vec<f32>> {
    let mut rng = SplitMix64::new(seed);
    (0..n).map(|_| (0..dim).map(|_| rng.gaussian()).collect()).collect()
}

fn small_params(dim: usize) -> IndexParams {
    IndexParams { m: 12, ef_construction: 64, ef_search: 64, ..IndexParams::new(dim) }
}

fn build(n: usize, dim: usize, params: IndexParams, seed: u64) -> (Index, Vec<Vec<f32>>) {
    let index = Index::new(params).unwrap();
    let vectors = random_vectors(n, dim, seed);
    let items: Vec<(u64, Vec<f32>)> =
        vectors.iter().enumerate().map(|(i, v)| (i as u64, v.clone())).collect();
    index.add_batch(&items).unwrap();
    (index, vectors)
}

#[test]
fn empty_index_search_returns_nothing() {
    let index = Index::new(IndexParams::new(8)).unwrap();
    assert!(index.is_empty());
    assert!(index.search(&[1.0; 8], 10, None).unwrap().is_empty());
    assert!(index.search_filtered(&[1.0; 8], 10, Some(5), |_| true).unwrap().is_empty());
    index.add(1, &[1.0; 8]).unwrap();
    assert!(index.search(&[1.0; 8], 0, None).unwrap().is_empty());
    assert!(!index.remove(42));
}

#[test]
fn invalid_params_are_rejected() {
    assert!(matches!(Index::new(IndexParams::new(0)), Err(IndexError::InvalidParams(_))));
    assert!(matches!(
        Index::new(IndexParams { m: 1, ..IndexParams::new(4) }),
        Err(IndexError::InvalidParams(_))
    ));
}

#[test]
fn dimension_mismatch_errors() {
    let index = Index::new(IndexParams::new(4)).unwrap();
    assert!(matches!(
        index.add(1, &[1.0, 2.0, 3.0]),
        Err(IndexError::DimensionMismatch { expected: 4, got: 3 })
    ));
    assert!(matches!(
        index.add_batch_flat(&[1, 2], &[1.0; 7]),
        Err(IndexError::DimensionMismatch { .. })
    ));
    index.add(1, &[1.0, 2.0, 3.0, 4.0]).unwrap();
    assert!(matches!(
        index.search(&[1.0; 5], 1, None),
        Err(IndexError::DimensionMismatch { expected: 4, got: 5 })
    ));
}

#[test]
fn non_finite_and_zero_vectors_are_rejected_atomically() {
    let index = Index::new(IndexParams::new(3)).unwrap();
    assert!(matches!(index.add(1, &[f32::NAN, 0.0, 1.0]), Err(IndexError::NonFiniteVector)));
    assert!(matches!(index.add(1, &[f32::INFINITY, 0.0, 1.0]), Err(IndexError::NonFiniteVector)));
    assert!(matches!(index.add(1, &[0.0, 0.0, 0.0]), Err(IndexError::ZeroVector)));
    let batch = vec![(1u64, vec![1.0, 0.0, 0.0]), (2u64, vec![0.0, f32::NEG_INFINITY, 0.0])];
    assert!(index.add_batch(&batch).is_err());
    assert_eq!(index.len(), 0, "a failing batch must not insert anything");
    assert!(matches!(
        index.search(&[f32::NAN, 0.0, 0.0], 1, None),
        Err(IndexError::NonFiniteVector)
    ));
}

#[test]
fn upsert_replaces_previous_vector() {
    let index = Index::new(IndexParams::new(3)).unwrap();
    index.add(1, &[1.0, 0.0, 0.0]).unwrap();
    index.add(2, &[0.0, 0.0, 1.0]).unwrap();
    index.add(1, &[0.0, 1.0, 0.0]).unwrap();
    assert_eq!(index.len(), 2);
    assert_eq!(index.tombstone_count(), 1);
    assert!(index.contains(1));

    let hits = index.search(&[0.0, 1.0, 0.0], 2, None).unwrap();
    assert_eq!(hits[0].0, 1);
    assert!((hits[0].1 - 1.0).abs() < 1e-4);
    let hits = index.search(&[1.0, 0.0, 0.0], 3, None).unwrap();
    assert_eq!(hits.len(), 2, "tombstoned slot must not be returned");
    assert!(hits.iter().all(|&(_, s)| s < 0.5));

    // Duplicate keys inside one batch: last one wins.
    index.add_batch(&[(5, vec![1.0, 1.0, 0.0]), (5, vec![0.0, 1.0, 1.0])]).unwrap();
    assert_eq!(index.len(), 3);
    let hits = index.search(&[0.0, 1.0, 1.0], 1, None).unwrap();
    assert_eq!(hits[0].0, 5);
    assert!((hits[0].1 - 1.0).abs() < 1e-4);
}

#[test]
fn tombstones_are_filtered_and_filters_apply() {
    let dim = 16;
    let (index, vectors) = build(3000, dim, small_params(dim), 11);
    for key in (0..3000u64).step_by(3) {
        assert!(index.remove(key));
        assert!(!index.remove(key));
        assert!(!index.contains(key));
    }
    assert_eq!(index.len(), 2000);
    for key in (0..3000u64).step_by(3).take(200) {
        let hits = index.search(&vectors[key as usize], 10, None).unwrap();
        assert_eq!(hits.len(), 10);
        assert!(hits.iter().all(|&(k, _)| k % 3 != 0), "tombstone leaked");
    }
    for key in (1..3000u64).step_by(3).take(100) {
        let hits = index.search(&vectors[key as usize], 1, None).unwrap();
        assert_eq!(hits[0].0, key, "live vector must find itself");
    }
    let hits = index.search_filtered(&vectors[7], 10, None, |k| k % 2 == 0).unwrap();
    assert_eq!(hits.len(), 10);
    assert!(hits.iter().all(|&(k, _)| k % 2 == 0 && k % 3 != 0));
    let hits = index.search_filtered(&vectors[7], 10, None, |k| k == 1000).unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].0, 1000);
}

#[test]
fn compact_drops_tombstones_and_keeps_results() {
    let dim = 24;
    for keep_float in [true, false] {
        let params = IndexParams { keep_float, ..small_params(dim) };
        let (index, vectors) = build(2000, dim, params, 5);
        for key in 0..1000u64 {
            index.remove(key);
        }
        index.compact().unwrap();
        assert_eq!(index.tombstone_count(), 0);
        assert_eq!(index.len(), 1000);
        assert_eq!(index.stats().slots, 1000);
        let mut self_hits = 0;
        for key in 1000..2000u64 {
            let hits = index.search(&vectors[key as usize], 1, None).unwrap();
            if hits[0].0 == key {
                self_hits += 1;
            }
        }
        assert!(self_hits >= 990, "self recall after compact: {self_hits}");
        index.add(1, &vectors[1]).unwrap();
        assert_eq!(index.search(&vectors[1], 1, None).unwrap()[0].0, 1);
    }
}

#[test]
fn save_load_round_trip_is_identical() {
    let dim = 32;
    for (metric, quantization, keep_float) in [
        (Metric::Cosine, Quantization::Int8, true),
        (Metric::Cosine, Quantization::Int8, false),
        (Metric::Cosine, Quantization::None, true),
        (Metric::L2, Quantization::Int8, true),
    ] {
        let params = IndexParams { metric, quantization, keep_float, ..small_params(dim) };
        let (index, vectors) = build(2500, dim, params, 99);
        for key in (0..2500u64).step_by(10) {
            index.remove(key);
        }
        let path = temp_path(&format!("rt-{metric:?}-{quantization:?}-{keep_float}.bxcidx"));
        index.save(&path).unwrap();
        let loaded = Index::load(&path).unwrap();
        assert!(loaded.stats().mapped);
        assert_eq!(loaded.len(), index.len());
        assert_eq!(loaded.tombstone_count(), index.tombstone_count());
        assert_eq!(loaded.params(), index.params());
        let queries = random_vectors(50, dim, 1234);
        for q in &queries {
            assert_eq!(index.search(q, 10, None).unwrap(), loaded.search(q, 10, None).unwrap());
            assert_eq!(
                index.search_filtered(q, 5, Some(32), |k| k % 2 == 1).unwrap(),
                loaded.search_filtered(q, 5, Some(32), |k| k % 2 == 1).unwrap()
            );
        }
        assert!(loaded.contains(1) && !loaded.contains(10));

        // Mutations after load materialise owned buffers and keep working.
        loaded.remove(1);
        loaded.add(100_000, &vectors[3]).unwrap();
        index.remove(1);
        index.add(100_000, &vectors[3]).unwrap();
        let hits = loaded.search(&vectors[3], 2, None).unwrap();
        assert!(hits.iter().any(|&(k, _)| k == 100_000));
        assert!(!loaded.stats().mapped);

        // Save the mutated copy over the mapped file and reload it.
        loaded.save(&path).unwrap();
        let again = Index::load(&path).unwrap();
        assert_eq!(again.len(), loaded.len());
        for q in queries.iter().take(10) {
            assert_eq!(again.search(q, 10, None).unwrap(), loaded.search(q, 10, None).unwrap());
        }
        let _ = std::fs::remove_file(&path);
    }
}

#[test]
fn empty_index_round_trip() {
    let path = temp_path("empty.bxcidx");
    Index::new(IndexParams::new(7)).unwrap().save(&path).unwrap();
    let loaded = Index::load(&path).unwrap();
    assert!(loaded.is_empty());
    assert_eq!(loaded.dim(), 7);
    loaded.add(1, &[1.0; 7]).unwrap();
    assert_eq!(loaded.search(&[1.0; 7], 1, None).unwrap()[0].0, 1);
    let _ = std::fs::remove_file(&path);
}

fn corrupted_load(path: &PathBuf, bytes: &[u8]) -> Result<Index, IndexError> {
    std::fs::write(path, bytes).unwrap();
    Index::load(path)
}

#[test]
fn corrupt_files_are_detected_without_panicking() {
    let dim = 16;
    let (index, _) = build(500, dim, small_params(dim), 3);
    let path = temp_path("good.bxcidx");
    index.save(&path).unwrap();
    let good = std::fs::read(&path).unwrap();
    let bad_path = temp_path("bad.bxcidx");

    assert!(matches!(Index::load(temp_path("missing.bxcidx")), Err(IndexError::Io(_))));

    for len in [0, 4, 8, 100, 255, 263, good.len() / 2, good.len() - 9, good.len() - 1] {
        assert!(corrupted_load(&bad_path, &good[..len]).is_err(), "truncated to {len} bytes");
    }

    let mut rng = SplitMix64::new(77);
    let mut positions = vec![0usize, 3, 8, 16, 20, 60, 90, 255, 256, good.len() - 1];
    positions.extend((0..40).map(|_| rng.below(good.len() as u64) as usize));
    for pos in positions {
        let mut bytes = good.clone();
        bytes[pos] ^= 0x5A;
        let err = corrupted_load(&bad_path, &bytes).err();
        assert!(
            matches!(
                err,
                Some(
                    IndexError::ChecksumMismatch { .. }
                        | IndexError::BadMagic
                        | IndexError::UnsupportedVersion(_)
                )
            ),
            "flip at {pos}: {err:?}"
        );
    }

    // A structurally invalid file with a *valid* checksum must also fail.
    let reseal = |mut bytes: Vec<u8>| {
        let end = bytes.len() - 8;
        let sum = aphrody_web_index::persist::xxh64(&bytes[..end], 0);
        bytes[end..].copy_from_slice(&sum.to_le_bytes());
        bytes
    };
    let section_offset = |bytes: &[u8], idx: usize| {
        let base = 88 + idx * 16;
        u64::from_le_bytes(bytes[base..base + 8].try_into().unwrap()) as usize
    };
    let mut bytes = good.clone();
    let links0 = section_offset(&bytes, 6);
    bytes[links0 + 4..links0 + 8].copy_from_slice(&1_000_000u32.to_le_bytes());
    assert!(matches!(corrupted_load(&bad_path, &reseal(bytes)), Err(IndexError::Corrupt(_))));
    let mut bytes = good.clone();
    bytes[links0..links0 + 4].copy_from_slice(&999u32.to_le_bytes());
    assert!(matches!(corrupted_load(&bad_path, &reseal(bytes)), Err(IndexError::Corrupt(_))));
    let mut bytes = good.clone();
    bytes[56..64].copy_from_slice(&(u64::MAX / 2).to_le_bytes());
    assert!(matches!(corrupted_load(&bad_path, &reseal(bytes)), Err(IndexError::Corrupt(_))));
    let mut bytes = good.clone();
    bytes[8..12].copy_from_slice(&9u32.to_le_bytes());
    assert!(matches!(
        corrupted_load(&bad_path, &reseal(bytes)),
        Err(IndexError::UnsupportedVersion(9))
    ));
    let mut bytes = good.clone();
    bytes[20] = 7;
    assert!(matches!(corrupted_load(&bad_path, &reseal(bytes)), Err(IndexError::Corrupt(_))));

    assert!(Index::load(&path).is_ok());
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(&bad_path);
}

#[test]
fn concurrent_searches_during_inserts() {
    let dim = 32;
    let params = IndexParams { build_threads: 4, ..small_params(dim) };
    let index = Arc::new(Index::new(params).unwrap());
    let vectors = Arc::new(random_vectors(12_000, dim, 21));
    index.add(0, &vectors[0]).unwrap();
    let done = Arc::new(AtomicBool::new(false));
    let searches = Arc::new(AtomicUsize::new(0));

    let readers: Vec<_> = (0..4)
        .map(|t| {
            let (index, vectors, done, searches) =
                (index.clone(), vectors.clone(), done.clone(), searches.clone());
            std::thread::spawn(move || {
                let mut i = t * 97;
                while !done.load(Ordering::Relaxed) {
                    let q = &vectors[i % vectors.len()];
                    let hits = index.search(q, 10, None).unwrap();
                    assert!(hits.len() <= 10);
                    let _ = index.search_filtered(q, 5, Some(20), |k| k % 2 == 0).unwrap();
                    let _ = index.contains(i as u64);
                    searches.fetch_add(1, Ordering::Relaxed);
                    i += 1;
                }
            })
        })
        .collect();

    let writer = {
        let (index, vectors) = (index.clone(), vectors.clone());
        std::thread::spawn(move || {
            for key in 1..2000u64 {
                index.add(key, &vectors[key as usize]).unwrap();
            }
            for start in (2000..12_000usize).step_by(1000) {
                let batch: Vec<(u64, Vec<f32>)> =
                    (start..start + 1000).map(|k| (k as u64, vectors[k].clone())).collect();
                index.add_batch(&batch).unwrap();
                index.remove(start as u64);
            }
        })
    };
    writer.join().unwrap();
    done.store(true, Ordering::Relaxed);
    for r in readers {
        r.join().unwrap();
    }
    assert_eq!(index.len(), 12_000 - 10);
    assert!(searches.load(Ordering::Relaxed) > 0);
    let hits = index.search(&vectors[5555], 1, None).unwrap();
    assert_eq!(hits[0].0, 5555);
}

#[test]
fn serial_builds_are_deterministic() {
    let dim = 12;
    let vectors = random_vectors(800, dim, 8);
    let make = || {
        let index = Index::new(small_params(dim)).unwrap();
        for (i, v) in vectors.iter().enumerate() {
            index.add(i as u64, v).unwrap();
        }
        index
    };
    let (a, b) = (make(), make());
    for q in random_vectors(20, dim, 9) {
        assert_eq!(a.search(&q, 10, None).unwrap(), b.search(&q, 10, None).unwrap());
    }
}

#[test]
fn l2_metric_matches_brute_force() {
    let dim = 8;
    for quantization in [Quantization::Int8, Quantization::None] {
        let params = IndexParams { metric: Metric::L2, quantization, ..small_params(dim) };
        let (index, vectors) = build(1500, dim, params, 17);
        let mut rng = SplitMix64::new(4);
        let mut correct = 0;
        let trials = 100;
        for _ in 0..trials {
            let q: Vec<f32> = (0..dim).map(|_| rng.gaussian() * 3.0).collect();
            let exact = vectors
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let d: f32 = v.iter().zip(&q).map(|(a, b)| (a - b) * (a - b)).sum();
                    (i as u64, d)
                })
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .unwrap();
            let hits = index.search(&q, 1, None).unwrap();
            assert!(hits[0].1 <= 0.0, "L2 scores are negated distances");
            if hits[0].0 == exact.0 {
                correct += 1;
                assert!((-hits[0].1 - exact.1).abs() <= 1e-3 * (1.0 + exact.1));
            }
        }
        assert!(correct >= 95, "{quantization:?}: {correct}/{trials}");
    }
}

#[test]
fn search_options_override_rescoring() {
    let dim = 16;
    let (index, vectors) = build(1000, dim, small_params(dim), 2);
    let q = &vectors[10];
    let exact = index
        .search_with(q, SearchOptions { k: 5, ef: Some(64), rescore_multiplier: Some(8) }, None)
        .unwrap();
    let approx = index
        .search_with(q, SearchOptions { k: 5, ef: Some(64), rescore_multiplier: Some(0) }, None)
        .unwrap();
    assert_eq!(exact[0].0, 10);
    assert_eq!(approx[0].0, 10);
    assert!((exact[0].1 - 1.0).abs() < 1e-5, "rescored score is exact");
    let filter = |k: u64| k != 10;
    let filtered =
        index.search_with(q, SearchOptions { k: 3, ..Default::default() }, Some(&filter)).unwrap();
    assert!(filtered.iter().all(|&(k, _)| k != 10));
}
