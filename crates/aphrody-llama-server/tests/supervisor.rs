// SPDX-License-Identifier: Apache-2.0
//! The supervisor against real processes: a real detached daemon
//! (`aphrody-llama-daemon`) owning a stand-in server
//! (`aphrody-fake-llama-server`). Run with `--features test-support`.
#![cfg(feature = "test-support")]

use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use aphrody_llama_server::{
    DaemonCommand, EnsureOptions, KvQuant, LlamaServerSpec, LoraAdapter, Placement, Plan, Role,
    StateDirs, Supervisor, SupervisorError,
};
use aphrody_proc::{GpuLease, LeaseKind, process_alive};
use pretty_assertions::assert_eq;

const FAKE_SERVER: &str = env!("CARGO_BIN_EXE_aphrody-fake-llama-server");
const DAEMON: &str = env!("CARGO_BIN_EXE_aphrody-llama-daemon");

fn supervisor(root: &Path) -> Supervisor {
    Supervisor::new(
        StateDirs::new(root),
        DaemonCommand {
            program: PathBuf::from(DAEMON),
            args: Vec::new(),
        },
    )
}

fn plan(role: Role, ctx: u32, extra_args: &[&str]) -> Plan {
    Plan {
        spec: LlamaServerSpec {
            role,
            model: PathBuf::from("model.gguf"),
            draft_model: None,
            mmproj: None,
            alias: "fake-model".to_string(),
            ctx,
            kv: KvQuant::Q8_0,
            placement: Placement::Auto { margin_mib: 1024 },
            parallel: 1,
            jinja: true,
            chat_template_file: None,
            pooling: None,
            lora: Vec::new(),
            extra_args: extra_args.iter().map(|arg| (*arg).to_string()).collect(),
        },
        estimated_vram_bytes: 6 << 30,
        notes: Vec::new(),
    }
}

fn quick() -> EnsureOptions {
    EnsureOptions {
        keep_alive: Some(Duration::from_secs(120)),
        ready_timeout: Duration::from_secs(20),
        lease_timeout: Duration::from_secs(1),
    }
}

fn wait_until(what: &str, within: Duration, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + within;
    while Instant::now() < deadline {
        if condition() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(condition(), "timed out waiting for: {what}");
}

#[tokio::test(flavor = "multi_thread")]
async fn spawns_then_attaches_then_stops() {
    let root = tempfile::tempdir().expect("tempdir");
    let supervisor = supervisor(root.path());
    let plan = plan(Role::Chat, 32_768, &[]);

    let first = supervisor
        .ensure(Path::new(FAKE_SERVER), &plan, quick())
        .await
        .expect("spawn");
    assert!(!first.attached);
    assert!(first.state.ready);
    assert_eq!(first.state.alias, "fake-model");
    assert!(process_alive(first.state.daemon_pid) && process_alive(first.state.server_pid));
    assert_eq!(
        first.base_url(),
        format!("http://127.0.0.1:{}/v1", first.state.port)
    );

    // The build-aware command line reached the server.
    let props = first.client().props().await.expect("props");
    let args: Vec<&str> = props["args"]
        .as_array()
        .expect("args")
        .iter()
        .filter_map(|a| a.as_str())
        .collect();
    for expected in [
        "--fit",
        "on",
        "--ctx-size",
        "32768",
        "--cache-type-k",
        "q8_0",
        "--jinja",
        "--no-webui",
    ] {
        assert!(args.contains(&expected), "missing {expected} in {args:?}");
    }
    assert_eq!(
        first
            .client()
            .count_tokens("four words in here")
            .await
            .expect("tokenize"),
        4
    );

    // Same spec: the running instance is reused, no second model load.
    let second = supervisor
        .ensure(Path::new(FAKE_SERVER), &plan, quick())
        .await
        .expect("attach");
    assert!(second.attached);
    assert_eq!(second.state.server_pid, first.state.server_pid);

    // It holds the GPU lease for everyone to see.
    let holders = GpuLease::holders(supervisor.dirs().locks()).expect("holders");
    assert_eq!(holders.len(), 1);
    assert_eq!(
        (holders[0].role.as_str(), holders[0].pid),
        ("llama-chat", first.state.daemon_pid)
    );
    assert_eq!(holders[0].vram_bytes, 6 << 30);

    assert!(supervisor.stop(Role::Chat).await.expect("stop"));
    wait_until("daemon and server gone", Duration::from_secs(10), || {
        !process_alive(first.state.daemon_pid) && !process_alive(first.state.server_pid)
    });
    assert_eq!(supervisor.status(Role::Chat), None);
    assert!(
        GpuLease::holders(supervisor.dirs().locks())
            .expect("holders")
            .is_empty()
    );
    assert!(
        !supervisor.stop(Role::Chat).await.expect("stop again"),
        "nothing left to stop"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_different_spec_replaces_the_running_instance() {
    let root = tempfile::tempdir().expect("tempdir");
    let supervisor = supervisor(root.path());

    let first = supervisor
        .ensure(
            Path::new(FAKE_SERVER),
            &plan(Role::Chat, 32_768, &[]),
            quick(),
        )
        .await
        .expect("first");
    let second = supervisor
        .ensure(
            Path::new(FAKE_SERVER),
            &plan(Role::Chat, 8_192, &[]),
            quick(),
        )
        .await
        .expect("second");

    assert!(!second.attached);
    assert_ne!(second.state.server_pid, first.state.server_pid);
    assert_ne!(second.state.fingerprint, first.state.fingerprint);
    wait_until("old server gone", Duration::from_secs(10), || {
        !process_alive(first.state.server_pid)
    });

    supervisor.stop_all().await.expect("stop all");
}

#[tokio::test(flavor = "multi_thread")]
async fn roles_run_side_by_side() {
    let root = tempfile::tempdir().expect("tempdir");
    let supervisor = supervisor(root.path());

    let chat = supervisor
        .ensure(
            Path::new(FAKE_SERVER),
            &plan(Role::Chat, 32_768, &[]),
            quick(),
        )
        .await
        .expect("chat");
    let embed = supervisor
        .ensure(
            Path::new(FAKE_SERVER),
            &plan(Role::Embed, 8_192, &[]),
            quick(),
        )
        .await
        .expect("embed");
    assert_ne!(chat.state.port, embed.state.port);
    assert_eq!(
        GpuLease::holders(supervisor.dirs().locks())
            .expect("holders")
            .len(),
        2
    );

    let stopped = supervisor.stop_all().await.expect("stop all");
    assert_eq!(stopped, vec![Role::Chat, Role::Embed]);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_slow_model_load_is_waited_for() {
    let root = tempfile::tempdir().expect("tempdir");
    let supervisor = supervisor(root.path());

    let started = Instant::now();
    let endpoint = supervisor
        .ensure(
            Path::new(FAKE_SERVER),
            &plan(Role::Chat, 4_096, &["--fake-load-ms", "1500"]),
            quick(),
        )
        .await
        .expect("ready after loading");
    assert!(started.elapsed() >= Duration::from_millis(1400));
    assert!(endpoint.state.ready);

    supervisor.stop(Role::Chat).await.expect("stop");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_server_that_dies_at_startup_reports_its_log() {
    let root = tempfile::tempdir().expect("tempdir");
    let supervisor = supervisor(root.path());

    let error = supervisor
        .ensure(
            Path::new(FAKE_SERVER),
            &plan(Role::Chat, 4_096, &["--fake-exit-code", "3"]),
            quick(),
        )
        .await
        .expect_err("startup failure");
    match error {
        SupervisorError::Launch(message) => {
            assert!(message.contains("status Some(3)"), "{message}");
            assert!(message.contains("unknown model architecture"), "{message}");
        }
        other => panic!("expected Launch, got {other}"),
    }
    assert_eq!(supervisor.status(Role::Chat), None);
    assert!(
        GpuLease::holders(supervisor.dirs().locks())
            .expect("holders")
            .is_empty()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn an_idle_instance_shuts_itself_down() {
    let root = tempfile::tempdir().expect("tempdir");
    let supervisor = supervisor(root.path());
    let options = EnsureOptions {
        keep_alive: Some(Duration::from_secs(1)),
        ..quick()
    };

    let endpoint = supervisor
        .ensure(
            Path::new(FAKE_SERVER),
            &plan(Role::Chat, 4_096, &[]),
            options,
        )
        .await
        .expect("spawn");
    wait_until("idle shutdown", Duration::from_secs(15), || {
        !process_alive(endpoint.state.daemon_pid) && !process_alive(endpoint.state.server_pid)
    });
    assert_eq!(supervisor.status(Role::Chat), None);
    assert!(
        !supervisor.dirs().state_file(Role::Chat).exists(),
        "the daemon cleaned up after itself"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn lora_adapters_are_loaded_inactive_then_scaled_and_hot_swapped() {
    let root = tempfile::tempdir().expect("tempdir");
    let supervisor = supervisor(root.path());
    let mut plan = plan(Role::Chat, 4_096, &[]);
    plan.spec.lora = vec![
        LoraAdapter {
            path: PathBuf::from("agent.gguf"),
            scale: 0.5,
        },
        LoraAdapter {
            path: PathBuf::from("style.gguf"),
            scale: 0.0,
        },
    ];

    let endpoint = supervisor
        .ensure(Path::new(FAKE_SERVER), &plan, quick())
        .await
        .expect("spawn");
    let client = endpoint.client();

    let scales: Vec<(u32, f32)> = client
        .lora_adapters()
        .await
        .expect("adapters")
        .iter()
        .map(|a| (a.id, a.scale))
        .collect();
    assert_eq!(scales, vec![(0, 0.5), (1, 0.0)]);

    // Hot swap without restarting the server.
    client
        .set_lora_scales(&[(1, 1.0)])
        .await
        .expect("set scales");
    let scales: Vec<(u32, f32)> = client
        .lora_adapters()
        .await
        .expect("adapters")
        .iter()
        .map(|a| (a.id, a.scale))
        .collect();
    assert_eq!(scales, vec![(0, 0.0), (1, 1.0)]);
    assert_eq!(
        supervisor
            .status(Role::Chat)
            .expect("still running")
            .server_pid,
        endpoint.state.server_pid
    );

    supervisor.stop(Role::Chat).await.expect("stop");
}

#[tokio::test(flavor = "multi_thread")]
async fn inference_is_refused_while_training_holds_the_gpu() {
    let root = tempfile::tempdir().expect("tempdir");
    let supervisor = supervisor(root.path());
    let training = GpuLease::acquire(
        supervisor.dirs().locks(),
        "train-lora",
        LeaseKind::Training,
        11 << 30,
        Duration::from_secs(1),
    )
    .expect("training lease");

    let error = supervisor
        .ensure(
            Path::new(FAKE_SERVER),
            &plan(Role::Chat, 4_096, &[]),
            quick(),
        )
        .await
        .expect_err("gpu busy");
    match error {
        SupervisorError::Launch(message) => {
            assert!(message.contains("gpu busy"), "{message}");
            assert!(message.contains("train-lora"), "{message}");
        }
        other => panic!("expected Launch, got {other}"),
    }

    // Once training is done, the same request goes through.
    drop(training);
    let endpoint = supervisor
        .ensure(
            Path::new(FAKE_SERVER),
            &plan(Role::Chat, 4_096, &[]),
            quick(),
        )
        .await
        .expect("gpu free again");
    assert!(endpoint.state.ready);
    supervisor.stop(Role::Chat).await.expect("stop");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_cpu_instance_needs_no_gpu_lease() {
    let root = tempfile::tempdir().expect("tempdir");
    let supervisor = supervisor(root.path());
    let _training = GpuLease::acquire(
        supervisor.dirs().locks(),
        "train-lora",
        LeaseKind::Training,
        11 << 30,
        Duration::from_secs(1),
    )
    .expect("training lease");

    let mut plan = plan(Role::Embed, 512, &[]);
    plan.spec.placement = Placement::Cpu;
    let endpoint = supervisor
        .ensure(Path::new(FAKE_SERVER), &plan, quick())
        .await
        .expect("cpu");
    let props = endpoint.client().props().await.expect("props");
    let args: Vec<&str> = props["args"]
        .as_array()
        .expect("args")
        .iter()
        .filter_map(|a| a.as_str())
        .collect();
    assert!(
        args.windows(2).any(|w| w == ["--n-gpu-layers", "0"]),
        "{args:?}"
    );
    assert!(args.contains(&"--embeddings"), "{args:?}");

    supervisor.stop(Role::Embed).await.expect("stop");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_state_file_left_by_a_killed_daemon_does_not_block_a_new_launch() {
    let root = tempfile::tempdir().expect("tempdir");
    let supervisor = supervisor(root.path());
    let plan = plan(Role::Chat, 4_096, &[]);

    let first = supervisor
        .ensure(Path::new(FAKE_SERVER), &plan, quick())
        .await
        .expect("first");
    // Kill the daemon the hard way: no cleanup runs.
    aphrody_proc::terminate_process(first.state.daemon_pid).expect("kill daemon");
    wait_until("daemon dead", Duration::from_secs(5), || {
        !process_alive(first.state.daemon_pid)
    });
    // Its server went with it (Job Object on Windows, parent-death signal on Linux).
    wait_until("orphan server dead", Duration::from_secs(10), || {
        !process_alive(first.state.server_pid)
    });
    assert!(
        supervisor.dirs().state_file(Role::Chat).exists(),
        "stale state is still on disk"
    );
    assert_eq!(
        supervisor.status(Role::Chat),
        None,
        "but it is not reported as running"
    );

    let second = supervisor
        .ensure(Path::new(FAKE_SERVER), &plan, quick())
        .await
        .expect("relaunch");
    assert!(!second.attached);
    assert_ne!(second.state.daemon_pid, first.state.daemon_pid);
    supervisor.stop(Role::Chat).await.expect("stop");
}
