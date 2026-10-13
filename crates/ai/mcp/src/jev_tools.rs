// SPDX-License-Identifier: Apache-2.0
//! `aphrody_jev_decide`: Jev typed decisions over MCP.
//!
//! The router is built once from the environment (`TYPESAFE_API_KEY`,
//! `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, `JEFF_BASE_URL`); routing,
//! failover and response validation live in `aphrody-jev`.

use std::{
    collections::BTreeMap,
    sync::{Arc, OnceLock},
};

use aphrody_jev::{DEFAULT_MODEL, JevRouter, Question, Request};
use rmcp::schemars;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub(crate) struct JevDecideRequest {
    #[schemars(description = "Content to judge: a string, or a JSON object/array.")]
    pub(crate) state: serde_json::Value,
    #[schemars(description = "Named typed questions. Each value is one of \
                              {\"type\":\"noul\",\"instructions\":\"...\"}, \
                              {\"type\":\"choice\",\"instructions\":\"...\",\"criteria\":{\"\
                              option\":\"meaning\"}} (two options or more), or \
                              {\"type\":\"score\",\"instructions\":\"...\",\"criteria\":[\"\
                              lowest\",\"...\",\"highest\"]}.")]
    pub(crate) questions: BTreeMap<String, serde_json::Value>,
    #[schemars(description = "Model id; defaults to jev-latest.")]
    pub(crate) model: Option<String>,
}

fn router() -> Result<&'static Arc<JevRouter>, String> {
    static ROUTER: OnceLock<Arc<JevRouter>> = OnceLock::new();
    configured_router(&ROUTER, JevRouter::from_env)
}

fn configured_router(
    cache: &OnceLock<Arc<JevRouter>>,
    build: impl FnOnce() -> Result<JevRouter, aphrody_jev::JevError>,
) -> Result<&Arc<JevRouter>, String> {
    if cache.get().is_none() {
        let router = build().map_err(|error| error.to_string())?;
        let _ = cache.set(Arc::new(router));
    }
    cache.get().ok_or_else(|| "Jev router initialization failed".into())
}

/// Run one decision and render the result (or error) as JSON text.
pub(crate) async fn jev_decide(request: JevDecideRequest) -> String {
    let questions = match request
        .questions
        .into_iter()
        .map(|(name, value)| {
            serde_json::from_value::<Question>(value)
                .map(|question| (name.clone(), question))
                .map_err(|error| format!("question `{name}`: {error}"))
        })
        .collect::<Result<BTreeMap<_, _>, _>>()
    {
        Ok(questions) => questions,
        Err(error) => return error_json(&error),
    };
    let router = match router() {
        Ok(router) => router,
        Err(error) => return error_json(&error),
    };
    let request = Request {
        state: request.state,
        model: request.model.unwrap_or_else(|| DEFAULT_MODEL.to_owned()),
        questions,
    };
    match router.decide(&request).await {
        Ok(decision) => serde_json::json!({
            "served_by": decision.served_by.to_string(),
            "latency_ms": u64::try_from(decision.latency.as_millis()).unwrap_or(u64::MAX),
            "failover": decision.failover.map(|f| serde_json::json!({
                "from": f.from.to_string(),
                "to": f.to.to_string(),
                "reason": f.reason,
            })),
            "model": decision.response.model,
            "answers": decision.response.answers,
            "usage": decision.response.usage,
        })
        .to_string(),
        Err(error) => error_json(&error.to_string()),
    }
}

fn error_json(message: &str) -> String {
    serde_json::json!({ "error": message }).to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn unavailable_configuration_can_recover_without_rebuilding_a_valid_router() {
        let cache = OnceLock::new();
        assert!(configured_router(&cache, || Err(aphrody_jev::JevError::NoBackend)).is_err());
        assert!(cache.get().is_none());
        let router = configured_router(&cache, || {
            JevRouter::new(
                None,
                None,
                Some(aphrody_jev::Endpoint::local("http://127.0.0.1:8790", None)?),
                aphrody_jev::RoutingPolicy::default(),
            )
        })
        .unwrap();
        let cached =
            configured_router(&cache, || panic!("a valid router must stay shared")).unwrap();
        assert!(Arc::ptr_eq(router, cached));
    }

    #[tokio::test]
    async fn untyped_question_is_rejected_before_routing() {
        let out = jev_decide(JevDecideRequest {
            state: json!("text"),
            questions: BTreeMap::from([(
                "q".to_owned(),
                json!({ "type": "free", "instructions": "x" }),
            )]),
            model: None,
        })
        .await;
        let value: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert!(value["error"].as_str().unwrap().contains("question `q`"), "{out}");
    }
}
