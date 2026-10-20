// SPDX-License-Identifier: Apache-2.0
/**
 * Automated i18n catalog generator for Aphrody Desktop UI (@aphrody/m3).
 *
 * Generates symmetric bilingual translations (EN & FR) mapped directly
 * from the real Aphrody backend systems:
 * - FFI (@aphrody/bun, HCT maths, palettes)
 * - CLI (crates/infra/aphrody pillars & commands)
 * - App-Server (crates/ai/app-server JSON-RPC)
 * - OS Kernel (crates/os/kernel/core subsystems & tools)
 * - Drive (crates/ui/drive, sd-daemon, VDFS)
 * - Shell (crates/shell, NuShell & PTY)
 *
 * Usage:
 *   bun scripts/tools/ui/generate-i18n.ts [--apply]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../../../");
const LOCALES_DIR = join(REPO_ROOT, "m3", "packages", "m3", "src", "locales");

export type I18nSchema = {
  common: Record<string, string>;
  nav: Record<string, string>;
  chat: Record<string, string>;
  files: Record<string, string>;
  models: Record<string, string>;
  settings: Record<string, string>;
  kernel: Record<string, string>;
  subsystems: Record<string, string>;
  drive: Record<string, string>;
  shell: Record<string, string>;
  ffi: Record<string, string>;
  errors: Record<string, string>;
};

export const EN_CATALOG: I18nSchema = {
  common: {
    app_name: "Aphrody OS",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    refresh: "Refresh",
    retry: "Retry",
    delete: "Delete",
    edit: "Edit",
    copy: "Copy",
    copied: "Copied!",
    search: "Search...",
    filter: "Filter",
    loading: "Loading...",
    error: "Error",
    success: "Success",
    warning: "Warning",
    info: "Information",
    ready: "Ready",
    active: "Active",
    offline: "Offline",
    running: "Running",
    stopped: "Stopped",
    connected: "Connected",
    disconnected: "Disconnected",
    syncing: "Syncing",
    version: "Version",
    uptime: "Uptime",
  },
  nav: {
    chat: "Chat & Agents",
    files: "Files & Drive",
    models: "Models & Telemetry",
    settings: "Settings",
    quickbar: "Quick Ask",
    pet: "Desktop Companion",
    widget: "Widget",
    terminal: "Terminal & Shell",
  },
  chat: {
    title: "Aphrody Agent Console",
    placeholder: "Ask Aphrody or prompt an agent turn...",
    submit: "Send",
    interrupt: "Stop Turn",
    clear: "Clear Timeline",
    new_session: "New Session",
    session_history: "Session History",
    tools_called: "Tools Executed",
    streaming: "Streaming agent response...",
    human_in_the_loop: "Approval Required",
    approve: "Approve Action",
    reject: "Reject Action",
    reply_prompt: "Provide human-in-the-loop input:",
    agent_status: "Agent Status",
    model_selector: "Active Model",
    in_process_broker: "In-Process Duplex App-Server Broker",
  },
  files: {
    title: "Drive File System (VDFS)",
    vdfs_root: "Root Directory",
    volumes: "Storage Volumes",
    local_volumes: "Local Drives",
    cloud_volumes: "Cloud Volumes",
    add_volume: "Connect Volume",
    sync_status: "Synchronization Status",
    indexing: "Indexing Files",
    tags: "Semantic Tags",
    recent_files: "Recent Files",
    file_preview: "File Preview",
    file_size: "Size",
    modified: "Modified Date",
    open_with: "Open with...",
    daemon_status: "sd-daemon Engine Status",
    storage_used: "Storage Utilized",
  },
  models: {
    title: "Local Models & Hardware Telemetry",
    installed_models: "Installed Weights",
    catalog: "Model Catalog",
    pull_model: "Download Model",
    cancel_pull: "Cancel Download",
    verify_model: "Verify Integrity (SHA-256)",
    remove_model: "Delete Weights",
    telemetry: "Hardware Telemetry",
    vram_usage: "VRAM Allocated",
    ram_usage: "System RAM",
    gpu_layers: "Offloaded GPU Layers",
    quantization: "Quantization Format",
    context_length: "Context Window",
    llama_daemon: "Managed llama-server Daemon",
    active_supervisor: "In-Process Model Supervisor",
  },
  settings: {
    title: "System Preferences",
    appearance: "Appearance & Theme",
    theme_system: "Follow System Theme",
    theme_light: "Material 3 Light",
    theme_dark: "Material 3 Dark",
    language: "Display Language",
    language_en: "English",
    language_fr: "Français",
    contrast: "Contrast Ratio",
    color_seed: "Dynamic Color Seed (HCT)",
    motion_reduced: "Respect Reduced Motion",
    runtime_paths: "Aphrody Runtime Paths",
    backend_transport: "Agent & Subsystem Transport",
    clear_cache: "Purge Stored Cache",
  },
  kernel: {
    title: "Aphrody OS Kernel Fabric",
    status: "Kernel Status",
    subsystems: "Registered Subsystems",
    bus_events: "AgentBus Event Stream",
    active_tools: "Dispatched Tools",
    registered_skills: "Available Skills",
    ipc_endpoint: "Local Kernel IPC Endpoint",
    router_active: "Agentic Fabric Router Active",
    a2a_dispatch: "A2A Peer-to-Peer Dispatch",
  },
  subsystems: {
    web: "Web & Obscura Engine",
    web_desc: "Headless web crawling, DOM tree extraction, and browser bridge",
    window: "Window Manager",
    window_desc: "Tauri multi-window supervision (main, splash, pet, widget, quickbar)",
    admin: "Administrative Subsystem",
    admin_desc: "Kernel inspection, permission management, and service control",
    systemd: "Systemd Service Subsystem",
    systemd_desc: "Linux user unit supervision and background daemon monitoring",
    coreutils: "Core Utilities Subsystem",
    coreutils_desc: "Memory-safe cross-platform core utilities and file primitives",
    compat: "Compatibility & N2B Subsystem",
    compat_desc: "Node-to-Bun scanning, registry bridge, and toolchain shims",
    infra: "Infrastructure Subsystem",
    infra_desc: "Server orchestration, SSH clustering, and deployment automation",
    cloud: "Cloud & Storage Subsystem",
    cloud_desc: "Unified object store and cloud synchronization connectors",
  },
  drive: {
    title: "Aphrody Drive Engine",
    daemon_supervision: "Supervised sd-daemon Process",
    rpc_status: "JSON-RPC IPC Socket Active",
    socket_path: "Local Daemon Socket",
    migrations_up_to_date: "Database Schema Migrations Validated",
    vdfs_index: "Virtual Distributed File System Index",
  },
  shell: {
    title: "Aphrody Native Shell & PTY",
    nushell_backend: "Structured NuShell Engine",
    pty_session: "Interactive Pseudo-Terminal Session",
    terminal_title: "Embedded Terminal Console",
    process_execution: "Supervised Process Execution",
    exec_policy: "Aphrody OS Execution Policy",
  },
  ffi: {
    title: "Aphrody Native FFI Bridge",
    hct_maths: "HCT Color Mathematics & Palettes",
    palettes: "13 Tonal Dynamic Palettes",
    color_roles: "Material 3 Color Roles Derivation",
    native_cdylib: "Compiled Native Library aphrody-ffi",
    bun_ffi_bridge: "Bun FFI Bridge (@aphrody/bun)",
  },
  errors: {
    network_unreachable: "Remote network endpoint is unreachable.",
    daemon_offline: "Supervised daemon is offline or starting.",
    model_not_found: "Requested model weights are not installed in the local store.",
    subsystem_unavailable: "Requested OS subsystem is currently not loaded.",
    kernel_disconnected: "Kernel IPC connection was lost; reconnecting...",
    unauthorized: "Action rejected by Aphrody execution policy.",
    path_traversal_blocked: "Access denied: path traversal outside workspace root.",
  },
};

export const FR_CATALOG: I18nSchema = {
  common: {
    app_name: "Aphrody OS",
    save: "Enregistrer",
    cancel: "Annuler",
    close: "Fermer",
    refresh: "Actualiser",
    retry: "Réessayer",
    delete: "Supprimer",
    edit: "Modifier",
    copy: "Copier",
    copied: "Copié !",
    search: "Rechercher...",
    filter: "Filtrer",
    loading: "Chargement...",
    error: "Erreur",
    success: "Succès",
    warning: "Avertissement",
    info: "Information",
    ready: "Prêt",
    active: "Actif",
    offline: "Hors ligne",
    running: "En cours d'exécution",
    stopped: "Arrêté",
    connected: "Connecté",
    disconnected: "Déconnecté",
    syncing: "Synchronisation",
    version: "Version",
    uptime: "Temps de fonctionnement",
  },
  nav: {
    chat: "Chat & Agents",
    files: "Fichiers & Drive",
    models: "Modèles & Télémétrie",
    settings: "Paramètres",
    quickbar: "Question Rapide",
    pet: "Compagnon Bureau",
    widget: "Widget",
    terminal: "Terminal & Shell",
  },
  chat: {
    title: "Console d'Agent Aphrody",
    placeholder: "Interrogez Aphrody ou lancez une action d'agent...",
    submit: "Envoyer",
    interrupt: "Interrompre le tour",
    clear: "Effacer l'historique",
    new_session: "Nouvelle session",
    session_history: "Historique des sessions",
    tools_called: "Outils exécutés",
    streaming: "Réception de la réponse de l'agent en streaming...",
    human_in_the_loop: "Approbation requise",
    approve: "Approuver l'action",
    reject: "Rejeter l'action",
    reply_prompt: "Saisie de l'opérateur (human-in-the-loop) :",
    agent_status: "État de l'agent",
    model_selector: "Modèle actif",
    in_process_broker: "Broker App-Server Duplex In-Process",
  },
  files: {
    title: "Système de fichiers Drive (VDFS)",
    vdfs_root: "Dossier racine",
    volumes: "Volumes de stockage",
    local_volumes: "Disques locaux",
    cloud_volumes: "Volumes cloud",
    add_volume: "Connecter un volume",
    sync_status: "État de synchronisation",
    indexing: "Indexation des fichiers",
    tags: "Étiquettes sémantiques",
    recent_files: "Fichiers récents",
    file_preview: "Aperçu du fichier",
    file_size: "Taille",
    modified: "Date de modification",
    open_with: "Ouvrir avec...",
    daemon_status: "État du moteur sd-daemon",
    storage_used: "Stockage utilisé",
  },
  models: {
    title: "Modèles locaux & Télémétrie matérielle",
    installed_models: "Poids installés",
    catalog: "Catalogue de modèles",
    pull_model: "Télécharger un modèle",
    cancel_pull: "Annuler le téléchargement",
    verify_model: "Vérifier l'intégrité (SHA-256)",
    remove_model: "Supprimer les poids",
    telemetry: "Télémétrie matérielle",
    vram_usage: "VRAM allouée",
    ram_usage: "RAM système",
    gpu_layers: "Couches GPU déportées",
    quantization: "Format de quantification",
    context_length: "Fenêtre de contexte",
    llama_daemon: "Démon managé llama-server",
    active_supervisor: "Superviseur de modèles in-process",
  },
  settings: {
    title: "Préférences système",
    appearance: "Apparence & Thème",
    theme_system: "Suivre le thème du système",
    theme_light: "Material 3 Clair",
    theme_dark: "Material 3 Sombre",
    language: "Langue d'affichage",
    language_en: "English",
    language_fr: "Français",
    contrast: "Rapport de contraste",
    color_seed: "Couleur racine dynamique (HCT)",
    motion_reduced: "Respecter les animations réduites",
    runtime_paths: "Emplacements d'exécution Aphrody",
    backend_transport: "Transport Agent & Sous-systèmes",
    clear_cache: "Purger les caches enregistrés",
  },
  kernel: {
    title: "Tissu du noyau Aphrody OS",
    status: "État du noyau",
    subsystems: "Sous-systèmes enregistrés",
    bus_events: "Flux d'événements AgentBus",
    active_tools: "Outils routés",
    registered_skills: "Compétences disponibles",
    ipc_endpoint: "Point de terminaison IPC du noyau",
    router_active: "Routeur de tissu agentique actif",
    a2a_dispatch: "Routage pair-à-pair A2A",
  },
  subsystems: {
    web: "Moteur Web & Obscura",
    web_desc: "Exploration web headless, extraction de DOM et pont navigateur",
    window: "Gestionnaire de fenêtres",
    window_desc: "Supervision multi-fenêtres Tauri (main, splash, pet, widget, quickbar)",
    admin: "Sous-système d'administration",
    admin_desc: "Inspection du noyau, gestion des permissions et contrôle des services",
    systemd: "Sous-système Systemd",
    systemd_desc: "Supervision des unités utilisateur Linux et surveillance des démons",
    coreutils: "Sous-système Utilitaires de base",
    coreutils_desc: "Utilitaires système sécurisés en mémoire et gestion des fichiers",
    compat: "Sous-système Compatibilité & N2B",
    compat_desc: "Analyse Node vers Bun, passerelle de registre et adaptateurs de compilation",
    infra: "Sous-système Infrastructure",
    infra_desc: "Orchestration serveurs, grappes SSH et automatisation du déploiement",
    cloud: "Sous-système Cloud & Stockage",
    cloud_desc: "Stockage d'objets unifié et connecteurs de synchronisation cloud",
  },
  drive: {
    title: "Moteur Aphrody Drive",
    daemon_supervision: "Processus supervisé sd-daemon",
    rpc_status: "Socket IPC JSON-RPC actif",
    socket_path: "Socket local du démon",
    migrations_up_to_date: "Migrations de schéma de base de données validées",
    vdfs_index: "Index du système de fichiers distribué virtuel",
  },
  shell: {
    title: "Shell natif Aphrody & PTY",
    nushell_backend: "Moteur NuShell structuré",
    pty_session: "Session de pseudo-terminal interactive",
    terminal_title: "Console de terminal embarquée",
    process_execution: "Exécution supervisée de processus",
    exec_policy: "Politique d'exécution Aphrody OS",
  },
  ffi: {
    title: "Pont FFI natif d'Aphrody",
    hct_maths: "Mathématiques des couleurs HCT et palettes tonales",
    palettes: "13 palettes tonales dynamiques",
    color_roles: "Dérivation des rôles de couleur Material 3",
    native_cdylib: "Bibliothèque native compilée aphrody-ffi",
    bun_ffi_bridge: "Pont FFI Bun (@aphrody/bun)",
  },
  errors: {
    network_unreachable: "Le point de terminaison réseau distant est injoignable.",
    daemon_offline: "Le démon supervisé est hors ligne ou en cours d'initialisation.",
    model_not_found: "Les poids du modèle demandé ne sont pas installés dans le magasin local.",
    subsystem_unavailable: "Le sous-système demandé du noyau OS n'est pas chargé actuellement.",
    kernel_disconnected: "La connexion IPC au noyau a été interrompue ; reconnexion en cours...",
    unauthorized: "Action refusée par la politique de sécurité d'Aphrody OS.",
    path_traversal_blocked: "Accès refusé : tentative de traversée hors de la racine de travail.",
  },
};

export async function generateLocales(apply = false) {
  if (apply) {
    await mkdir(LOCALES_DIR, { recursive: true });
    await writeFile(join(LOCALES_DIR, "en.json"), JSON.stringify(EN_CATALOG, null, 2) + "\n", "utf8");
    await writeFile(join(LOCALES_DIR, "fr.json"), JSON.stringify(FR_CATALOG, null, 2) + "\n", "utf8");
    console.log(`[i18n-generate] Wrote symmetric EN & FR catalogs to ${LOCALES_DIR}`);
  }
  return { en: EN_CATALOG, fr: FR_CATALOG };
}

if (import.meta.main) {
  const apply = process.argv.includes("--apply");
  await generateLocales(apply);
  if (!apply) {
    console.log("[i18n-generate] Dry-run complete. Run with --apply to write catalogs.");
  }
}
