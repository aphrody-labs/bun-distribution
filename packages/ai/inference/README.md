<!-- SPDX-License-Identifier: Apache-2.0 -->

# Native inference for Bun

`NativeInference` loads the `aphrody_ffi` library (cargo feature `inference` of `aphrody-ffi`) and uses
Aphrody's existing `InProcessLlama` owner. Loading and generation run on native
workers while Bun polls asynchronous jobs; Discord's event loop remains free.
The bridge starts no model server or CLI process and performs no implicit model
download. One resident model is allowed per library, with a bounded request queue.

Build and qualify `crates/interop/ffi` with `--features inference` through the repository's serialized
factory. Install `libaphrody_ffi` in the protected Aphrody `lib` store, or set the
absolute `APHRODY_INFERENCE_LIBRARY` path. Its existing llama runtime dependencies
must also be installed through their owner. Source presence does not establish
an installed, compatible runtime.

```ts
import { NativeInference } from "@aphrody/inference";

await using engine = await NativeInference.open({
  model: "gemma-4-e2b-it-q4km",
  profile: "dbfr",
});
const result = await engine.chat({
  messages: [{ role: "user", content: "Bonjour." }],
  maxTokens: 128,
  signal: AbortSignal.timeout(60_000),
});
```

The model must already exist in the protected model store. Each turn reloads the
selected profile's canonical Agent Home and requires its SOUL. Profiles never
inherit another domain through `APHRODY_WORKSPACE`. A compatible, existing GGUF
LoRA may be provided with `lora`; SOUL prompting is not weight fine-tuning.

Native failure does not silently select an HTTP provider: a consumer that wants a
remote fallback chooses it explicitly (the Shenron bot documents its own variables).

Run the actual model gate only with an installed qualified library and model:
`APHRODY_NATIVE_INFERENCE_TEST=1 bun test test/native.integration.test.ts`.
It checks live output, native token accounting, Bun event-loop progress and the
absence of a child model process, without printing protected prompts or answers.
