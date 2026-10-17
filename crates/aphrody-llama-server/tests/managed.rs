// SPDX-License-Identifier: Apache-2.0
//! End-to-end managed encoder orchestration against the process test double.
#![cfg(feature = "test-support")]

use std::path::{Path, PathBuf};

use aphrody_llama_server::{
    DaemonCommand, ManagedCategory, ManagedLlamaServer, ManagedRequest, StateDirs, Supervisor,
};
use aphrody_models::ModelRef;

const FAKE_SERVER: &str = env!("CARGO_BIN_EXE_aphrody-fake-llama-server");
const DAEMON: &str = env!("CARGO_BIN_EXE_aphrody-llama-daemon");
const GGUF_STRING: u32 = 8;
const GGUF_UINT32: u32 = 4;

fn gguf_string(value: &str) -> Vec<u8> {
    let mut bytes = (value.len() as u64).to_le_bytes().to_vec();
    bytes.extend_from_slice(value.as_bytes());
    bytes
}

fn push_string_metadata(bytes: &mut Vec<u8>, key: &str, value: &str) {
    bytes.extend(gguf_string(key));
    bytes.extend_from_slice(&GGUF_STRING.to_le_bytes());
    bytes.extend(gguf_string(value));
}

fn push_u32_metadata(bytes: &mut Vec<u8>, key: &str, value: u32) {
    bytes.extend(gguf_string(key));
    bytes.extend_from_slice(&GGUF_UINT32.to_le_bytes());
    bytes.extend_from_slice(&value.to_le_bytes());
}

fn write_test_gguf(path: &Path) {
    let mut bytes = b"GGUF".to_vec();
    bytes.extend_from_slice(&3_u32.to_le_bytes());
    bytes.extend_from_slice(&0_u64.to_le_bytes());
    bytes.extend_from_slice(&7_u64.to_le_bytes());
    push_string_metadata(&mut bytes, "general.architecture", "bert");
    push_string_metadata(&mut bytes, "general.name", "managed-test-model");
    push_u32_metadata(&mut bytes, "bert.block_count", 4);
    push_u32_metadata(&mut bytes, "bert.context_length", 8192);
    push_u32_metadata(&mut bytes, "bert.embedding_length", 384);
    push_u32_metadata(&mut bytes, "bert.attention.head_count", 6);
    push_u32_metadata(&mut bytes, "bert.attention.head_count_kv", 6);
    std::fs::write(path, bytes).expect("write test GGUF");
}

fn managed(root: &Path) -> ManagedLlamaServer {
    let supervisor = Supervisor::new(
        StateDirs::new(root),
        DaemonCommand {
            program: PathBuf::from(DAEMON),
            args: Vec::new(),
        },
    );
    ManagedLlamaServer::new(FAKE_SERVER, supervisor)
}

fn request(category: ManagedCategory, model: &Path, store_root: &Path) -> ManagedRequest {
    let mut request = ManagedRequest::new(category);
    request.model = Some(ModelRef::Local(model.to_path_buf()).to_string());
    request.store_root = Some(store_root.to_path_buf());
    request
}

#[tokio::test(flavor = "multi_thread")]
async fn launches_embedding_and_reranking_endpoints_then_stops_cleanly() {
    let root = tempfile::tempdir().expect("tempdir");
    let model = root.path().join("encoder.gguf");
    write_test_gguf(&model);
    let managed = managed(root.path());
    let store_root = root.path().join("models");

    let embedding = managed
        .ensure(&request(ManagedCategory::Embedding, &model, &store_root))
        .await
        .expect("embedding endpoint");
    assert!(embedding.model.already_present);
    assert_eq!(embedding.model.primary_path, model);
    assert_eq!(
        embedding.endpoint.state.role,
        ManagedCategory::Embedding.role()
    );
    let props = embedding
        .endpoint
        .client()
        .props()
        .await
        .expect("embedding props");
    let args: Vec<&str> = props["args"]
        .as_array()
        .expect("args")
        .iter()
        .filter_map(|arg| arg.as_str())
        .collect();
    assert!(args.contains(&"--embeddings"), "{args:?}");

    let reranking = managed
        .ensure(&request(ManagedCategory::Reranking, &model, &store_root))
        .await
        .expect("reranking endpoint");
    assert_eq!(
        reranking.endpoint.state.role,
        ManagedCategory::Reranking.role()
    );
    let props = reranking
        .endpoint
        .client()
        .props()
        .await
        .expect("reranking props");
    let args: Vec<&str> = props["args"]
        .as_array()
        .expect("args")
        .iter()
        .filter_map(|arg| arg.as_str())
        .collect();
    assert!(args.contains(&"--reranking"), "{args:?}");

    assert!(
        managed
            .stop(ManagedCategory::Embedding)
            .await
            .expect("stop embedding")
    );
    assert!(
        managed
            .stop(ManagedCategory::Reranking)
            .await
            .expect("stop reranking")
    );
    assert!(
        managed
            .supervisor()
            .status(ManagedCategory::Embedding.role())
            .is_none()
    );
    assert!(
        managed
            .supervisor()
            .status(ManagedCategory::Reranking.role())
            .is_none()
    );
}
