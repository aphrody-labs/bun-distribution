---
name: a2a-protocol
description: "Protocole Agent-to-Agent (A2A 1.0) et enveloppes .coord entre agents (Codex, agy, Claude, Shenron, OCR, RAG) : pairs, format JSONL, JSON-RPC message/send. Utiliser pour déléguer une tâche à un pair ou lire/écrire la boîte .coord."
version: 1.1.0
---

# Protocole Standard Agent2Agent (A2A 1.0) & Coordination .coord

> **S'applique quand :** le monorepo Aphrody est le répertoire de travail (catalogue `config/a2a-peers.json`, dossier `.coord/` à la racine, CLI `aphrody a2a`). **Sinon :** ne pas supposer `.coord/` ni ces pairs ; lire le catalogue de pairs du projet s'il existe, sinon n'utiliser que le format d'enveloppe ci-dessous comme convention de fichier JSONL.

Ce guide régit la communication inter-agents sous la doctrine YOLO du dépôt (autonomie sans validation humaine, hors portes techniques).

## 1. Topologie des pairs

Source de vérité : `config/a2a-peers.json` (propriétaire `@aphrody/workspace`) ; `aphrody a2a peers` liste les pairs résolus (env > catalogue `aphrody-infra` > défaut). Statuts vérifiés le 2026-10-01 ; relire le catalogue avant de router (ils changent).

| Pair | Rôle (catalogue) | Transport | Endpoint |
|---|---|---|---|
| **`codex`** | `coding-agent` | fichier `.coord` | `.coord/inbox-from-codex.jsonl` |
| **`agycli`** | `antigravity-gemini-agent` | fichier `.coord` | `.coord/inbox-from-agycli.jsonl` |
| **`claude`** | `coding-agent` | fichier `.coord` | `.coord/inbox-from-claude.jsonl` |
| **`ocr`** | `ocr-worker` | fichier `.coord` | `.coord/inbox-from-ocr.jsonl` |
| **`rag`** | `retrieval-agent` | fichier `.coord` | `.coord/inbox-from-rag.jsonl` |
| **`shenron`** | `dragon-ball-knowledge-agent` | **retiré** (HTTP `mcp.dragonballfr.com/a2a` retiré le 2026-09-25) | remplacé par les outils MCP `dragonball_a2a_send`, `dragonball_a2a_task_status`, `dragonball_a2a_task_list`, `dragonball_a2a_agent_card` au-dessus du registre `/api/a2a` du site Shenron |
| **`aphrody`** | `ai-agent` | **retiré** (HTTP `aphrody.com/api/v1/a2a`) | n'est qu'une forme de redéploiement, pas un endpoint vivant |

Invoquer une CLI pair native : `aphrody a2a invoke --peer <grok|agy|claude|codex|bxc> [--claim <fichier-ou-dossier>] "<tâche>"` ; message JSON-RPC à un pair fédéré : `aphrody a2a send --target <pair> [--source <agent>] [--yolo] "<instruction>"` (HTTP `/a2a`, repli `.coord`). Listener local : `aphrody a2a serve` (défaut `127.0.0.1:8788` : `/ping`, `/msg`, JSON-RPC, agent card).

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

## 3. Requêtes JSON-RPC 2.0 (chemin `/a2a` du catalogue)

Exemple d'émission d'ordre autonome (méthode flotte `message/send`, params `FleetSendParams`) :

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

- Types et JSON Schemas canoniques : crate `crates/contracts/a2a` (paquet `aphrody-a2a`), module `coord`
  (`CoordEnvelope`, `EnvelopeKind`, `ChannelHint`, `FleetSendParams`, `PEERS`, `envelope_schema()`,
  `jsonrpc_request_schema()`, `jsonrpc_response_schema()`, `agent_card_schema()`).
- Agent Card A2A 1.0 publiée à `/.well-known/agent-card.json` (`AGENT_CARD_WELL_KNOWN_PATH`), type `AgentCard`.
- `message/send` (params `target`/`sourceAgent`/`instruction`/`yolo`) est la méthode flotte ; les méthodes
  A2A 1.0 standard (`SendMessage`, `GetTask`, ...) sont dans `aphrody_a2a::methods`.
- Implémentations : client `crates/os/a2a-client`, serveur `crates/os/a2a-server`, listener et boîte `.coord` `crates/os/a2a-coord`.
- Endpoints et hôtes : lus depuis `config/a2a-peers.json` / `aphrody a2a peers`, jamais codés en dur.

## 4. Règles opératoires YOLO (sans validation humaine)
1. **Zéro confirmation humaine** : trancher immédiatement sur toute décision réversible ; une action irréversible sur un état partagé ou de production reste soumise à la règle de `yolo` §3.
2. **Format bimodal** : fournir systématiquement la structure machine (JSON) et la lisibilité humaine (Markdown).
3. **Alertes Shenron** : les alertes critiques et fins de tâches de la flotte Shenron vont au salon Discord d'administration (constante `DISCORD_BO_ADMIN_CHANNEL` dans `packages/shenron/pipeline/src/aphrody/a2a.ts`, défaut `ADMIN_LAB_CHANNEL_ID` dans `apps/shenron/bot/src/lib/env.ts`) ; l'envoi manuel passe par `aphrody notify --channel discord`.
4. **Honest Delivery** : classer chaque résultat de façon vérifiable en `FAIT`, `INCOMPLET` ou `NON_FAIT`.
