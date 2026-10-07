# llama-server models on the vps

Loopback-only OpenAI-compatible servers driven by upstream llama.cpp b11415 (`~/.aphrody/runtimes/llama-b11415`), one unit per model, declared in `tools/config/host/systemd/aphrody/` and `tools/config/service-catalog.json`.

| Unit | Port | Alias | Model |
| --- | --- | --- | --- |
| `aphrody-llama-gemma4` | 8798 | `gemma4-e2b` | Gemma 4 E2B IT Q4_K_M (fallback) |
| `aphrody-llama-shenron-chat` | 8799 | `shenron-chat-v2` | Qwen3-4B-Instruct-2507 Q4_K_M + LoRA GGUF adapter |

8789 is held by an sshd tunnel; do not use it.

## shenron-chat-v2 adapter

Adapter path: `/home/ubuntu/.aphrody/models/adapters/shenron-chat-v2/adapter.gguf` (read-only for the unit). Source: `runs/shenron-chat-v2/adapter.gguf` of `/srv/shenron/shared/private-downloads/shenron-train-chat-v2.tar.gz` (never modified); verify against the tarball's `SHA256SUMS` (`aab485357c68fdcbb6d4ba55911632b8228964106047db035e0223e2aecc6107`).

```sh
mkdir -p ~/.aphrody/models/adapters/shenron-chat-v2 && cd ~/.aphrody/models/adapters/shenron-chat-v2
tar xzf /srv/shenron/shared/private-downloads/shenron-train-chat-v2.tar.gz --strip-components=3 shenron-train-chat-v2/runs/shenron-chat-v2/adapter.gguf
sha256sum adapter.gguf
```

Install: `bun packages/engine/core/src/host/cli.ts compose-unit aphrody-llama-shenron-chat.service`, copy to `/etc/systemd/system`, `daemon-reload`, `enable --now`.

## Consumers (Shenron)

```
APHRODY_AI_CHAT_BASE_URL=http://127.0.0.1:8799/v1
APHRODY_AI_CHAT_MODEL=shenron-chat-v2
```

Fallback: `http://127.0.0.1:8798/v1` with `gemma4-e2b`.
