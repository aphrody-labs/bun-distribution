<!-- SPDX-License-Identifier: Apache-2.0 -->
# Reverse Engineering & Cartographie Technique : Gemini Spark (Agent Mode)

**Date d'analyse :** 12 Septembre 2026  
**Cible :** Google Gemini Web App (`https://gemini.google.com/app`, `https://gemini.google.com/spark`, `https://gemini.google.com/agent`)  
**Moteur d'analyse :** BXC v0.9.11 + Boq Dynamic AST Scraper + Client de session authentifié  
**Statut :** Production-Ready / Preuves directes vérifiées par RPC HTTP 200  

---

## 1. Synthèse Exécutive & Nomenclature Interne

L'analyse en profondeur des bundles JavaScript de Boq (`BardChatUi`), du DOM Angular et des configurations bootstrap (`window.WIZ_global_data`) révèle l'architecture de **Gemini Spark** :

1. **Identité commerciale vs Identités internes :**
   - **Nom public :** `Gemini Spark` (avec badge `beta`, label "Spark", documenté par l'aide Google sous `lm_agent_*`).
   - **Mode opérationnel :** `Agent Mode` (identifié par l'onglet `<button data-test-id="app-tab-agent">`, classe `agent-tab-content`, `theme="lm"`).
   - **Codename interne R&D :** `Remy` (composants `remy-*`, routes `/remy/*`, RPCs `CreateRemySchedule`, `GetRemyGoal`, `ListRemyGoals`, etc.).
   - **Moteur d'exécution & Actuation :** `Bluedog` / `Agency` (`is_bluedog_agency_enabled`, télémétrie `/client_streamz/bard_chat_ui/actor/*` et `/embedded/bluedog_actuation_*`).
   - **Type de tâche backend :** `AGENTIC_TASK` (valeur enum `3`, aux côtés de `SCHEDULED`, `SCHEDULED_TASK_NON_REPEATING`, `ORGANIZER`).

2. **Piliers d'exécution de Spark :**
   - **Agent Chat & Orchestration :** Streaming bidirectionnel des pensées et sous-agents (`subagent thoughts enabled during stream`).
   - **Gestionnaire de Tâches Asynchrones & Background :** Création, pause, reprise, confirmation humaine et complétion (`CreateTask`, `PauseTask`, `ConfirmTask`, `ResumeTask`).
   - **Skills Personnalisés & Google Drive :** Compétences persistantes stockées dans Google Drive (`spark/skills/d/:driveId`, `CreateManagedSkill`, `match-my-writing-style`).
   - **Connecteurs MCP (Model Context Protocol) :** Support natif de serveurs MCP personnalisés (`ListCustomMcpServers`, composant `<custom-mcp-apps-section>`) et intégration de connecteurs partenaires (Linear, Evernote, PandaDoc, Zoho, Miro, etc.).
   - **Cloud Computer Use / VM Browser Actuation :** Sandbox Chromium distante contrôlée par l'agent via WebRTC (`InitVm`, `GetWebRtcCredentials`, `SendWebRtcSdpOffer`, `AddWebRtcIceCandidate`, outil `remote_chrome_agent:actuate`).

---

## 2. Preuves d'Exécution en Direct (Live RPC Validation)

Grâce aux cookies de session Google actifs (`~/.bxc/cookies/google.json`), les appels directs sur le protocole `batchexecute` (`/_/BardChatUi/data/batchexecute`) ont confirmé la disponibilité et la structure exacte des endpoints :

| Méthode RPC | Boq Hash | HTTP Code | Données Retournées (Preuve Live) |
|---|---|---|---|
| `ListAgentTemplates` | `PQ0fPd` | **200 OK** | 5 modèles officiels : `family_coordinator`, `tutor`, `group_organizer`, `marketing_agent`, `finance_agent` |
| `ListRecommendedSkills` | `z11P6b` | **200 OK** | Skills natifs : `match-my-writing-style` (Voice Card Google Drive), `focus-my-energy` |
| `ListRecommendedRemyGoals` | `DRqY5c` | **200 OK** | Objectifs recommandés : "Declutter your inbox" (Gmail scanner), "Deep dive on topics" |
| `ListRecommendedRemySchedules` | `q2vb0` | **200 OK** | Tâches récurrentes : `organize_my_subscriptions` (scan hebdomadaire factures), `recommend_wellness_tips` |
| `ListCustomMcpServers` | `SFvMZb` | **200 OK** | Tableau JSON Protobuf `[]` pour les serveurs MCP custom déclarés par l'utilisateur |
| `GetAllTasks` | `XPSWpd` | **200 OK** | Liste des tâches de fond de l'agent pour le compte |
| `ListManagedSkills` | `cCSu7` | **200 OK** | Liste des compétences personnalisées de l'utilisateur |
| `ListAgentAccounts` | `zaDfH` | **200 OK** | État du compte agent autonome (`[null, "", 0, 10]`) |

---

## 3. Cartographie des Routes Frontend (Angular Router)

Le bundle principal (`bundle2_main.js`) et le chunk racine de Spark (`chunk_HvRw6c.js`) enregistrent un ensemble complet de routes dédiées :

### 3.1 Arborescence Spark (`/spark/*`)
- `/spark` : Vue d'accueil Spark (Landing, FRE Onboarding, sélection d'agent ou chat libre).
- `/spark/chat/:conversationId` : Session conversationnelle avec l'agent Spark (affichage du split-pane, subagent thoughts et plan).
- `/spark/tasks` : Gestionnaire de tâches (visualisation des tâches en cours, en attente d'approbation ou terminées).
- `/spark/agent/new` : Interface de création d'un agent personnalisé (instructions, prompts système, outils autorisés).
- `/spark/agent/:agentId` : Tableau de bord et chat direct avec un agent spécifique.
- `/spark/skills` : Bibliothèque de compétences (skills activés et compétences recommandées).
- `/spark/skills/create` : Éditeur de compétence personnalisée.
- `/spark/skills/d/:driveId` : Résolution directe d'un fichier de compétence hébergé sur Google Drive (`resourcekey`).
- `/spark/apps` : Catalogue des connecteurs d'applications et serveurs MCP.
- `/spark/schedules` : Ordonnanceur de tâches périodiques et automatisations planifiées.
- `/spark/channels` : Canaux de communication externe (ex: notification et interaction par email `enable_remy_email_channel`).
- `/spark/memory` : Gestionnaire de mémoire persistante de l'agent.
- `/sparkle/:externalUrlId` : Partage public de session Spark.

### 3.2 Routes Miroirs & Aliases
- `/agent/*` : Alias direct de toutes les routes `/spark/*` (ex: `/agent/tasks` redirige vers `/spark/tasks`).
- `/remy/*` : Codename historique remappé vers `/agent/*` (ex: `/remy/skills` -> `/agent/skills`).
- `/gemini-spark` et `/remote-browser-data` : Points d'entrée de session de navigation distante et inspection du profil VM.

---

## 4. Matrice des Endpoints RPC Boq (`batchexecute`)

Les requêtes vers Google Gemini Web transitent via l'endpoint :
```http
POST /_/BardChatUi/data/batchexecute?bl={build_label}&_reqid={req_id}&rt=c
Host: gemini.google.com
Content-Type: application/x-www-form-urlencoded;charset=UTF-8

f.req=[[["{BOQ_HASH}","{SERIALIZED_JSON_ARGS}",null,"generic"]]]&at={AT_CSRF_TOKEN}
```

### 4.1 Orchestration des Tâches & Exécution Spark
| Méthode RPC | Boq Hash | Description & Paramètres |
|---|---|---|
| `CreateTask` | `Jba3ib` | Crée une nouvelle tâche autonome dans le workspace |
| `GetTask` | `kwDCne` | Récupère le statut et l'historique d'exécution d'une tâche (`taskId`) |
| `GetAllTasks` | `XPSWpd` | Liste toutes les tâches du compte |
| `GetTasksInConversation` | `qWymEb` | Liste les tâches liées à une conversation donnée (`conversationId`) |
| `UpdateTask` | `HRoTod` | Met à jour une tâche (priorité, instructions, paramètres) |
| `DeleteTask` | `Q4Gw3c` | Supprime une tâche |
| `PauseTask` | `DH63Df` | Met en pause l'exécution autonome |
| `ResumeTask` | `uFEB7` | Reprend l'exécution d'une tâche suspendue |
| `ConfirmTask` | `ttdQDb` | Confirmation HITL de l'utilisateur pour autoriser une action critique |
| `MarkTasksAsRead` | `k81mDb` | Acquitte les notifications de tâches terminées |

### 4.2 Agents & Personas
| Méthode RPC | Boq Hash | Description & Paramètres |
|---|---|---|
| `ListAgentTemplates` | `PQ0fPd` | Modèles préconfigurés (`family_coordinator`, `tutor`, etc.) |
| `InitializeAgentAccount` | `hmcese` | Provisionne l'environnement et l'espace de stockage agent |
| `ListAgentAccounts` | `zaDfH` | Liste les instances agents provisionnées |
| `GetAgentInstructions` | `IwKOJb` | Récupère le prompt système et la constitution de l'agent |
| `WriteAgentInstructions` | `By7OY` | Enregistre de nouvelles instructions système personnalisées |

### 4.3 Serveurs MCP & Connecteurs
| Méthode RPC | Boq Hash | Description & Paramètres |
|---|---|---|
| `ListCustomMcpServers` | `SFvMZb` | Liste les serveurs Model Context Protocol configurés par l'utilisateur (`[pageSize, pageToken, filter]`) |
| `CheckThirdPartyAppConnection` | `qO7R4d` | Valide la connectivité et la validité OAuth d'une extension/serveur MCP |
| `GetGalLinkedAccountProfile` | `P3BxXb` | Google Account Linking (GAL) : récupère le profil et l'email du compte tiers lié |
| `GetAllToolConsentData` | `uPDUsc` | Récupère les autorisations et consentements accordés aux outils |
| `UpdateToolPermission` | `UKqEL` | Modifie les droits accordés à un outil (lecture, écriture, exécution) |
| `RevokePermission` | `kQnpyd` | Révoque l'accès d'un connecteur ou serveur MCP |

### 4.4 Compétences (Skills)
| Méthode RPC | Boq Hash | Description & Paramètres |
|---|---|---|
| `ListManagedSkills` | `cCSu7` | Liste des compétences de l'utilisateur |
| `ListRecommendedSkills` | `z11P6b` | Compétences suggérées (`match-my-writing-style`, `focus-my-energy`) |
| `GetManagedSkill` | `pvBRnd` | Détail d'une compétence (`skillId`) |
| `GetManagedSkillByDriveId` | `pHNcP` | Import et lecture d'un skill stocké dans Google Drive (`driveId`, `resourcekey`) |
| `CreateManagedSkill` | `JnAqpb` | Création d'une nouvelle compétence |
| `CreateOrUpdateSkill` | `SMuXte` | Sauvegarde des modifications d'un skill |
| `SetManagedSkillEnabled` | `pdelZc` | Active ou désactive un skill pour l'agent |
| `DeleteManagedSkill` | `SL49ud` | Supprime un skill personnalisé |

### 4.5 Planifications & Automatisations (Schedules / Goals)
| Méthode RPC | Boq Hash | Description & Paramètres |
|---|---|---|
| `CreateRemySchedule` | `mDJkAd` | Planifie une exécution récurrente (cron / trigger) |
| `ListRemySchedules` | `Ey90Ac` | Liste des planifications actives |
| `ListRecommendedRemySchedules` | `q2vb0` | Automatisations préconfigurées (`organize_my_subscriptions`, etc.) |
| `UpdateRemySchedule` | `xrJXie` | Modifie la périodicité ou les paramètres |
| `DeleteRemySchedule` | `CK9lTc` | Supprime une planification |
| `ListRemyGoals` | `GS7W1` | Liste des objectifs permanents de l'agent |
| `GetRemyGoal` | `mXV10b` | Détail d'un objectif |
| `UpdateRemyGoal` | `Dxg8ke` | Mise à jour de l'objectif |
| `DeleteRemyGoal` | `w4yNDb` | Suppression de l'objectif |

### 4.6 Computer Use, Sandbox VM & WebRTC
| Méthode RPC | Boq Hash | Description & Paramètres |
|---|---|---|
| `InitVm` | `VczQlb` | Démarre un container cloud sécurisé pour la navigation distante |
| `SaveVmProfile` | `jTGBwf` | Sauvegarde l'état du navigateur, cookies et profil de la VM |
| `ListContainers` | `FxJCPe` | Liste les sandboxes de containers allouées |
| `GetWebRtcCredentials` | `AUWn6c` | Fournit les tokens STUN/TURN ICE pour le stream vidéo temps réel de la VM |
| `SendWebRtcSdpOffer` | `G1wmmd` | Envoie le Session Description Protocol (SDP) pour négocier le flux WebRTC |
| `AddWebRtcIceCandidate` | `YjPFC` | Échange les candidats réseau ICE WebRTC |

### 4.7 Streaming & Génération d'Artefacts
| Endpoint Stream | Boq Hash | Protocole / Rôle |
|---|---|---|
| `/assistant.lamda.BardFrontendService/StreamGenerate` | `RxAFq` | Stream principal texte, pensées d'agent et appels d'outils |
| `/assistant.lamda.BardFrontendService/StreamGenerateArtifact` | `ZiDWTc` | Génération et édition en direct de code, documents et artefacts UI |
| `/assistant.lamda.BardFrontendService/StreamGenerateYourDay` | `Skfdkd` | Synthèse quotidienne de l'agenda et des tâches prioritaires |
| `/assistant.lamda.BardFrontendService/StreamGmailInlineRewrite` | `OcOsnb` | Réécriture et composition d'emails dans Gmail |

---

## 5. Architecture MCP (Model Context Protocol) & Outils Internes

### 5.1 Schéma Protobuf de `ListCustomMcpServers` (`SFvMZb`)
L'analyse de la classe de décodage `_.z8f` dans `bundle2_main.js` permet de reconstituer fidèlement le message :
```protobuf
message CustomMcpServer {
  string extension_id = 1;      // Identifiant unique
  string display_name = 3;      // Nom d'affichage UI
  string description = 4;       // Description textuelle
  string icon_url = 5;          // URL de l'icône
  repeated McpTool tools = 6;   // Liste des outils exposés par le serveur
  string url = 7;               // Endpoint SSE / HTTP du serveur MCP
  State state = 8;              // 1: CONNECTED, 2: ERROR, etc.
  string client_id = 11;        // OAuth Client ID le cas échéant
  repeated string capabilities = 12; // Capacités MCP négociées
  repeated string resources = 13;    // Ressources MCP exposées
}
```

### 5.2 Catalogue des Connecteurs MCP Référencés
- **Outils Google Workspace intégrés :**
  - `calendar_mcp_agent` ("Google Calendar")
  - `Drive_mcp_agent` / `Docs_export_to_drive_agent` ("Google Drive")
  - `Gmail_mcp_agent` ("Gmail")
  - `People_mcp_agent` ("Google Contacts")
  - `Context_service_agent_workspace` ("Google Workspace Search")
  - `Sheets_api_wrapper_tool` ("Google Sheets")
  - `workspace_create_document_agent` ("Google Docs")
  - `notebooklm_mcp` / `gemini_notebooks` ("NotebookLM")
- **Connecteurs Tiers & Partenaires :**
  - `linear_mcp` (Linear)
  - `evernote_mcp` (Evernote)
  - `pandadoc_mcp` (PandaDoc)
  - `miro_mcp` (Miro)
  - `instacart_mcp` (Instacart)
  - `zillow_mcp` (Zillow)
  - `ticketmaster_mcp` / `seatgeek_mcp` (Billetterie)
  - `zoho_crm_mcp` / `zoho_mail_mcp` / `zoho_projects_mcp` (Zoho Suite)
  - `apartments_com_mcp`, `localiza_mcp`, `thumbtack_mcp`, `squarespace_mcp`

### 5.3 Outils d'Environnement Système (Computer Use Sandbox)
- **File Manager :** `view_file_tool`, `create_file_tool`, `edit_file_tool`, `multi_edit_file_tool`, `delete_file_tool`, `list_dir_tool`, `delete_dir_tool`, `move_tool`.
- **Exécution & Navigateur :** `vm_shell`, `browser`, `computer`, `remote_chrome_agent:actuate`.
- **Mémoire & Contexte :** `memory_read`, `memory_save`, `memory_view`, `memory_list`, `memory_search`, `memory_delete`, `memory_agent`.
- **Clôture :** `finish_tool`.

---

## 6. Feature Flags & Phenotype Experiments

Extraits directement de `window.WIZ_global_data["TSDtV"]` et des bundles :

| Clé / Hash Flag | Identifiant Experiment | Valeur par défaut | Description |
|---|---|---|---|
| `k4kqhf` | `45786783` | `"Spark"` | Nom d'affichage du mode agent dans l'onglet UI |
| `eWyQbe` | `45799998` | `"https://gemini.google.com/agent"` | URL canonique du mode agent |
| `ka9qb` | `45806344` | `["contact", "workspace_tool", "instacart_mcp", ...]` | Liste des connecteurs MCP actifs en production |
| `vtvvOe` | - | `["monday-connector-prod", "mcp-evernote-com", ...]` | Connecteurs d'entreprises tiers autorisés |
| `sTPKdf` | `45802976` | `["ucs-agentspace-dogfood", "spark-demo-1114", ...]` | Projets Cloud Google Dogfood autorisés |
| `is_bluedog_agency_enabled` | - | `Boolean` | Active le pipeline d'actuation et l'agent Bluedog |
| `enable_advanced_beta_mode` | - | `Boolean` | Active les fonctionnalités expérimentales Spark |
| `enable_remy_email_channel` | - | `Boolean` | Autorise les interactions avec l'agent via courriel |
| `has_accepted_agent_mode_fre_disclaimer` | - | `Boolean` | Flag utilisateur acquittant le dialogue First Run Experience |

---

## 7. Sélecteurs DOM & Tokens d'Intégration Web

Pour le scraping, l'automatisation CDP et le pilotage headless via `bxc` :

```css
/* Bouton d'accès principal à Spark dans le sélecteur de mode */
button[data-test-id="app-tab-agent"].app-tab {
  /* Contient: .agent-tab-content > span.gds-body-s ("Spark") + span.beta-badge ("beta") */
}

/* Header et logo Spark */
[data-test-id="gemini-spark-header"]
img[data-test-id="logo"][alt="Gemini Spark logo"]

/* Interface de chat Agent Spark (Split Pane) */
[data-test-id="remy-split-pane"]
[data-test-id="remy-split-pane-title"]
[data-test-id="remy-plan-pill"]          /* Bulle indiquant l'état d'avancement du plan */
[data-test-id="remy-status-pill"]        /* Indicateur de statut de l'agent */
[data-test-id="remy-side-panel"]         /* Panneau latéral détaillant les étapes et outils */

/* Zone de saisie des objectifs et tâches */
[data-test-id="remy-input-area-v2"]
[data-test-id="remy-new-task-input-area"]

/* Liste des tâches et planifications */
[data-test-id="remy-task-list"]
[data-test-id="recommended-skills-section"]
[data-test-id="recommended-skill-card"]
[data-test-id="tool-consent-dialog"]     /* Modale d'autorisation HITL pour un outil MCP */
```

---

## 8. Recommandations d'Intégration BXC / Aphrody

1. **Intégration Native dans `bxc gemini` :**
   - Étendre `bxc gemini` avec la commande `bxc gemini spark <prompt>` pour adresser directement l'endpoint `batchexecute` avec le hash `Jba3ib` (`CreateTask`) et le flux streaming `RxAFq` avec l'en-tête d'agent `AGENTIC_TASK`.
   - Fournir une commande `bxc gemini mcp list` exploitant le hash `SFvMZb` (`ListCustomMcpServers`).
   - Fournir une commande `bxc gemini tasks` exploitant le hash `XPSWpd` (`GetAllTasks`).

2. **Émulation d'Auth & Headers :**
   - Toujours initialiser la session via `https://gemini.google.com/app` pour extraire `SNlM0e` (token `at`), `cfb2h` (build label `bl`) et `FdrFJe`.
   - Définir `Referer: https://gemini.google.com/app` et `X-Same-Domain: 1`.
   - Utiliser `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36` pour éviter tout fingerprinting.
