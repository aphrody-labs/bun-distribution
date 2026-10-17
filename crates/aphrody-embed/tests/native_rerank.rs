//! Cross-encoder parity with sentence-transformers and ranking sanity.

mod common;

use aphrody_embed::native::{DEFAULT_RERANKER_ID, EmbedOptions, Reranker};
use serde_json::Value;

fn reference() -> Value {
    serde_json::from_str(include_str!("fixtures/rerank_reference.json")).expect("fixture")
}

fn reranker(id: &str, threads: usize, batch_size: usize) -> Option<Reranker> {
    let (spec, dir) = common::reranker_or_skip(id)?;
    let opts = EmbedOptions {
        threads,
        batch_size,
        ..EmbedOptions::default()
    };
    Some(Reranker::load(&dir, &spec, opts).expect("load reranker"))
}

fn check_parity(case: &Value, pairs: &[(String, String)]) -> Option<f32> {
    let model = case["model"].as_str().unwrap();
    let reranker = reranker(model, 4, 0)?;
    let mut worst = 0.0f32;
    for (i, ((query, passage), want)) in pairs
        .iter()
        .zip(case["scores"].as_array().unwrap())
        .enumerate()
    {
        let want = want.as_f64().unwrap() as f32;
        let got = reranker.score(query, &[passage.as_str()]).unwrap()[0];
        let diff = (got - want).abs();
        assert!(
            diff <= 1e-3 + 1e-4 * want.abs(),
            "{model} pair {i}: score {got} vs reference {want}"
        );
        worst = worst.max(diff);
    }
    // Batched scoring must agree with one-by-one scoring.
    let query = &pairs[0].0;
    let passages: Vec<&str> = pairs.iter().map(|p| p.1.as_str()).collect();
    let batched = reranker.score(query, &passages).unwrap();
    for (i, passage) in passages.iter().enumerate() {
        let single = reranker.score(query, &[passage]).unwrap()[0];
        assert!((batched[i] - single).abs() <= 1e-4 * (1.0 + single.abs()));
    }
    println!("rerank parity {model}: max |score - reference| = {worst:.2e}");
    Some(worst)
}

fn pairs(reference: &Value) -> Vec<(String, String)> {
    reference["pairs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p[0].as_str().unwrap().to_string(),
                p[1].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

#[test]
fn default_reranker_matches_sentence_transformers() {
    let reference = reference();
    let pairs = pairs(&reference);
    let case = reference["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["model"] == DEFAULT_RERANKER_ID)
        .expect("default reranker reference");
    check_parity(case, &pairs);
}

#[test]
fn optional_rerankers_match_sentence_transformers() {
    let all = std::env::var("APHRODY_EMBED_TEST_ALL_MODELS").is_ok_and(|v| v == "1");
    let reference = reference();
    let pairs = pairs(&reference);
    for case in reference["cases"].as_array().unwrap() {
        let model = case["model"].as_str().unwrap();
        if model == DEFAULT_RERANKER_ID {
            continue;
        }
        if !all && !common::reranker_installed(model) {
            eprintln!(
                "SKIPPED: {model} not installed (set APHRODY_EMBED_TEST_ALL_MODELS=1 to fetch)"
            );
            continue;
        }
        check_parity(case, &pairs);
    }
}

#[test]
fn relevant_passage_outranks_irrelevant_ones() {
    let Some(reranker) = reranker(DEFAULT_RERANKER_ID, 4, 2) else {
        return;
    };
    let query = "how do web crawlers avoid downloading duplicate pages";
    let passages = [
        "Chocolate cake needs flour, sugar, cocoa powder, eggs and butter.",
        "Crawlers detect near-duplicate documents with shingling and SimHash fingerprints, and \
         normalise URLs so the same page is not fetched twice.",
        "The football season starts in August and ends in May.",
        "Web crawlers download pages.",
        "",
    ];
    let ranked = reranker.rank(query, &passages).unwrap();
    println!("ranking: {ranked:?}");
    assert_eq!(ranked[0].0, 1, "most relevant passage first");
    assert_eq!(ranked.len(), passages.len());
    let scores = reranker.score(query, &passages).unwrap();
    assert!(scores[1] > scores[0] + 5.0 && scores[1] > scores[2] + 5.0);
    assert!(reranker.score(query, &[]).unwrap().is_empty());
}

#[test]
fn over_long_inputs_are_truncated_not_rejected() {
    let Some(reranker) = reranker(DEFAULT_RERANKER_ID, 2, 0) else {
        return;
    };
    let long_query = "crawler frontier politeness ".repeat(400);
    let long_passage = "Search engines rank documents. ".repeat(300);
    let scores = reranker
        .score(&long_query, &[long_passage.as_str(), "short passage"])
        .unwrap();
    assert!(scores.iter().all(|s| s.is_finite()));
    assert_eq!(reranker.max_seq_len(), 512);
}

#[test]
fn rerank_json_facade_sorts_descending() {
    if common::reranker_or_skip(DEFAULT_RERANKER_ID).is_none() {
        return;
    }
    if std::env::var("APHRODY_RERANK_MODEL").is_ok() {
        eprintln!("SKIPPED: APHRODY_RERANK_MODEL overrides the facade model");
        return;
    }
    let passages = r#"["Bananas are yellow.", "Berlin has about 3.5 million inhabitants.", "Paris is in France."]"#;
    let out: Value = serde_json::from_str(&aphrody_embed::native::rerank_json(
        "population of Berlin",
        passages,
    ))
    .unwrap();
    let items = out.as_array().expect("array result");
    assert_eq!(items.len(), 3);
    assert_eq!(items[0]["index"], 1);
    let scores: Vec<f64> = items.iter().map(|i| i["score"].as_f64().unwrap()).collect();
    assert!(scores.windows(2).all(|w| w[0] >= w[1]));
}
