//! Semantic sanity checks and batching invariants on the default model.

mod common;

use aphrody_embed::native::{
    DEFAULT_MODEL_ID, EmbedOptions, ModelFiles, TextKind, cosine, dequantize_i8, quantize_i8,
};

fn default_embedder(threads: usize, batch_size: usize) -> Option<aphrody_embed::native::Embedder> {
    common::embedder(
        DEFAULT_MODEL_ID,
        EmbedOptions {
            threads,
            batch_size,
            ..EmbedOptions::default()
        },
    )
}

#[test]
fn synonyms_beat_unrelated_words() {
    let Some(embedder) = default_embedder(4, 0) else {
        return;
    };
    let v = embedder
        .embed_batch(&["car", "automobile", "banana"], TextKind::Passage)
        .unwrap();
    let synonym = cosine(&v[0], &v[1]);
    let unrelated = cosine(&v[0], &v[2]);
    println!("cos(car, automobile) = {synonym:.4}, cos(car, banana) = {unrelated:.4}");
    assert!(
        synonym > unrelated + 0.2,
        "synonym {synonym} vs unrelated {unrelated}"
    );
}

const PARAPHRASES: [(&str, &str); 10] = [
    (
        "How do I reset my password?",
        "I forgot my password, how can I change it?",
    ),
    (
        "The stock market fell sharply today.",
        "Share prices dropped a lot on the exchange today.",
    ),
    (
        "She is cooking pasta for dinner.",
        "For her evening meal she is making spaghetti.",
    ),
    (
        "The train to Paris was delayed by two hours.",
        "Our Paris-bound train arrived two hours late.",
    ),
    (
        "This laptop has a very long battery life.",
        "The notebook's battery lasts for many hours.",
    ),
    (
        "Heavy rain is expected tomorrow morning.",
        "The forecast says it will pour early tomorrow.",
    ),
    (
        "The football team won the championship.",
        "The soccer club took the league title.",
    ),
    (
        "Please install the latest security update.",
        "Apply the newest security patch to your system.",
    ),
    (
        "The museum opens at nine on weekdays.",
        "On weekdays the gallery opens its doors at 9 am.",
    ),
    (
        "Crawlers download web pages to build an index.",
        "A web spider fetches pages so they can be indexed.",
    ),
];

#[test]
fn paraphrases_beat_random_pairs() {
    let Some(embedder) = default_embedder(4, 0) else {
        return;
    };
    let left: Vec<&str> = PARAPHRASES.iter().map(|p| p.0).collect();
    let right: Vec<&str> = PARAPHRASES.iter().map(|p| p.1).collect();
    let a = embedder.embed_batch(&left, TextKind::Passage).unwrap();
    let b = embedder.embed_batch(&right, TextKind::Passage).unwrap();

    let mut paraphrase_sum = 0.0;
    let mut random_sum = 0.0;
    let mut random_count = 0;
    for i in 0..a.len() {
        let own = cosine(&a[i], &b[i]);
        paraphrase_sum += own;
        for (j, other) in b.iter().enumerate() {
            if i == j {
                continue;
            }
            let cross = cosine(&a[i], other);
            random_sum += cross;
            random_count += 1;
            assert!(
                own > cross,
                "pair {i} ({own}) should beat mismatched pair {i}/{j} ({cross})"
            );
        }
    }
    let paraphrase_mean = paraphrase_sum / a.len() as f32;
    let random_mean = random_sum / random_count as f32;
    println!("mean paraphrase cos {paraphrase_mean:.4}, mean random cos {random_mean:.4}");
    assert!(paraphrase_mean > random_mean + 0.3);
}

#[test]
fn batching_sorting_and_threading_do_not_change_results() {
    let Some(parallel) = default_embedder(8, 2) else {
        return;
    };
    let Some(serial) = default_embedder(1, 1) else {
        return;
    };
    let long = "Search engines rank documents by relevance to a query. ".repeat(40);
    let texts: Vec<String> = vec![
        "short".to_string(),
        long.clone(),
        "A medium sized sentence about embeddings and vector search.".to_string(),
        String::new(),
        "  surrounding whitespace is ignored  ".to_string(),
        "Ünïcödé, emoji 🚀 and CJK 漢字 are tokenised too.".to_string(),
        long[..300].to_string(),
    ];
    let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
    let batched = parallel.embed_batch(&refs, TextKind::Passage).unwrap();
    assert_eq!(batched.len(), texts.len());
    for (i, text) in refs.iter().enumerate() {
        let single = serial.embed_batch(&[text], TextKind::Passage).unwrap();
        let cos = cosine(&batched[i], &single[0]);
        assert!(cos > 0.99999, "text {i}: batched vs single cosine {cos}");
        assert_eq!(batched[i].len(), 384);
    }
    let tokens = parallel.count_tokens(&refs, TextKind::Passage).unwrap();
    assert_eq!(
        tokens[1],
        parallel.max_seq_len(),
        "long text must be truncated"
    );
    assert_eq!(tokens[3], 2, "empty text is [CLS] [SEP]");
    assert!(
        parallel
            .embed_batch(&[], TextKind::Query)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn int8_storage_keeps_ranking_quality() {
    let Some(embedder) = default_embedder(4, 0) else {
        return;
    };
    let v = embedder
        .embed_batch(&["car", "automobile", "banana"], TextKind::Passage)
        .unwrap();
    for vector in &v {
        let (q, scale) = quantize_i8(vector);
        assert!(cosine(vector, &dequantize_i8(&q, scale)) > 0.999);
    }
}

#[test]
fn flat_facade_matches_embedder() {
    let Some(embedder) = default_embedder(4, 0) else {
        return;
    };
    // The facade reads APHRODY_EMBED_MODEL; the default model is used when unset.
    if std::env::var("APHRODY_EMBED_MODEL").is_ok() {
        eprintln!("SKIPPED: APHRODY_EMBED_MODEL overrides the facade model");
        return;
    }
    let texts = ["first text", "second, somewhat longer text about crawling"];
    let (flat, dim) = aphrody_embed::native::embed_flat(&texts, "passage").unwrap();
    assert_eq!(dim, 384);
    assert_eq!(flat.len(), 2 * dim);
    let direct = embedder.embed_batch(&texts, TextKind::Passage).unwrap();
    assert!(cosine(&flat[dim..], &direct[1]) > 0.99999);

    let json: serde_json::Value = serde_json::from_str(&aphrody_embed::native::embed_json(
        r#"["first text", "second, somewhat longer text about crawling"]"#,
        "query",
    ))
    .unwrap();
    assert_eq!(json["dim"], 384);
    assert_eq!(json["count"], 2);
    assert_eq!(
        json["model"].as_str().unwrap(),
        embedder.spec().versioned_id(),
        "model ids are stored with vectors and must pin the revision"
    );
    let first: Vec<f32> = json["embeddings"][0]
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x.as_f64().unwrap() as f32)
        .collect();
    assert!(cosine(&first, &direct[0]) > 0.99999);
}

#[test]
fn query_and_passage_prefixes_are_applied() {
    for id in ["intfloat/multilingual-e5-small", "BAAI/bge-small-en-v1.5"] {
        if !common::installed(id) {
            eprintln!("SKIPPED: {id} not installed");
            continue;
        }
        let Some(embedder) = common::embedder(id, EmbedOptions::default()) else {
            continue;
        };
        let text = ["what is a web crawler"];
        let query = embedder.embed_batch(&text, TextKind::Query).unwrap();
        let passage = embedder.embed_batch(&text, TextKind::Passage).unwrap();
        let cos = cosine(&query[0], &passage[0]);
        assert!(
            cos < 0.9999 && cos > 0.5,
            "{id}: query/passage cosine {cos}"
        );
    }
}

#[test]
fn concurrent_callers_share_one_embedder() {
    // Few texts per call and more threads than groups make the native backend use nested
    // (intra-op) parallelism, so rayon may steal other callers' jobs mid-pass.
    let Some(embedder) = default_embedder(4, 0) else {
        return;
    };
    let long = "Distributed crawlers coordinate frontiers across many machines. ".repeat(30);
    let texts = [long.as_str(), "a short query about crawling"];
    let expected = embedder.embed_batch(&texts, TextKind::Passage).unwrap();
    std::thread::scope(|scope| {
        for _ in 0..6 {
            scope.spawn(|| {
                for _ in 0..5 {
                    let got = embedder.embed_batch(&texts, TextKind::Passage).unwrap();
                    for (g, e) in got.iter().zip(&expected) {
                        assert!(cosine(g, e) > 0.99999);
                    }
                }
            });
        }
    });
}
