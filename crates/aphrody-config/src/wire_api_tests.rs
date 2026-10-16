// SPDX-License-Identifier: Apache-2.0
use pretty_assertions::assert_eq;

use super::*;

#[test]
fn default_is_chat() {
    assert_eq!(WireApi::default(), WireApi::Chat);
}

#[derive(Deserialize)]
struct Wrapper {
    api: WireApi,
}

#[test]
fn accepts_chat_unlike_upstream() {
    let wrapper: Wrapper = toml::from_str("api = \"chat\"").expect("parse table");
    assert_eq!(wrapper.api, WireApi::Chat);
}

#[test]
fn round_trips_every_variant() {
    for api in [
        WireApi::Chat,
        WireApi::Responses,
        WireApi::Antigravity,
        WireApi::Anthropic,
    ] {
        let json = serde_json::to_string(&api).expect("serialize");
        let back: WireApi = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, api);
    }
}

#[test]
fn rejects_unknown_variant() {
    let err = serde_json::from_str::<WireApi>("\"grpc\"").expect_err("unknown variant");
    assert!(err.to_string().contains("grpc"));
}

#[test]
fn display_matches_serde_name() {
    assert_eq!(WireApi::Antigravity.to_string(), "antigravity");
}
