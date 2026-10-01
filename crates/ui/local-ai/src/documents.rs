// SPDX-License-Identifier: Apache-2.0
//! The JSON documents of `aphrody model ... --json`, shaped once.
//!
//! The CLI prints these documents and every GUI adapter hands them to its webview, so the shaping
//! lives here and nowhere else: a key renamed in one place is renamed for every consumer. Each
//! function takes the typed `aphrody-models` values its caller already holds (the CLI keeps them to
//! draw its human tables) and returns the document. None of them touches the disk or the network,
//! so they are cheap to test and cannot disagree with the operation that produced the values.
//!
//! The key names are a compatibility contract (snake case, as the CLI has always printed them):
//! the bundled desktop UI reads them.

use std::path::Path;

use aphrody_llama_server::RunState;
use aphrody_models::{
    CatalogEntry, GcReport, HardwareProfile, InstalledModel, ModelRef, ModelStore, ModelTask,
    PullOutcome, ReconcileReport, Recommendation, SpeedTier, VerifyReport, WeightsLicense,
};
use serde_json::{Value, json};

/// `model catalog`: `{ count, entries }`.
#[must_use]
pub fn catalog(entries: &[&CatalogEntry]) -> Value {
    json!({ "count": entries.len(), "entries": entries })
}

/// `model list`: `{ root, count, total_bytes, models }`.
#[must_use]
pub fn installed(root: &Path, models: &[InstalledModel]) -> Value {
    let total: u64 = models.iter().map(|m| m.bytes).sum();
    json!({
        "root": root,
        "count": models.len(),
        "total_bytes": total,
        "models": models.iter().map(|m| json!({
            "ref": m.reference.to_string(),
            "path": m.path,
            "bytes": m.bytes,
            "sha256": m.sha256,
            "format": m.format.as_str(),
            "catalog_id": m.catalog_id,
            "installed_at": m.installed_at_rfc3339(),
            "last_used_at": m.last_used_at_rfc3339(),
        })).collect::<Vec<_>>(),
    })
}

/// `model accel`: the hardware profile itself.
///
/// # Errors
///
/// A value that cannot be represented as JSON (not expected for a [`HardwareProfile`]).
pub fn hardware(profile: &HardwareProfile) -> Result<Value, serde_json::Error> {
    serde_json::to_value(profile)
}

/// `model recommend`: `{ task, prefer, hardware, ranked, top }`.
///
/// `top` is the id of the first ranked entry, `null` when nothing is ranked (callers report that
/// case as an error before they get here).
#[must_use]
pub fn recommended(
    task: ModelTask,
    prefer: SpeedTier,
    profile: &HardwareProfile,
    ranked: &[Recommendation],
) -> Value {
    let top = ranked.first().map(|recommendation| recommendation.id.as_str());
    json!({
        "task": task.as_str(),
        "prefer": prefer.as_str(),
        "hardware": profile,
        "ranked": ranked,
        "top": top,
    })
}

/// `model pull`: `{ spec, artifacts, transferred_bytes, total_bytes }`.
#[must_use]
pub fn pulled(spec: &str, outcomes: &[PullOutcome]) -> Value {
    let transferred: u64 =
        outcomes.iter().filter(|o| o.transferred()).map(|o| o.model().bytes).sum();
    let total: u64 = outcomes.iter().map(|o| o.model().bytes).sum();
    json!({
        "spec": spec,
        "artifacts": outcomes.iter().map(|o| {
            let m = o.model();
            json!({
                "ref": m.reference.to_string(),
                "path": m.path,
                "bytes": m.bytes,
                "sha256": m.sha256,
                "format": m.format.as_str(),
                "outcome": outcome_label(o),
            })
        }).collect::<Vec<_>>(),
        "transferred_bytes": transferred,
        "total_bytes": total,
    })
}

/// Stable machine-readable word for what a pull did.
#[must_use]
pub const fn outcome_label(outcome: &PullOutcome) -> &'static str {
    match outcome {
        PullOutcome::AlreadyPresent(_) => "already-present",
        PullOutcome::Downloaded(_) => "downloaded",
        PullOutcome::Adopted(_) => "adopted",
    }
}

/// `model info`: `{ spec, license, artifacts }`, one entry per artefact, installed or not.
#[must_use]
pub fn info(
    spec: &str,
    license: Option<&WeightsLicense>,
    found: &[(ModelRef, Option<InstalledModel>)],
    store: &ModelStore,
) -> Value {
    json!({
        "spec": spec,
        "license": license,
        "artifacts": found.iter().map(|(reference, entry)| match entry {
            Some(m) => json!({
                "ref": reference.to_string(),
                "installed": true,
                "path": m.path,
                "bytes": m.bytes,
                "sha256": m.sha256,
                "format": m.format.as_str(),
                "catalog_id": m.catalog_id,
                "installed_at": m.installed_at_rfc3339(),
                "last_used_at": m.last_used_at_rfc3339(),
                "inspection": m.inspection,
            }),
            None => json!({
                "ref": reference.to_string(),
                "installed": false,
                "path": store.path_for(reference),
            }),
        }).collect::<Vec<_>>(),
    })
}

/// `model verify`: `{ spec, intact, artifacts }`. A corrupt artefact is `intact: false`, not an
/// error; the CLI turns it into a non-zero exit itself.
#[must_use]
pub fn verified(spec: &str, reports: &[VerifyReport]) -> Value {
    let intact = reports.iter().all(VerifyReport::is_intact);
    json!({ "spec": spec, "intact": intact, "artifacts": reports })
}

/// `model rm`: `{ spec, removed, reclaimed_bytes }`.
#[must_use]
pub fn removed(spec: &str, removed: &[InstalledModel]) -> Value {
    let reclaimed: u64 = removed.iter().map(|m| m.bytes).sum();
    json!({
        "spec": spec,
        "removed": removed.iter().map(|m| m.reference.to_string()).collect::<Vec<_>>(),
        "reclaimed_bytes": reclaimed,
    })
}

/// `model gc`: the garbage-collection report itself.
///
/// # Errors
///
/// A value that cannot be represented as JSON (not expected for a [`GcReport`]).
pub fn gc(report: &GcReport) -> Result<Value, serde_json::Error> {
    serde_json::to_value(report)
}

/// `model doctor`: `{ root, clean, report }`.
#[must_use]
pub fn doctor(root: &Path, drift: &ReconcileReport) -> Value {
    json!({ "root": root, "clean": drift.is_clean(), "report": drift })
}

/// `model adopt`: the adopted artefact.
#[must_use]
pub fn adopted(entry: &InstalledModel) -> Value {
    json!({
        "ref": entry.reference.to_string(),
        "path": entry.path,
        "bytes": entry.bytes,
        "sha256": entry.sha256,
        "format": entry.format.as_str(),
        "inspection": entry.inspection,
    })
}

/// `model ps`: `{ count, instances }`, one instance per running managed model server.
#[must_use]
pub fn running(instances: &[RunState]) -> Value {
    json!({
        "count": instances.len(),
        "instances": instances.iter().map(|state| json!({
            "role": state.role.as_str(),
            "alias": state.alias,
            "port": state.port,
            "ready": state.ready,
            "model": state.model,
            "base_url": state.base_url(),
            "started_unix": state.started_unix,
        })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use aphrody_llama_server::Role;
    use aphrody_models::{ArtifactFormat, Catalog};

    use super::*;

    fn model(reference: &str, bytes: u64, catalog_id: Option<&str>) -> InstalledModel {
        InstalledModel {
            reference: ModelRef::parse(reference).unwrap(),
            path: PathBuf::from("/models/x.gguf"),
            stored_path: "x.gguf".to_owned(),
            bytes,
            sha256: "ab".repeat(32),
            format: ArtifactFormat::Gguf,
            installed_at: 1_700_000_000,
            last_used_at: None,
            catalog_id: catalog_id.map(ToOwned::to_owned),
            inspection: None,
        }
    }

    #[test]
    fn catalog_document_counts_its_entries() {
        let entries: Vec<&CatalogEntry> = Catalog::builtin().entries.iter().collect();
        let document = catalog(&entries);
        assert_eq!(document["count"], entries.len());
        assert_eq!(document["entries"].as_array().unwrap().len(), entries.len());
    }

    #[test]
    fn installed_document_keeps_the_cli_keys() {
        let models = vec![model("hf:a/b/c.gguf", 10, Some("c")), model("hf:a/b/d.gguf", 5, None)];
        let document = installed(Path::new("/models"), &models);
        assert_eq!(document["root"], "/models");
        assert_eq!(document["count"], 2);
        assert_eq!(document["total_bytes"], 15);
        let first = &document["models"][0];
        for key in
            ["ref", "path", "bytes", "sha256", "format", "catalog_id", "installed_at", "last_used_at"]
        {
            assert!(first.get(key).is_some(), "missing `{key}` in {first}");
        }
        assert_eq!(first["format"], "gguf");
        assert_eq!(first["last_used_at"], Value::Null);
        assert_eq!(document["models"][1]["catalog_id"], Value::Null);
    }

    #[test]
    fn removed_document_sums_the_reclaimed_bytes() {
        let removed_models = vec![model("hf:a/b/c.gguf", 10, None), model("hf:a/b/d.gguf", 5, None)];
        let document = removed("c", &removed_models);
        assert_eq!(document["spec"], "c");
        assert_eq!(document["reclaimed_bytes"], 15);
        assert_eq!(document["removed"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn an_empty_ranking_has_a_null_top() {
        let profile = HardwareProfile {
            accelerators: vec![aphrody_models::Accelerator::Cpu],
            gpus: Vec::new(),
            cuda_toolkit: None,
            cpu_threads: 4,
        };
        let document = recommended(ModelTask::Ocr, SpeedTier::Fast, &profile, &[]);
        assert_eq!(document["task"], "ocr");
        assert_eq!(document["prefer"], "fast");
        assert_eq!(document["top"], Value::Null);
        assert_eq!(document["hardware"]["cpu_threads"], 4);
    }

    #[test]
    fn outcome_labels_are_stable_machine_words() {
        let entry = model("hf:a/b/c.gguf", 1, None);
        assert_eq!(outcome_label(&PullOutcome::AlreadyPresent(entry.clone())), "already-present");
        assert_eq!(outcome_label(&PullOutcome::Downloaded(entry.clone())), "downloaded");
        assert_eq!(outcome_label(&PullOutcome::Adopted(entry)), "adopted");
    }

    #[test]
    fn pulled_document_separates_transferred_from_total_bytes() {
        let outcomes = vec![
            PullOutcome::Downloaded(model("hf:a/b/c.gguf", 10, None)),
            PullOutcome::AlreadyPresent(model("hf:a/b/d.gguf", 5, None)),
        ];
        let document = pulled("c", &outcomes);
        assert_eq!(document["transferred_bytes"], 10);
        assert_eq!(document["total_bytes"], 15);
        assert_eq!(document["artifacts"][0]["outcome"], "downloaded");
        assert_eq!(document["artifacts"][1]["outcome"], "already-present");
    }

    #[test]
    fn doctor_document_reports_cleanliness() {
        let clean = doctor(Path::new("/models"), &ReconcileReport::default());
        assert_eq!(clean["clean"], true);
        let drifted = ReconcileReport {
            missing: vec!["hf:a/b/c.gguf".to_owned()],
            ..ReconcileReport::default()
        };
        assert_eq!(doctor(Path::new("/models"), &drifted)["clean"], false);
    }

    #[test]
    fn running_document_lists_each_instance_with_its_base_url() {
        let state = RunState {
            role: Role::Chat,
            daemon_pid: 1,
            server_pid: 2,
            port: 4242,
            fingerprint: "f".to_owned(),
            alias: "qwen".to_owned(),
            model: PathBuf::from("/models/qwen.gguf"),
            binary: PathBuf::from("/bin/llama-server"),
            started_unix: 7,
            ready: true,
        };
        let document = running(&[state]);
        assert_eq!(document["count"], 1);
        let instance = &document["instances"][0];
        assert_eq!(instance["role"], "chat");
        assert_eq!(instance["base_url"], "http://127.0.0.1:4242/v1");
        assert_eq!(instance["ready"], true);
        assert_eq!(running(&[])["count"], 0);
    }
}
