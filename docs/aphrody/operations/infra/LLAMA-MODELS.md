# llama-server models

Since 2026-10-09 the only llama-server in production is the Compose service `chat` of the Shenron stack on DBFR (container `shenron-chat-1`, llama.cpp b11415, OpenAI-compatible `/v1` on `127.0.0.1:8799`, never proxied by nginx). The native VPS units `aphrody-llama-gemma4` and `aphrody-llama-shenron-chat` were removed; the stack is assembled by `scripts/release/assemble-shenron-docker-release.py` (see `SHENRON-DOCKER.md`).

| Alias | Model | sha256 |
| --- | --- | --- |
| `shenron-chat-v2` | Qwen3-4B-Instruct-2507 + shenron-chat-v2 LoRA, merged then Q4_K_M (imatrix unsloth) | `22362d5729eab45a4f2238246e6b5a448d26c01b5a541671e730415ec0d731b4` |

File: `/home/ubuntu/apps/shenron/shared/models/shenron-chat-v2/shenron-chat-v2-merged-Q4_K_M.gguf`, mounted read-only on `/models/model.gguf`. Options: `--cache-ram 256 -fa on -ctk q8_0 -ctv q8_0 --no-repack`, ctx 8192, parallel 1, threads 4, `mem_limit 5g`.

## Rebuilding the merged model

Adapter source: `runs/shenron-chat-v2/adapter.gguf` of `/home/ubuntu/apps/shenron/shared/private-downloads/shenron-train-chat-v2.tar.gz` (sha256 `aab485357c68fdcbb6d4ba55911632b8228964106047db035e0223e2aecc6107`, kept beside the model as `adapter.gguf`).

```sh
llama-export-lora -m Qwen3-4B-Instruct-2507-F16.gguf --lora adapter.gguf -o merged-F16.gguf
llama-quantize --imatrix imatrix_unsloth.gguf merged-F16.gguf shenron-chat-v2-merged-Q4_K_M.gguf Q4_K_M
```

Rollback: download the base `hf:unsloth/Qwen3-4B-Instruct-2507-GGUF/Qwen3-4B-Instruct-2507-Q4_K_M.gguf@a06e946bb6b655725eafa393f4a9745d460374c9` (sha256 `3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597`), serve it with `--lora adapter.gguf`, and run the assembler with `--adapter-path`.

## Consumers (Shenron)

```
APHRODY_AI_CHAT_BASE_URL=http://127.0.0.1:8799/v1
APHRODY_AI_CHAT_MODEL=shenron-chat-v2
```
