// SPDX-License-Identifier: Apache-2.0
use std::{
    io::Write,
    sync::{
        Arc,
        atomic::{AtomicI64, Ordering},
    },
    time::Duration,
};

use async_trait::async_trait;
use serde_json::json;
use tokio::io::AsyncBufReadExt;

use super::*;
use crate::{client::Client, transport::serve_connection};

/// A counter: `counter_add` adds to it, `counter_get` reads it; its sub-agent publishes
/// one `counter/started` event.
struct Counter {
    name: &'static str,
    value: AtomicI64,
}

impl Counter {
    fn new(name: &'static str) -> Arc<Self> {
        Arc::new(Self {
            name,
            value: AtomicI64::new(0),
        })
    }
}

#[async_trait]
impl SystemSubsystem for Counter {
    fn name(&self) -> &str {
        self.name
    }

    fn description(&self) -> &str {
        "A counter."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                format!("{}_add", self.name),
                "Add.",
                json!({"type": "object"}),
            ),
            ToolDefinition::new(
                format!("{}_get", self.name),
                "Read.",
                json!({"type": "object"}),
            )
            .read_only(),
        ]
    }

    async fn call(&self, tool: &str, arguments: Value) -> Result<Value, SubsystemError> {
        if tool == format!("{}_add", self.name) {
            let by = arguments
                .get("by")
                .and_then(Value::as_i64)
                .ok_or_else(|| SubsystemError::InvalidArguments("by".into()))?;
            Ok(json!(self.value.fetch_add(by, Ordering::SeqCst) + by))
        } else if tool == format!("{}_get", self.name) {
            Ok(json!({"value": self.value.load(Ordering::SeqCst)}))
        } else {
            Err(SubsystemError::UnknownTool(tool.to_owned()))
        }
    }

    fn skills(&self) -> Vec<SkillManifest> {
        vec![SkillManifest {
            name: format!("{}_twice", self.name),
            description: "Add twice.".into(),
            parameters: vec!["by".into()],
            steps: vec![
                SkillStep {
                    tool: format!("{}_add", self.name),
                    arguments: json!({"by": "{{by}}"}),
                },
                SkillStep {
                    tool: format!("{}_add", self.name),
                    arguments: json!({"by": "{{previous}}"}),
                },
            ],
        }]
    }

    async fn run(&self, bus: AgentBus) -> Result<(), SubsystemError> {
        bus.publish(Event {
            source: self.name.into(),
            kind: "counter/started".into(),
            payload: Value::Null,
        });
        Ok(())
    }
}

#[tokio::test]
async fn routes_calls_and_refuses_collisions() {
    let kernel = Kernel::new();
    kernel
        .register(Counter::new("counter"))
        .await
        .expect("register");
    assert_eq!(
        kernel
            .call("counter_add", json!({"by": 2}))
            .await
            .expect("add"),
        json!(2)
    );
    assert_eq!(
        kernel.call("counter_get", json!({})).await.expect("get"),
        json!({"value": 2})
    );
    assert!(matches!(
        kernel.call("nope", json!({})).await,
        Err(SubsystemError::UnknownTool(_))
    ));
    assert!(matches!(
        kernel.register(Counter::new("counter")).await,
        Err(KernelError::DuplicateSubsystem(_))
    ));
    assert!(kernel.unregister("counter").await);
    assert!(kernel.call("counter_get", json!({})).await.is_err());
}

struct DuplicateTools;

#[async_trait]
impl SystemSubsystem for DuplicateTools {
    fn name(&self) -> &str {
        "duplicate-tools"
    }
    fn description(&self) -> &str {
        "test"
    }
    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new("same_tool", "test", json!({})),
            ToolDefinition::new("same_tool", "test", json!({})),
        ]
    }
    async fn call(&self, _: &str, _: Value) -> Result<Value, SubsystemError> {
        unreachable!("duplicate tools must not be registered")
    }
}

#[tokio::test]
async fn duplicate_tools_in_one_subsystem_are_rejected() {
    let kernel = Kernel::new();
    assert!(matches!(
        kernel.register(Arc::new(DuplicateTools)).await,
        Err(KernelError::DuplicateTool { .. })
    ));
    assert!(kernel.subsystems().await.is_empty());
}

#[tokio::test]
async fn execution_policy_blocks_kernel_dispatch() {
    let mut policy = tempfile::NamedTempFile::new().expect("policy file");
    write!(
        policy,
        "prefix_rule(pattern = [\"counter_add\"], decision = \"forbidden\", match = [[\"counter_add\"]])\n\
         prefix_rule(pattern = [\"counter_get\"], decision = \"allow\", match = [[\"counter_get\"]])"
    )
    .expect("write policy");
    let kernel = Kernel::new()
        .with_execution_policy_file(policy.path())
        .expect("load policy");
    kernel
        .register(Counter::new("counter"))
        .await
        .expect("register");
    assert!(matches!(
        kernel.call("counter_add", json!({"by": 1})).await,
        Err(SubsystemError::Failed(_))
    ));
    assert_eq!(
        kernel
            .call("counter_get", json!({}))
            .await
            .expect("allowed"),
        json!({"value": 0})
    );
}

#[tokio::test]
async fn authenticated_sessions_are_scoped_before_kernel_dispatch() {
    let mut policy = tempfile::NamedTempFile::new().expect("policy file");
    write!(
        policy,
        r#"{{"principals":[{{"id":"reader","token":"test-reader-token","toolPrefixes":["counter_get"],"registerSubsystems":false,"publishEvents":false}}]}}"#
    )
    .expect("write policy");
    let kernel = Kernel::with_authentication_file(policy.path()).expect("load policy");
    kernel
        .register(Counter::new("counter"))
        .await
        .expect("register");
    let (outbound, _incoming) = tokio::sync::mpsc::channel(1);
    let session = Arc::new(crate::rpc::Session::new(outbound));

    let before_initialize = kernel
        .handle(
            json!({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}),
            &session,
        )
        .await
        .expect("response");
    assert_eq!(
        before_initialize.pointer("/error/code"),
        Some(&json!(-32001))
    );

    let rejected = kernel
        .handle(
            json!({"jsonrpc":"2.0","id":2,"method":"initialize","params":{"authToken":"wrong"}}),
            &session,
        )
        .await
        .expect("response");
    assert_eq!(rejected.pointer("/error/code"), Some(&json!(-32001)));

    let initialized = kernel
        .handle(
            json!({"jsonrpc":"2.0","id":3,"method":"initialize","params":{"authToken":"test-reader-token"}}),
            &session,
        )
        .await
        .expect("response");
    assert_eq!(
        initialized.pointer("/result/_meta/aphrody-os/principal"),
        Some(&json!("reader"))
    );

    let listed = kernel
        .handle(
            json!({"jsonrpc":"2.0","id":4,"method":"tools/list","params":{}}),
            &session,
        )
        .await
        .expect("response");
    assert_eq!(
        listed.pointer("/result/tools/0/name"),
        Some(&json!("counter_get"))
    );
    assert!(listed.pointer("/result/tools/1").is_none());

    let forbidden = kernel
        .handle(
            json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"counter_add","arguments":{"by":1}}}),
            &session,
        )
        .await
        .expect("response");
    assert_eq!(forbidden.pointer("/error/code"), Some(&json!(-32003)));

    let allowed = kernel
        .handle(
            json!({"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"counter_get","arguments":{}}}),
            &session,
        )
        .await
        .expect("response");
    assert_eq!(
        allowed.pointer("/result/structuredContent/value"),
        Some(&json!(0))
    );

    let publish = kernel
        .handle(
            json!({"jsonrpc":"2.0","id":7,"method":"system/publish","params":{"kind":"test"}}),
            &session,
        )
        .await
        .expect("response");
    assert_eq!(publish.pointer("/error/code"), Some(&json!(-32003)));
}

#[tokio::test]
async fn timed_out_client_request_is_removed_from_pending() {
    let (client_stream, _server_stream) = tokio::io::duplex(1024);
    let client = Client::from_stream(Box::new(client_stream));
    let result = client
        .request("never", json!({}), Duration::from_millis(1))
        .await;
    assert!(matches!(result, Err(client::ClientError::Timeout { .. })));
    assert!(client.pending_is_empty());
}

#[tokio::test]
async fn skills_chain_steps_and_are_tools() {
    let kernel = Kernel::new();
    kernel
        .register(Counter::new("counter"))
        .await
        .expect("register");
    // step 1: 0 + 3 = 3; step 2: 3 + previous (3) = 6
    let run = kernel
        .call("skill_counter_twice", json!({"by": 3}))
        .await
        .expect("skill");
    assert_eq!(run["result"], json!(6));
    assert_eq!(run["steps"].as_array().map(Vec::len), Some(2));
    assert!(
        kernel.call("skill_counter_twice", json!({})).await.is_err(),
        "missing parameter"
    );
}

#[tokio::test]
async fn sub_agent_runs_on_the_bus() {
    let kernel = Kernel::new();
    let mut events = kernel.bus().subscribe();
    kernel
        .register(Counter::new("counter"))
        .await
        .expect("register");
    let mut kinds = Vec::new();
    for _ in 0..2 {
        kinds.push(
            tokio::time::timeout(Duration::from_secs(5), events.recv())
                .await
                .expect("event")
                .expect("recv")
                .kind,
        );
    }
    assert!(kinds.contains(&"counter/started".to_owned()), "{kinds:?}");
}

#[tokio::test]
async fn persistent_audit_records_bus_events_and_reports_health() {
    let directory = tempfile::tempdir().expect("temporary audit directory");
    let path = directory.path().join("kernel.ndjson");
    let kernel = Kernel::new();
    kernel.start_audit(&path).expect("start audit");
    kernel.bus().publish(Event {
        source: "test".into(),
        kind: "audit/test".into(),
        payload: json!({"value": 7}),
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if tokio::fs::try_exists(&path)
                .await
                .expect("audit path state")
            {
                let text = tokio::fs::read_to_string(&path)
                    .await
                    .expect("audit contents");
                if text.contains("audit/test") {
                    break;
                }
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("audit event persisted");
    let status = kernel.audit_status();
    assert_eq!(status["enabled"], true);
    assert_eq!(status["lagged_events"], 0);
    assert_eq!(status["write_failures"], 0);
}

/// A kernel served over an in-memory stream, with a connected client.
fn connected(kernel: &Kernel) -> Client {
    let (client_side, server_side) = tokio::io::duplex(1 << 20);
    let (reader, writer) = tokio::io::split(server_side);
    tokio::spawn(serve_connection(kernel.clone(), reader, writer));
    Client::from_stream(Box::new(client_side))
}

#[tokio::test]
async fn mcp_surface_over_a_connection() {
    let kernel = Kernel::new();
    kernel
        .register(Counter::new("counter"))
        .await
        .expect("register");
    let client = connected(&kernel);
    let init = client.initialize("test").await.expect("initialize");
    assert_eq!(init["serverInfo"]["name"], "aphrody-os");
    let audit = client
        .request("system/audit_status", json!({}), Duration::from_secs(5))
        .await
        .expect("audit status");
    assert_eq!(audit["enabled"], false);
    let tools = client
        .request("tools/list", json!({}), Duration::from_secs(5))
        .await
        .expect("list");
    let names: Vec<&str> = tools["tools"]
        .as_array()
        .expect("tools")
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();
    assert_eq!(names, ["counter_add", "counter_get", "skill_counter_twice"]);
    let owned = client
        .request(
            "system/subsystem_tools",
            json!({"name": "counter"}),
            Duration::from_secs(5),
        )
        .await
        .expect("subsystem tools");
    let owned_names: Vec<&str> = owned["tools"]
        .as_array()
        .expect("owned tools")
        .iter()
        .filter_map(|tool| tool["name"].as_str())
        .collect();
    assert_eq!(owned["subsystem"], "counter");
    assert_eq!(owned_names, ["counter_add", "counter_get"]);
    let call = client
        .request(
            "tools/call",
            json!({"name": "counter_add", "arguments": {"by": 5}}),
            Duration::from_secs(5),
        )
        .await
        .expect("call");
    assert_eq!(call["isError"], false);
    assert_eq!(call["structuredContent"], json!({"result": 5}));
    let failed = client
        .request(
            "tools/call",
            json!({"name": "counter_add", "arguments": {}}),
            Duration::from_secs(5),
        )
        .await
        .expect("tool error is a result");
    assert_eq!(failed["isError"], true);
    let unknown = client
        .request(
            "tools/call",
            json!({"name": "nope"}),
            Duration::from_secs(5),
        )
        .await;
    assert!(matches!(
        unknown,
        Err(crate::client::ClientError::Rpc { code: -32602, .. })
    ));
}

#[tokio::test]
async fn a2a_envelope_uses_the_same_tool_dispatcher() {
    let kernel = Kernel::new();
    kernel
        .register(Counter::new("counter"))
        .await
        .expect("register");
    let client = connected(&kernel);
    client.initialize("a2a-test").await.expect("initialize");
    let response = client
        .request(
            "a2a/message/send",
            json!({
                "sourceAgent": "test-agent",
                "target": "kernel",
                "tool": "counter_add",
                "arguments": {"by": 7}
            }),
            Duration::from_secs(5),
        )
        .await
        .expect("A2A envelope");
    assert_eq!(response["accepted"], true);
    assert_eq!(
        response["result"]["structuredContent"],
        json!({"result": 7})
    );
}

#[tokio::test]
async fn a2a_target_selects_the_owner_and_rejects_misdirected_side_effects() {
    let kernel = Kernel::new();
    let counter = Counter::new("counter");
    kernel.register(counter.clone()).await.unwrap();
    let client = connected(&kernel);
    client.initialize("target-test").await.unwrap();
    for target in [json!("claude"), json!(42), Value::Null, json!("")] {
        let wrong = client
            .request(
                "a2a/message/send",
                json!({
                    "target": target, "tool": "counter_add", "arguments": {"by": 9}
                }),
                Duration::from_secs(5),
            )
            .await;
        assert!(matches!(
            wrong,
            Err(crate::client::ClientError::Rpc { code: -32602, .. })
        ));
    }
    assert_eq!(counter.value.load(Ordering::SeqCst), 0);
    let right = client
        .request(
            "a2a/message/send",
            json!({
                "target": "counter", "tool": "counter_add", "arguments": {"by": 7}
            }),
            Duration::from_secs(5),
        )
        .await
        .unwrap();
    assert_eq!(right["target"], "counter");
    assert_eq!(right["result"]["structuredContent"], json!({"result": 7}));
    assert_eq!(counter.value.load(Ordering::SeqCst), 7);
}

#[tokio::test]
async fn a_peer_registers_a_subsystem_and_serves_its_calls() {
    let kernel = Kernel::new();
    let mut peer = connected(&kernel);
    peer.initialize("bun_scraper").await.expect("initialize");
    peer.request(
        "system/register_subsystem",
        json!({"name": "bun_scraper", "runtime": "bun", "tools": [
            {"name": "fetch_dynamic_page", "description": "Fetch.", "input_schema": {"type": "object"}}
        ]}),
        Duration::from_secs(5),
    )
    .await
    .expect("register");
    // The peer answers the kernel's tools/call like a Bun process would.
    let mut incoming =
        std::mem::replace(&mut peer.incoming, tokio::sync::mpsc::unbounded_channel().1);
    let peer = Arc::new(peer);
    let answering = Arc::clone(&peer);
    tokio::spawn(async move {
        while let Some(message) = incoming.recv().await {
            if message["method"] == "tools/call" {
                let url = message["params"]["arguments"]["url"]
                    .as_str()
                    .unwrap_or_default()
                    .to_owned();
                let _ = answering.respond(
                    message["id"].clone(),
                    json!({"content": [{"type": "text", "text": "ok"}], "structuredContent": {"url": url, "status": 200}}),
                );
            }
        }
    });
    let result = kernel
        .call("fetch_dynamic_page", json!({"url": "https://example.com"}))
        .await
        .expect("remote call");
    assert_eq!(result, json!({"url": "https://example.com", "status": 200}));
    let client = connected(&kernel);
    client.initialize("a2a-remote-client").await.unwrap();
    let routed = client
        .request(
            "a2a/message/send",
            json!({
                "target": "bun_scraper", "tool": "fetch_dynamic_page",
                "arguments": {"url": "https://example.org"}
            }),
            Duration::from_secs(5),
        )
        .await
        .unwrap();
    assert_eq!(
        routed["result"]["structuredContent"],
        json!({"url": "https://example.org", "status": 200})
    );
    assert_eq!(kernel.subsystems().await[0]["remote"], true);
    drop(peer);
}

#[tokio::test]
async fn host_remote_joins_a_kernel_and_leaves_on_disconnect() {
    let kernel = Kernel::new();
    let endpoint = format!(
        "{}-test-{}",
        crate::transport::default_endpoint(),
        std::process::id()
    );
    let server = tokio::spawn(crate::transport::serve_endpoint(
        kernel.clone(),
        endpoint.clone(),
    ));
    // The listener is up once a client can connect.
    for _ in 0..100 {
        if crate::transport::connect(&endpoint).await.is_ok() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let host = tokio::spawn({
        let endpoint = endpoint.clone();
        async move { crate::client::host_remote(Counter::new("remote"), &endpoint).await }
    });
    let mut registered = false;
    for _ in 0..200 {
        if kernel.call("remote_add", json!({"by": 4})).await.is_ok() {
            registered = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(registered, "remote subsystem never registered");
    assert_eq!(
        kernel.call("remote_get", json!({})).await.expect("get"),
        json!({"value": 4})
    );
    host.abort();
    let _ = host.await;
    for _ in 0..200 {
        if kernel.subsystems().await.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(
        kernel.subsystems().await.is_empty(),
        "disconnect must unregister"
    );
    server.abort();
}

struct ReservedToolSubsystem;

#[async_trait]
impl SystemSubsystem for ReservedToolSubsystem {
    fn name(&self) -> &str {
        "reserved-tool"
    }
    fn description(&self) -> &str {
        "Reserved tool test."
    }
    fn tools(&self) -> Vec<ToolDefinition> {
        vec![ToolDefinition::new("skill_reserved", "Invalid", json!({}))]
    }
    async fn call(&self, _: &str, _: Value) -> Result<Value, SubsystemError> {
        Ok(Value::Null)
    }
}

#[tokio::test]
async fn tool_starting_with_skill_prefix_is_rejected() {
    let kernel = Kernel::new();
    let res = kernel.register(Arc::new(ReservedToolSubsystem)).await;
    assert!(matches!(res, Err(KernelError::ReservedName(_))));
}

struct DuplicateSkillSubsystem;

#[async_trait]
impl SystemSubsystem for DuplicateSkillSubsystem {
    fn name(&self) -> &str {
        "dup-skill"
    }
    fn description(&self) -> &str {
        "Duplicate skill test."
    }
    fn tools(&self) -> Vec<ToolDefinition> {
        vec![ToolDefinition::new("noop", "noop", json!({}))]
    }
    fn skills(&self) -> Vec<SkillManifest> {
        vec![
            SkillManifest {
                name: "dup".into(),
                description: "d1".into(),
                parameters: vec![],
                steps: vec![],
            },
            SkillManifest {
                name: "dup".into(),
                description: "d2".into(),
                parameters: vec![],
                steps: vec![],
            },
        ]
    }
    async fn call(&self, _: &str, _: Value) -> Result<Value, SubsystemError> {
        Ok(Value::Null)
    }
}

#[tokio::test]
async fn duplicate_skills_in_one_subsystem_rejected() {
    let kernel = Kernel::new();
    let res = kernel.register(Arc::new(DuplicateSkillSubsystem)).await;
    assert!(matches!(res, Err(KernelError::DuplicateSkill { .. })));
}

struct SingleSkillSubsystem(&'static str);

#[async_trait]
impl SystemSubsystem for SingleSkillSubsystem {
    fn name(&self) -> &str {
        self.0
    }
    fn description(&self) -> &str {
        "Single skill test."
    }
    fn tools(&self) -> Vec<ToolDefinition> {
        vec![ToolDefinition::new(
            format!("{}_tool", self.0),
            "tool",
            json!({}),
        )]
    }
    fn skills(&self) -> Vec<SkillManifest> {
        vec![SkillManifest {
            name: "shared_skill".into(),
            description: "shared".into(),
            parameters: vec![],
            steps: vec![],
        }]
    }
    async fn call(&self, _: &str, _: Value) -> Result<Value, SubsystemError> {
        Ok(Value::Null)
    }
}

#[tokio::test]
async fn duplicate_skills_across_subsystems_rejected() {
    let kernel = Kernel::new();
    kernel
        .register(Arc::new(SingleSkillSubsystem("first")))
        .await
        .expect("first");
    let res = kernel
        .register(Arc::new(SingleSkillSubsystem("second")))
        .await;
    assert!(matches!(res, Err(KernelError::DuplicateSkill { .. })));
}

struct NestedSkillSubsystem;

#[async_trait]
impl SystemSubsystem for NestedSkillSubsystem {
    fn name(&self) -> &str {
        "nested-skill"
    }
    fn description(&self) -> &str {
        "Nested skill test."
    }
    fn tools(&self) -> Vec<ToolDefinition> {
        vec![ToolDefinition::new("nested_tool", "tool", json!({}))]
    }
    fn skills(&self) -> Vec<SkillManifest> {
        vec![SkillManifest {
            name: "illegal_nesting".into(),
            description: "calls another skill".into(),
            parameters: vec![],
            steps: vec![SkillStep {
                tool: "skill_other".into(),
                arguments: json!({}),
            }],
        }]
    }
    async fn call(&self, _: &str, _: Value) -> Result<Value, SubsystemError> {
        Ok(Value::Null)
    }
}

#[tokio::test]
async fn nested_skill_calls_are_rejected() {
    let kernel = Kernel::new();
    kernel
        .register(Arc::new(NestedSkillSubsystem))
        .await
        .expect("register");
    let err = kernel.call("skill_illegal_nesting", json!({})).await;
    assert!(matches!(err, Err(SubsystemError::InvalidArguments(_))));
}

struct FailingStepSubsystem;

#[async_trait]
impl SystemSubsystem for FailingStepSubsystem {
    fn name(&self) -> &str {
        "failing-sub"
    }
    fn description(&self) -> &str {
        "Failing step test."
    }
    fn tools(&self) -> Vec<ToolDefinition> {
        vec![ToolDefinition::new("explode", "explode", json!({}))]
    }
    fn skills(&self) -> Vec<SkillManifest> {
        vec![SkillManifest {
            name: "fail_skill".into(),
            description: "fails on explode".into(),
            parameters: vec![],
            steps: vec![SkillStep {
                tool: "explode".into(),
                arguments: json!({}),
            }],
        }]
    }
    async fn call(&self, tool: &str, _: Value) -> Result<Value, SubsystemError> {
        if tool == "explode" {
            Err(SubsystemError::Failed("boom".into()))
        } else {
            Ok(Value::Null)
        }
    }
}

#[tokio::test]
async fn skill_reports_failing_step() {
    let kernel = Kernel::new();
    kernel
        .register(Arc::new(FailingStepSubsystem))
        .await
        .expect("register");
    let err = kernel.call("skill_fail_skill", json!({})).await;
    assert!(matches!(err, Err(SubsystemError::Failed(msg)) if msg.contains("boom")));
}

#[tokio::test]
async fn skill_invalid_argument_types_rejected() {
    let kernel = Kernel::new();
    kernel
        .register(Counter::new("counter"))
        .await
        .expect("register");
    let err = kernel.call("skill_counter_twice", json!(42)).await;
    assert!(matches!(err, Err(SubsystemError::InvalidArguments(_))));
    let err2 = kernel.call("skill_non_existent", json!({})).await;
    assert!(matches!(err2, Err(SubsystemError::UnknownTool(_))));
}

#[tokio::test]
async fn rpc_ping_and_unknown_method_handling() {
    let kernel = Kernel::new();
    let client = connected(&kernel);
    client.initialize("test").await.expect("initialize");

    let ping = client
        .request("ping", json!({}), Duration::from_secs(5))
        .await
        .expect("ping");
    assert_eq!(ping, json!({}));

    let unknown = client
        .request("nonexistent/method", json!({}), Duration::from_secs(5))
        .await;
    assert!(matches!(
        unknown,
        Err(crate::client::ClientError::Rpc { code: -32601, .. })
    ));
}

#[tokio::test]
async fn rpc_skills_list_and_run() {
    let kernel = Kernel::new();
    kernel
        .register(Counter::new("counter"))
        .await
        .expect("register");
    let client = connected(&kernel);
    client.initialize("test").await.expect("initialize");

    let skills = client
        .request("skills/list", json!({}), Duration::from_secs(5))
        .await
        .expect("skills/list");
    let arr = skills["skills"].as_array().expect("array");
    assert_eq!(arr.len(), 1);
    assert_eq!(arr[0]["name"], "counter_twice");
    assert_eq!(arr[0]["subsystem"], "counter");

    let run_res = client
        .request(
            "skills/run",
            json!({"name": "counter_twice", "params": {"by": 10}}),
            Duration::from_secs(5),
        )
        .await
        .expect("skills/run");
    assert_eq!(run_res["result"], json!(20));

    let run_err = client
        .request(
            "skills/run",
            json!({"name": "unknown_skill", "params": {}}),
            Duration::from_secs(5),
        )
        .await;
    assert!(matches!(
        run_err,
        Err(crate::client::ClientError::Rpc { code: -32000, .. })
    ));
}

#[tokio::test]
async fn rpc_system_subsystems_and_subsystem_tools_unknown() {
    let kernel = Kernel::new();
    kernel
        .register(Counter::new("counter"))
        .await
        .expect("register");
    let client = connected(&kernel);
    client.initialize("test").await.expect("initialize");

    let list = client
        .request("system/subsystems", json!({}), Duration::from_secs(5))
        .await
        .expect("subsystems");
    let subs = list["subsystems"].as_array().expect("subsystems array");
    assert_eq!(subs.len(), 1);
    assert_eq!(subs[0]["name"], "counter");
    assert_eq!(subs[0]["tools"], 2);
    assert_eq!(subs[0]["skills"], 1);
    assert_eq!(subs[0]["remote"], false);

    let err = client
        .request(
            "system/subsystem_tools",
            json!({"name": "ghost"}),
            Duration::from_secs(5),
        )
        .await;
    assert!(matches!(
        err,
        Err(crate::client::ClientError::Rpc { code: -32602, .. })
    ));
}

#[tokio::test]
async fn rpc_subscribe_and_publish_with_filtering() {
    let kernel = Kernel::new();
    let client = connected(&kernel);
    client.initialize("test").await.expect("initialize");

    let sub = client
        .request(
            "system/subscribe",
            json!({"kinds": ["custom/"]}),
            Duration::from_secs(5),
        )
        .await
        .expect("subscribe");
    assert_eq!(sub["subscribed"], true);

    let pub_res = client
        .request(
            "system/publish",
            json!({"kind": "custom/test", "payload": {"foo": "bar"}}),
            Duration::from_secs(5),
        )
        .await
        .expect("publish");
    assert_eq!(pub_res["delivered"], 1);

    let mut client = client;
    let notif = tokio::time::timeout(Duration::from_secs(5), client.incoming.recv())
        .await
        .expect("timeout")
        .expect("notif");
    assert_eq!(notif["method"], "system/event");
    assert_eq!(notif["params"]["kind"], "custom/test");
    assert_eq!(notif["params"]["payload"]["foo"], "bar");
}

#[tokio::test]
async fn transport_malformed_json_returns_parse_error() {
    let kernel = Kernel::new();
    let (client_side, server_side) = tokio::io::duplex(1024);
    let (reader, writer) = tokio::io::split(server_side);
    tokio::spawn(serve_connection(kernel, reader, writer));

    let (mut client_reader, mut client_writer) = tokio::io::split(client_side);
    tokio::io::AsyncWriteExt::write_all(&mut client_writer, b"{bad json\n")
        .await
        .expect("write");

    let mut lines = tokio::io::BufReader::new(&mut client_reader).lines();
    let response = tokio::time::timeout(Duration::from_secs(5), lines.next_line())
        .await
        .expect("timeout")
        .expect("read")
        .expect("line");
    let val: serde_json::Value = serde_json::from_str(&response).expect("parse json");
    assert_eq!(val["error"]["code"], -32700);
}

#[tokio::test]
async fn transport_rejects_line_before_exceeding_limit() {
    let mut reader = tokio::io::BufReader::new(&b"123456789\n"[..]);
    let error = crate::transport::read_line_limited(&mut reader, 8)
        .await
        .unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
}

#[tokio::test]
async fn transport_default_endpoint_env_override() {
    unsafe {
        std::env::set_var("APHRODY_OS_SOCKET", "/custom/socket.path");
    }
    assert_eq!(crate::transport::default_endpoint(), "/custom/socket.path");
    unsafe {
        std::env::remove_var("APHRODY_OS_SOCKET");
    }
}

#[tokio::test]
async fn remote_subsystem_validation_and_parsing() {
    let (outbound, _) = tokio::sync::mpsc::channel(8);
    let session = Session::new(outbound);

    let bad1 = crate::remote::RemoteSubsystem::from_params(&json!({"tools": []}), &session);
    assert!(bad1.is_err());

    let bad2 = crate::remote::RemoteSubsystem::from_params(
        &json!({"name": "valid", "tools": "not-array"}),
        &session,
    );
    assert!(bad2.is_err());

    let bad3 = crate::remote::RemoteSubsystem::from_params(
        &json!({"name": "valid", "tools": [{}]}),
        &session,
    );
    assert!(bad3.is_err());

    let good = crate::remote::RemoteSubsystem::from_params(
        &json!({
            "name": "agent_test",
            "runtime": "python",
            "tools": [{"name": "compute", "description": "calc"}],
            "skills": [{
                "name": "calc_twice",
                "description": "twice",
                "parameters": ["x"],
                "steps": [{"tool": "compute", "arguments": {}}]
            }]
        }),
        &session,
    );
    assert!(good.is_ok());
    let sub = good.expect("valid remote");
    assert_eq!(sub.name(), "agent_test");
    assert_eq!(sub.tool_count(), 1);
    assert_eq!(sub.skills().len(), 1);
}
