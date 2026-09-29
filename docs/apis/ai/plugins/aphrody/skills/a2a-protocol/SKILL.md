---
name: a2a-protocol
description: Standard Agent-to-Agent (A2A 1.0) protocol and .coord envelope routing for autonomous agents (Codex, agycli, Claude, local models, RAG, subagents).
version: 1.0.0
---

# Protocole Standard Agent2Agent (A2A 1.0) & Coordination .coord

Ce guide régit la communication inter-agents souveraine sous doctrine **YOLO permanent** (`/goal`).

## 1. Topologie des Pairs & Hubs

| Pair | Rôle | Transport / CLI | Endpoint |
|---|---|---|---|
| **`shenron`** | Hub Canonique Dragon Ball & RAG | HTTP JSON-RPC 2.0 / .coord | `https://mcp.dragonballfr.com/a2a` |
| **`codex`** | Implémentation logicielle autonome | CLI `codex` / MCP Streamable | Local & VPS |
| **`agycli`** | Orchestration système & Gemini Flash | CLI `agy` | Local & VPS |
| **`claude`** | Architecture & Revue canonique | CLI `claude` | Local & VPS |
| **`ocr`** | Pipeline OCR continu | CUDA RTX 4070 / Tesseract VPS | Internal Worker |
| **`rag`** | Recherche vectorielle manga/databooks | Internal API | Internal Service |

## 2. Format des Enveloppes `.coord` (ai.json v1)

Chaque message échangé sur le canal fichier (JSONL) ou HTTP `/a2a` respecte le schéma :

```json
{
  "v": 1,
  "ts": "2026-09-14T12:00:00Z",
  "id": "env-unique-id",
  "from": "codex",
  "to": "shenron",
  "kind": "ask",
  "topic": "Titre explicite de l'ordre",
  "body": "Contenu complet en Markdown ou JSON structuré",
  "re": "env-parent-id-optionnel",
  "channel_hint": ["file_jsonl", "http_jsonrpc"]
}
```

### Typologie des Kinds :
- `ask` : Requête ou ordre technique transmis à un pair.
- `fact` : Compte-rendu, résultat validé ou information factuelle.
- `ack` : Accusé de réception ou confirmation de prise en charge.
- `ping` : Sonde de vitalité et battement de cœur heartbeat.
- `error` : Signalement d'échec ou de bloqueur technique identifié.

## 3. Requêtes JSON-RPC 2.0 (Endpoint `/a2a`)

Exemple d'émission d'ordre autonome :

```json
{
  "jsonrpc": "2.0",
  "id": "req-1789400000",
  "method": "message/send",
  "params": {
    "target": "ocr",
    "sourceAgent": "codex",
    "instruction": "Transcris les planches manquantes du volume #426",
    "yolo": true
  }
}
```

## 3bis. Contrats Rust & Agent Card

- Types et JSON Schemas canoniques : crate `aphrody-contracts/crates/aphrody-a2a`, module `coord`
  (`CoordEnvelope`, `EnvelopeKind`, `ChannelHint`, `FleetSendParams`, `PEERS`, `envelope_schema()`,
  `jsonrpc_request_schema()`, `jsonrpc_response_schema()`, `agent_card_schema()`).
- Agent Card A2A 1.0 publiée à `/.well-known/agent-card.json` (`AGENT_CARD_WELL_KNOWN_PATH`), type `AgentCard`.
- `message/send` (params `target`/`sourceAgent`/`instruction`/`yolo`) est la méthode flotte ; les méthodes
  A2A 1.0 standard (`SendMessage`, `GetTask`, ...) sont dans `aphrody_a2a::methods`.
- Endpoints et hôtes : lus depuis le catalogue `aphrody-infra`, jamais codés en dur.

## 4. Règles Opératoires YOLO No-HITL
1. **Zéro confirmation humaine** : Trancher immédiatement sur toute décision réversible.
2. **Format bimodal** : Fournir systématiquement la structure machine (JSON) et la lisibilité humaine (Markdown).
3. **Synchronisation Discord** : Toutes les alertes critiques et fins de tâches sont acheminées automatiquement dans le salon `#bot-admin` (`1548677623935139901`).
4. **Honest Delivery** : Classer chaque résultat de façon vérifiable en `FAIT`, `INCOMPLET` ou `NON_FAIT`.
