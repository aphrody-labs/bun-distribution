<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-subsystem

The contract every Aphrody OS subsystem (shell, browser, window manager, a Bun or uv process, ...)
implements to plug into the agent fabric. A subsystem contributes:

1. **Tools**: MCP tool definitions (`ToolDefinition`) the kernel publishes and routes to
   `SystemSubsystem::call`.
2. **Skills**: named, parameterised sequences of tool calls (`SkillManifest`, `SkillStep`) whose
   string arguments may use `{{param}}` and `{{previous}}` placeholders.
3. **A sub-agent**: `SystemSubsystem::run`, a background routine that reacts to and publishes
   `Event`s on the shared `AgentBus` (a `tokio` broadcast channel).

Tool names are global: the kernel refuses a subsystem whose tool name is already taken, so each
subsystem prefixes its tools (`nu_eval`, `browser_navigate`, `window_focus`).

## Install

```toml
[dependencies]
aphrody-subsystem = "1.0.0-canary"
async-trait = "0.1"
serde_json = "1"
```

## Example

```rust
use aphrody_subsystem::{SubsystemError, SystemSubsystem, ToolDefinition};
use async_trait::async_trait;
use serde_json::{Value, json};

struct Clock;

#[async_trait]
impl SystemSubsystem for Clock {
    fn name(&self) -> &str {
        "clock"
    }

    fn description(&self) -> &str {
        "Reads the system clock."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "clock_now",
                "Seconds since the Unix epoch.",
                json!({ "type": "object", "properties": {} }),
            )
            .read_only(),
        ]
    }

    async fn call(&self, tool: &str, _arguments: Value) -> Result<Value, SubsystemError> {
        match tool {
            "clock_now" => {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|e| SubsystemError::Failed(e.to_string()))?;
                Ok(json!({ "seconds": now.as_secs() }))
            }
            other => Err(SubsystemError::UnknownTool(other.to_owned())),
        }
    }
}
```

## License

Apache-2.0.
