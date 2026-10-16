# @aphrody/ag-ui

One import for the AG-UI protocol in Aphrody surfaces: the `@ag-ui/core` event schema, the
`@ag-ui/encoder` SSE/Protobuf `EventEncoder`, the Protobuf codec (`encodeProto`, `decodeProto`,
`AGUI_MEDIA_TYPE`), the agent client runtime (`@ag-ui/client`, served by the Aphrody build
`@aphrody/ag-ui-client`) and the A2UI declarative toolkit (`@ag-ui/a2ui-toolkit`).

```ts
import { EventEncoder, EventType, decodeProto } from "@aphrody/ag-ui";

const encoder = new EventEncoder();
const frame = encoder.encodeSSE({
  type: EventType.RUN_STARTED,
  threadId: "t",
  runId: "r",
});
```

- Source: `src/index.ts` (re-exports only; no protocol code is copied).
- Versions: the root catalog pins `@ag-ui/*` 1.0.1; the client is `npm:@aphrody/ag-ui-client`.
- `_resetWarnedCountKeys` (token-usage warning reset used by tests) comes from the
  `@ag-ui/core@1.0.1` patch in `patches/ag-ui-core-1.0.1.patch`.
- Tests: `bun test` replays the cross-language wire fixtures (`fixtures/null-omission.json`) through
  SSE and Protobuf. Typecheck: `bun run typecheck`.
