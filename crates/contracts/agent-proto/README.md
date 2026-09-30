<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-agent-proto

The agent Submission/Event protocol of Aphrody and its newline-delimited JSON (NDJSON) wire codec.
Every Aphrody surface (CLI, TUI, desktop, MCP) talks to the agent engine through it.

The shape follows the Submission Queue / Event Queue pattern of the OpenAI Codex protocol
(Apache-2.0):

- a client sends `Submission { id, op }` records carrying an `Op` (user input, exec and patch
  approvals, interrupt, steer, compact, shutdown) to the agent;
- the agent answers with `Event { id, msg }` records carrying an `EventMsg` (turn lifecycle,
  message and reasoning deltas, command execution, approval requests, tool calls, token counts,
  errors).

Decoding tolerates unknown fields so newer agents can add data without breaking older clients.

## Install

```toml
[dependencies]
aphrody-agent-proto = "1.0.0-canary"
```

## Example

```rust
use aphrody_agent_proto::{
    Event, EventMsg, InputItem, Op, Submission, decode_events, decode_submission,
    encode_event, encode_submission,
};

let submission = Submission::new(Op::UserInput {
    items: vec![InputItem::Text { text: "hello".into() }],
});
let line = encode_submission(&submission)?; // one line, no embedded newline
assert_eq!(decode_submission(&line)?, submission);

let stream = format!(
    "{}\n\n{}\n",
    encode_event(&Event::new(EventMsg::TurnStarted))?,
    encode_event(&Event::new(EventMsg::AgentMessageDelta { delta: "hi".into() }))?,
);
assert_eq!(decode_events(&stream).count(), 2); // blank lines are skipped
# Ok::<(), aphrody_agent_proto::ProtoError>(())
```

## Platform support

The crate is pure (no platform syscalls) and builds for `wasm32-unknown-unknown`; on that target
the v4-shaped ids are generated without the `uuid` crate.

## License

Apache-2.0.
