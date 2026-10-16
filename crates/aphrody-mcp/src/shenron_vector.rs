// SPDX-License-Identifier: Apache-2.0
//! Optional E5 vector recall for Shenron's private PostgreSQL corpus.

use std::time::Duration;

use aphrody_sql::pg::vector;
use serde_json::{Value, json};
use tokio_postgres::{Client, Row};

const MODEL: &str = "Xenova/multilingual-e5-small";
// Embeddings are bound as typed pgvector `vector` values (binary protocol), never as
// `[..]::text::vector` string literals.

pub(crate) struct Filters<'a> {
    pub lang: Option<&'a str>,
    pub kind: Option<&'a str>,
    pub origin_source_id: Option<&'a str>,
    pub entity: Option<&'a str>,
}

/// Returns `None` when the matching E5 model, backend, or index is unavailable.
/// The caller continues to serve lexical search in those cases.
pub(crate) async fn search(
    database: &Client,
    query: &str,
    filters: Filters<'_>,
    limit: i64,
) -> Option<Vec<Row>> {
    let embedding = vector::from_f64(&embed(query, "query").await?)?;
    let sql = r#"
        SELECT d.entity_id::text, d.title::text, d.url::text, d.content::text,
               (1.0 / (1.0 + (v.embedding <=> $1::vector)))::float8,
               COALESCE(d.metadata->>'kind','document'), d.metadata->>'lang',
               COALESCE(d.metadata->>'originSourceId',d.metadata->>'sourceId',d.metadata->>'source_id'),
               d.metadata->>'entity', d.id::text, d.corpus::text
        FROM aphrody_shenron_vectors v JOIN aphrody_rag_documents d ON d.id=v.document_id
        WHERE v.model=$2 AND d.corpus='shenron' AND d.updated_at <= v.created_at
          AND COALESCE(d.metadata->>'visible','true') <> 'false'
          AND ($3::text IS NULL OR d.metadata->>'lang'=$3)
          AND ($4::text IS NULL OR d.metadata->>'kind'=$4)
          AND ($5::text IS NULL OR COALESCE(d.metadata->>'originSourceId',d.metadata->>'sourceId',d.metadata->>'source_id')=$5)
          AND ($6::text IS NULL OR d.metadata->>'entity'=$6)
        ORDER BY v.embedding <=> $1::vector LIMIT $7
    "#;
    tokio::time::timeout(
        Duration::from_secs(3),
        database.query(
            sql,
            &[
                &embedding,
                &MODEL,
                &filters.lang,
                &filters.kind,
                &filters.origin_source_id,
                &filters.entity,
                &limit,
            ],
        ),
    )
    .await
    .ok()?
    .ok()
}

/// Indexes new/changed passages only if their text still matches the committed
/// document. The lexical ingest remains successful when model inference fails.
pub(crate) async fn index_document(
    database: &Client,
    id: &str,
    title: &str,
    content: &str,
) -> bool {
    // A resumed generation must reuse vectors that still match the committed text.
    // Metadata-only updates keep updated_at unchanged and cannot mix model spaces.
    let current = tokio::time::timeout(
        Duration::from_secs(3),
        database.query_opt(
            "SELECT 1 FROM aphrody_shenron_vectors v JOIN aphrody_rag_documents d ON \
             d.id=v.document_id WHERE d.id=$1::text::uuid AND d.title=$2 AND d.content=$3 \
             AND v.model=$4 AND v.created_at>=d.updated_at",
            &[&id, &title, &content, &MODEL],
        ),
    )
    .await;
    if matches!(current, Ok(Ok(Some(_)))) {
        return true;
    }
    let passage = format!("{title}. {content}").chars().take(1200).collect::<String>();
    let Some(embedding) =
        embed(&passage, "passage").await.and_then(|values| vector::from_f64(&values))
    else {
        return false;
    };
    let sql = "INSERT INTO aphrody_shenron_vectors (document_id,model,embedding) SELECT \
               id,$2,$3::vector FROM aphrody_rag_documents WHERE id=$1::text::uuid AND title=$4 \
               AND content=$5 ON CONFLICT (document_id) DO UPDATE SET \
               model=EXCLUDED.model,embedding=EXCLUDED.embedding,created_at=now()";
    matches!(
        tokio::time::timeout(
            Duration::from_secs(10),
            database.execute(sql, &[&id, &MODEL, &embedding, &title, &content])
        )
        .await,
        Ok(Ok(1))
    )
}

async fn embed(text: &str, kind: &str) -> Option<Vec<f64>> {
    // The shenron vector table is a fixed embedding space (384-dim
    // `multilingual-e5-small`, `indexes.shenron-rag` in
    // `tools/aphrody/config/local-ai.json`): the configured model must be
    // exactly `MODEL`, resolved through the canonical `APHRODY_AI_EMBED_MODEL`
    // (and its legacy `APHRODY_SHENRON_EMBED_MODEL` / `APHRODY_RAG_EMBED_MODEL`
    // aliases) so an operator setting either name gets this recall — never a
    // different model silently mixed into the same space.
    if aphrody_config::ai_env::EMBED_MODEL.resolve().as_deref() != Some(MODEL) {
        return None;
    }
    let base = aphrody_config::ai_env::EMBED_BASE_URL.resolve()?;
    let mut url = reqwest::Url::parse(&base).ok()?;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    url.set_path(&format!("{}/embeddings", url.path().trim_end_matches('/')));
    let request = json!({"model": MODEL, "input": [format!("{kind}: {}", text.split_whitespace().collect::<Vec<_>>().join(" "))]});
    let payload: Value = reqwest::Client::new()
        .post(url)
        .json(&request)
        .timeout(Duration::from_secs(if kind == "passage" { 20 } else { 4 }))
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    let values = payload.get("data")?.as_array()?.first()?.get("embedding")?.as_array()?;
    if values.len() != 384 {
        return None;
    }
    let vector = values
        .iter()
        .map(Value::as_f64)
        .collect::<Option<Vec<_>>>()?
        .into_iter()
        .filter(|value| value.is_finite())
        .collect::<Vec<_>>();
    if vector.len() != 384 {
        return None;
    }
    Some(vector)
}

#[cfg(test)]
mod tests {
    use super::MODEL;

    #[test]
    fn archived_vectors_require_exact_model_space() {
        assert_eq!(MODEL, "Xenova/multilingual-e5-small");
    }
}
