// SPDX-License-Identifier: Apache-2.0
use aphrody_jev::{Question, Request, Response, check_request, check_response, protocol};
use serde_json::{Value, json};

fn request() -> Value {
    json!({"state": {"ticket": ["refund", null]}, "questions": {
        "accepted": {"type": "noul"},
        "route": {"type": "choice", "instructions": {"policy": ["closed set"]},
                  "criteria": {"read": null, "search": {"kind": "web"}}},
        "priority": {"type": "score", "criteria": [null, {"level": "high"}]}
    }})
}

fn response() -> Value {
    json!({"model": "fixture", "usage": null, "answers": {
        "accepted": {"type": "noul", "noul": 0.8},
        "route": {"type": "choice", "choice": "read", "confidence": 0.9,
                  "probabilities": {"read": 0.9, "search": 0.1}},
        "priority": {"type": "score", "score": 0.8, "confidence": 0.7,
                     "legend": {"0": null, "1": {"level": "high"}},
                     "probabilities": {"0": 0.2, "1": 0.8}}
    }})
}

#[test]
fn structured_entries_optional_instructions_and_unknown_usage_share_typed_and_raw_validation() {
    let raw_request = request();
    let raw_response = response();
    protocol::request(&raw_request).unwrap();
    protocol::response(&raw_response, &raw_request).unwrap();
    let typed_request: Request = serde_json::from_value(raw_request.clone()).unwrap();
    let typed_response: Response = serde_json::from_value(raw_response).unwrap();
    check_request(&typed_request).unwrap();
    check_response(&typed_request, &typed_response).unwrap();
    assert!(typed_response.usage.is_none());
    assert_eq!(
        serde_json::to_value(&typed_request.questions).unwrap(),
        raw_request["questions"]
    );
    assert_eq!(
        protocol::primitive(
            &serde_json::to_value(&typed_response.answers["accepted"]).unwrap(),
            0.5
        )
        .unwrap(),
        json!(true)
    );
}

#[test]
fn invalid_entries_unknown_fields_and_prototype_names_are_rejected() {
    for (name, question) in [
        ("bad", json!({"type":"noul", "instructions":true})),
        ("bad", json!({"type":"noul", "extra":null})),
        ("__proto__", json!({"type":"noul"})),
        ("constructor", json!({"type":"noul"})),
        (
            "bad",
            json!({"type":"choice", "criteria":{"prototype":null,"ok":null}}),
        ),
    ] {
        let request = json!({"state":null,"questions":{name:question}});
        assert!(protocol::request(&request).is_err(), "{request}");
    }
    let mut request = request();
    request["state"] = json!(false);
    assert!(protocol::request(&request).is_err());
    assert!(serde_json::from_value::<Question>(json!({"type":"noul", "extra":null})).is_err());
}

#[test]
fn answer_distributions_legends_and_safe_usage_counts_are_checked() {
    let request = request();
    for response in [
        {
            let mut value = response();
            value["answers"]["route"]["probabilities"]
                .as_object_mut()
                .unwrap()
                .remove("search");
            value
        },
        {
            let mut value = response();
            value["answers"]["priority"]["legend"]["1"] = json!("wrong");
            value
        },
        {
            let mut value = response();
            value["usage"] = json!({"input_tokens":-1,"output_tokens":0});
            value
        },
        {
            let mut value = response();
            value["usage"] = json!({"input_tokens":9007199254740992u64,"output_tokens":0});
            value
        },
        {
            let mut value = response();
            value["answers"]["accepted"]["noul"] = json!(1.01);
            value
        },
    ] {
        assert!(
            protocol::response(&response, &request).is_err(),
            "{response}"
        );
    }
}

#[test]
fn parser_and_question_counts_keep_the_existing_bun_bounds() {
    assert!(protocol::parse(&vec![b' '; protocol::MAX_JSON_BYTES + 1]).is_err());
    let questions = (0..65)
        .map(|index| (index.to_string(), json!({"type":"noul"})))
        .collect::<serde_json::Map<_, _>>();
    assert!(protocol::request(&json!({"state":null,"questions":questions})).is_err());
    let criteria = (0..256)
        .map(|index| (index.to_string(), Value::Null))
        .collect::<serde_json::Map<_, _>>();
    assert!(protocol::question(&json!({"type":"choice","criteria":criteria})).is_err());
    assert!(protocol::question(&json!({"type":"score","criteria":vec![Value::Null;11]})).is_err());
    let too_large = Request::new("x".repeat(protocol::MAX_JSON_BYTES))
        .question("accepted", Question::noul(Value::Null));
    assert!(check_request(&too_large).is_err());
}

#[test]
fn typed_deserialization_does_not_fill_missing_required_usage_or_discard_request_fields() {
    let mut no_usage = response();
    no_usage.as_object_mut().unwrap().remove("usage");
    assert!(serde_json::from_value::<Response>(no_usage.clone()).is_err());
    assert!(protocol::response(&no_usage, &request()).is_err());
    let mut incomplete_usage = response();
    incomplete_usage["usage"] = json!({"input_tokens":0});
    assert!(serde_json::from_value::<Response>(incomplete_usage.clone()).is_err());
    assert!(protocol::response(&incomplete_usage, &request()).is_err());
    let mut unknown_field = request();
    unknown_field["extra"] = Value::Null;
    assert!(serde_json::from_value::<Request>(unknown_field.clone()).is_err());
    assert!(protocol::request(&unknown_field).is_err());
}

#[test]
fn standalone_helpers_reject_invalid_questions_values_and_thresholds() {
    let empty_score = json!({"type":"score","criteria":[]});
    let answer = json!({"type":"score","score":0,"confidence":1,"probabilities":{},"legend":{}});
    assert!(protocol::answer(&answer, &empty_score).is_err());
    for threshold in [f64::NAN, f64::INFINITY, -0.1, 1.1] {
        assert!(protocol::primitive(&json!({"type":"noul","noul":0.5}), threshold).is_err());
    }
    for answer in [
        json!({"type":"noul"}),
        json!({"type":"choice","choice":null}),
        json!({"type":"score","score":-1}),
    ] {
        assert!(protocol::primitive(&answer, 0.5).is_err());
    }
}
