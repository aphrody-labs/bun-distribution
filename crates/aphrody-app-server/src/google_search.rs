// SPDX-License-Identifier: Apache-2.0
//! Narrow anonymous Google Search extension shared by HTTP and desktop RPC.
use super::AppServerError;
use aphrody_google::search::{execute_search_request, parse_search_request};
use serde_json::Value;

pub(super) async fn dispatch(enabled: bool, params: &Value) -> Result<Value, AppServerError> {
    if !enabled {
        return Err(AppServerError::InvalidRequest(
            "initialize with capabilities.aphrody=true before using aphrody/google/search".into(),
        ));
    }
    let (_, options, _) = parse_search_request(params).map_err(AppServerError::InvalidRequest)?;
    if !options.anonymous {
        return Err(AppServerError::InvalidRequest(
            "aphrody/google/search requires anonymous=true; account cookies are unavailable".into(),
        ));
    }
    tokio::time::timeout(std::time::Duration::from_secs(30), execute_search_request(params))
        .await
        .map_err(|_| AppServerError::Runtime("Google Search exceeded its 30s budget".into()))?
        .map_err(AppServerError::Runtime)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AppServer;
    use serde_json::json;

    async fn request(server: &mut AppServer, params: Value) -> Value {
        let response = server
            .handle(&json!({"id":1,"method":"aphrody/google/search","params":params}).to_string())
            .await
            .unwrap()
            .unwrap();
        serde_json::from_str(&response).unwrap()
    }

    #[tokio::test]
    async fn native_rpc_requires_handshake_and_explicit_extension_negotiation() {
        let home = tempfile::tempdir().unwrap();
        let mut server = AppServer::with_home(home.path());
        assert_eq!(
            request(&mut server, json!({"query":"Aphrody","anonymous":true})).await["error"]["code"],
            -32002
        );
        server.handle(r#"{"id":0,"method":"initialize"}"#).await.unwrap();
        server.handle(r#"{"method":"initialized"}"#).await.unwrap();
        let denied = request(&mut server, json!({"query":"Aphrody","anonymous":true})).await;
        assert_eq!(denied["error"]["code"], -32602);
        assert!(denied["error"]["message"].as_str().unwrap().contains("capabilities.aphrody"));
    }

    #[tokio::test]
    async fn native_rpc_rejects_cookie_access_and_invalid_options_before_network() {
        let home = tempfile::tempdir().unwrap();
        let mut server = AppServer::with_home(home.path());
        server
            .handle(r#"{"id":0,"method":"initialize","params":{"capabilities":{"aphrody":true}}}"#)
            .await
            .unwrap();
        server.handle(r#"{"method":"initialized"}"#).await.unwrap();
        for params in [
            json!({"query":"Aphrody"}),
            json!({"query":"Aphrody","anonymous":false}),
            json!({"query":"Aphrody","anonymous":true,"cookie_path":"private"}),
            json!({"query":"Aphrody","anonymous":true,"start":1001}),
            json!({"query":" ","anonymous":true}),
        ] {
            let result = request(&mut server, params).await;
            assert_eq!(result["error"]["code"], -32602, "{result}");
            assert_ne!(result["error"]["message"], "method not found: aphrody/google/search");
        }
    }
}
