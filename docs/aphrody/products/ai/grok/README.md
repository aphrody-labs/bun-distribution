<!-- SPDX-License-Identifier: Apache-2.0 -->
# xAI Grok on the VPS

**Not** Twitter/X — that platform lives under [`../x/README.md`](../../web/x/README.md) (`@aphrody-code/x`, `aphrody-x`, `bxc x`).

This tree documents **xAI** (Grok API + Grok Build CLI) as used with Aphrody.

## Documentation map

| Doc | Contents |
| --- | --- |
| [api-endpoints.md](../../../apis/ai/grok/api-endpoints.md) | OpenAI-compatible `https://api.x.ai/v1` routes |
| [models.md](../../../reference/ai/grok/models.md) | Model ids from RAGFlow vendor config + Grok CLI |
| [bxc-and-grok.md](../../../reference/ai/grok/bxc-and-grok.md) | What bxc does *not* cover; MCP layout on VPS |
| [env-and-auth.md](../../../reference/ai/grok/env-and-auth.md) | `XAI_API_KEY`, `~/.grok/auth.json`, diagnostic local et smoke optionnel |
| [test-checklist.md](../../../reference/ai/grok/test-checklist.md) | Smoke tests (API + CLI + MCP) |

## Auth priority (aphrody policy)

1. **Grok CLI session** — `~/.grok/auth.json` (`grok login`) — preferred for Grok Build and **`bxc grok`** (no developer key)
2. **`XAI_API_KEY`** — OpenAI-compatible REST (`api.x.ai`) — metered fallback; set in `~/.bash_secrets`
3. **Antigravity / agy OAuth** — Gemini/Code Assist, not xAI — see `docs/agy-cli/` (not in repo)

## Quick verify

```bash
source ~/.bashrc
# Smoke local — GET `/models` non génératif ; chat désactivé par défaut
bash ~/aphrody/scripts/test-xai-grok-bxc.sh
# Opt-in explicite, potentiellement facturable :
RUN_PAID_XAI_SMOKE=1 bash ~/aphrody/scripts/test-xai-grok-bxc.sh
# Checklist complémentaire à lire : docs/grok/test-checklist.md
```
