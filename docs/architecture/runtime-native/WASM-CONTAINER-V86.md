<!-- SPDX-License-Identifier: Apache-2.0 -->
# Full-WASM Architecture: MicroVM Container Virtualization (`v86` & `container2wasm`)

> Statut : Spécification d'architecture et guide d'intégration.
> Références amont : [container2wasm/container2wasm](https://github.com/container2wasm/container2wasm), [copy/v86](https://github.com/copy/v86).
> Documentation liée Aphrody : [wasm-stack-definitive.md](../../plans/shell/wasm-stack-definitive.md), [wasm-stack-upstreams.md](../../research/shell/wasm-stack-upstreams.md).

---

## 1. Vision et Objectif : Le Monorepo "Full-WASM"

L'objectif "Full-WASM" d'Aphrody est de permettre l'exécution complète, sécurisée et hors-sol de l'ensemble des capacités du monorepo dans WebAssembly, sans dépendance vis-à-vis d'un démon Docker hôte, d'un accès root, ou d'un serveur cloud centralisé.

Pour dépasser les limites intrinsèques des cibles `wasm32-unknown-unknown` et `wasm32-wasip2` (absence de `fork`, `execve`, signaux POSIX complets, sockets TCP arbitraires, PTYs natifs), Aphrody déploie une **architecture en 3 tiers** intégrant la virtualisation de conteneurs Linux dans WebAssembly via [`v86`](https://github.com/copy/v86) et [`container2wasm`](https://github.com/container2wasm/container2wasm).

---

## 2. Analyse Approfondie des Deux Moteurs Amont

### 2.1 `container2wasm` (c2w)

- **Auteur & Écosystème** : Kohei Tokunaga (contributeur majeur Docker / containerd / runc).
- **Principe de fonctionnement** : Convertit une image conteneur OCI (Docker image standard, ex. `alpine:latest`, `python:3.12-slim`, `node:22-bookworm`) en un package WebAssembly autonome.
- **Architecture technique** :
  - **Émulateur** : QEMU compilé en WebAssembly (par défaut `qemu-system-riscv64` pour sa compacité et son jeu d'instructions RISC-V moderne, ou `qemu-system-x86_64` / Bochs).
  - **Noyau Linux invité** : Noyau minimaliste compilé avec les pilotes paravirtualisés `virtio` (`virtio-net`, `virtio-blk`, `virtio-9p`, `virtio-console`).
  - **Système de fichiers** :
    - Rootfs conteneur empaqueté en image disque (initramfs ou ext2/erofs).
    - Partage de fichiers hôte $\leftrightarrow$ invité via le protocole **Virtio-9p** (Plan 9) ou **virtiofs**.
  - **Entrées/Sorties Terminal** :
    - Virtio-console / port série 16550 mappé vers stdio ou un flux de bytes WebSocket/WebTerminal.
  - **Réseau** :
    - Virtio-net avec pile IP en mode utilisateur (slirp-in-wasm) ou relais WebSocket transparent.
  - **Runtimes hôtes** : Navigateur web (Web Workers), runtimes WASI (`wasmtime`, `wamr`), Bun, Node.js.

### 2.2 `v86` (copy/v86)

- **Auteur** : Fabian Hemmer (copy).
- **Principe de fonctionnement** : Virtualisation complète d'un PC d'architecture x86 (32 bits) en pur JavaScript et WebAssembly.
- **Architecture technique** :
  - **Compilateur JIT dynamique** : Traduction dynamique à la volée des blocs de base d'instructions machine x86 vers du bytecode WebAssembly exécuté directement par le moteur du navigateur ou du runtime hôte (V8/JSC).
  - **Matériel émulé** :
    - Processeur Intel 80486 / Pentium avec FPU complète, registres, MMU, pagination et TLB.
    - Périphériques virtio : `virtio-net` (carte réseau), `virtio-9p` (système de fichiers Plan 9), `virtio-balloon`, `virtio-console`.
    - Périphériques PC standards : contrôleur d'interruptions PIC/APIC, timer PIT, port série 16550 UART (COM1), contrôleur IDE/floppy.
  - **Serveur 9p natif en JS/WASM** :
    - Implémentation directe d'un serveur de protocole 9p permettant de monter dynamiquement n'importe quelle arborescence mémoire, IndexedDB ou OPFS dans le Linux invité sous `/mnt` avec permissions complètes de lecture/écriture.
  - **Instantanés de mémoire (Snapshotting ultra-rapide)** :
    - Sérialisation intégrale de l'état CPU, RAM et périphériques dans un `ArrayBuffer` binaire unique.
    - **Restauration instantanée en moins de 50 ms** : évite totalement la phase de démarrage du noyau Linux à chaque session.

---

### 2.3 Matrice Comparative

| Critère | `v86` | `container2wasm` (c2w) |
|---|---|---|
| **Architecture invitée** | x86 (32-bit i486/Pentium) | RISC-V 64-bit (`riscv64`) ou x86_64 |
| **Moteur d'exécution** | Interpréteur WASM + JIT dynamique x86 $\rightarrow$ WASM | QEMU TCG ou Bochs compilé en WASM |
| **Prise en charge OCI** | Via rootfs Buildroot/Alpine ou image disque | Directe via `c2w build` depuis Dockerfile/image OCI |
| **Temps de démarrage à froid** | ~2 à 3 secondes | ~2 à 4 secondes |
| **Restauration par snapshot** | **< 50 ms (ultra-rapide)** | Supporté via migration QEMU |
| **Partage de fichiers VFS** | Serveur 9p JS/WASM natif (montage `/mnt`) | Virtio-9p / virtiofs natif |
| **Sortie console / PTY** | COM1 UART 16550 vers flux d'octets | Virtio-console / série UART |
| **Exécution navigateur** | 100% autonome en Web Worker | 100% autonome en Web Worker |
| **Exécution Bun / Node** | Supporté via wrapper headless | Supporté via wasmtime, Bun, Node |

---

## 3. Le Modèle en 3 Tiers "Full-WASM" d'Aphrody

```
┌────────────────────────────────────────────────────────────────────────┐
│                      L5 : SURFACE UI & RENDU                           │
│     Web UI (app-ui, m3-react, Ghostty/Rio DOM, WebGL Canvas)          │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     L4 : CLIENT & TRANSPORTS                           │
│  @aphrody/shell-web (localTransport, workerTransport, wasmContainer)  │
└────────────────────────────────────────────────────────────────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         ▼                          ▼                          ▼
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│     TIER 1       │       │      TIER 2      │       │      TIER 3      │
│   MICRO-WASM     │       │    SHELL-WASM    │       │  CONTAINER-WASM  │
├──────────────────┤       ├──────────────────┤       ├──────────────────┤
│ `aphrody pure`   │       │ `WebTerminal`    │       │ `WasmGuestHost`  │
│ RAG Vectoriel    │       │ (Rio VT State)   │       │ Virtualisation   │
│ Toolcall Repair  │       │ `LocalShell`     │       │ MicroVM v86/c2w  │
│ Obscura DOM/HTML │       │ `SharedOpfsVfs`  │       │ Conteneurs OCI   │
│ < 1ms / ~2.9 Mo  │       │ OPFS 2 Slots     │       │ Linux complet    │
│ En-processus     │       │ Shell léger      │       │ Python, Bun, Git │
└──────────────────┘       └──────────────────┘       └──────────────────┘
```

### Tier 1 : Micro-WASM (En-processus, In-Memory)
- **Crate** : `crates/infra/aphrody-command-wasm`, `packages/infra/cli-wasm`.
- **Usage** : Opérations d'IA, chunking RAG hybride, recherche vectorielle, réparation de toolcalls JSON, projection Dragon Ball, parsing HTML en Markdown.
- **Propriétés** : Zéro surcharge, exécution synchrone ou asynchrone instantanée (< 1 ms), module compilé et optimisé avec `wasm-opt -Oz --converge` (2,9 Mo).

### Tier 2 : Shell-WASM (Terminal & VFS Local)
- **Crates** : `crates/shell/terminal-core`, `crates/shell/web`, `crates/shell/vfs`.
- **Usage** : Émulation de terminal ANSI/VT (parser Rio VT), shell interactif léger, persistance OPFS bi-slot (`aphrody-shell-0.img`, `aphrody-shell-1.img`).
- **Propriétés** : < 1 Mo, gestion de session et de commandes internes Aphrody sans VM lourde.

### Tier 3 : Container-WASM (MicroVM & Conteneurs Linux)
- **Crates & Packages** : `crates/shell/aphrody-shell-sandbox-host/src/wasm_guest.rs`, `packages/shell/web` (`wasmContainerTransport`).
- **Usage** : Environnement complet Linux (Alpine, Debian, Ubuntu), exécution de véritables scripts Python, Node, Bun, GCC, Git, apk/apt sans machine hôte.
- **Propriétés** :
  - Pont de fichiers VFS via le protocole 9p montant le VFS d'Aphrody sous `/mnt/host`.
  - Sortie série COM1/virtio connectée directement au `WebTerminal` d'Aphrody.
  - Snapshotting instantané : reprise en moins de 50 ms depuis les slots OPFS.

---

## 4. Intégration dans le Contrat `SandboxHost`

Dans `crates/shell/aphrody-shell-sandbox-host`, l'adaptateur `WasmGuestHost` (`src/wasm_guest.rs`) implémente le contrat `SandboxHost` (`src/lib.rs`) :

```rust
use aphrody_shell_sandbox_host::{SandboxHost, WasmGuestConfig, WasmGuestEngine, WasmGuestHost};
use aphrody_shell_session::SpawnSpec;

// Configuration d'un conteneur microVM WASM
let config = WasmGuestConfig {
    engine: WasmGuestEngine::V86,
    memory_mb: 128,
    rootfs: Some("https://assets.aphrody.com/v86/alpine-minimal.img".into()),
    snapshot: Some("https://assets.aphrody.com/v86/alpine-booted.snapshot".into()),
    mount_point: "/mnt/host".into(),
    limits: Default::default(),
};

let mut host = WasmGuestHost::new(config);

// 1. Transfert de fichiers transparent via le pont 9p
host.upload(b"/app/main.py", b"print('Hello from WASM microVM!')\n")?;

// 2. Lancement de la session terminal
let mut session = host.spawn(&SpawnSpec::default())?;
session.write_input(b"python3 /mnt/host/app/main.py\r")?;

// 3. Récupération des octets de sortie terminal
let output = session.take_output();
```

---

## 5. Stratégies d'Optimisation de Performance

Pour une réactivité maximale sur le Web et en environnement edge :

1. **Kernel Slimming (< 3,5 Mo)** :
   - Dépouiller le noyau Linux des pilotes inutiles (cartes son PCI, bus ISA, graphismes VGA lorsque le mode headless série est actif).
   - Ne conserver que les pilotes virtio (`CONFIG_VIRTIO`, `CONFIG_VIRTIO_NET`, `CONFIG_NET_9P`, `CONFIG_9P_FS`).
2. **Snapshot-First Cold Start (< 50 ms)** :
   - Effectuer le boot initial du conteneur en phase de build (CI/CD ou pré-génération).
   - Sauvegarder l'état mémoire stabilisé (`v86.save_state()`).
   - Au démarrage utilisateur dans le navigateur, charger directement l'instantané mémoire : reprise instantanée sans phase de boot du kernel.
3. **Zero-Copy OPFS via `FileSystemSyncAccessHandle`** :
   - Dans le Web Worker d'Aphrody, exploiter les handles d'accès synchrones OPFS pour alimenter les requêtes 9p en lecture/écriture de blocs sans passerelle DOM.
4. **Optimisation Wasm-Opt Convergée** :
   - Application de `wasm-opt -Oz --converge --strip-debug --strip-producers` sur l'émulateur WebAssembly pour minimiser le coût de parsing et d'instanciation V8/JSC.
5. **Réseau Virtio-Net Sécurisé** :
   - Tunneling des trames Ethernet virtio-net via WebSocket sécurisé (WSS) ou proxy fetch/slirp pour interdire les requêtes réseau non autorisées et respecter les quotas `HostLimits`.

---

## 6. Vérification et Statut d'Intégration

- `crates/shell/aphrody-shell-sandbox-host/src/wasm_guest.rs` :
  - Type `WasmGuestHost` qualifié et testé.
  - Conforme à `verify_host_contract` (tests unitaires validés).
  - Compilation vérifiée pour la cible hôte et la cible `wasm32-unknown-unknown`.
- `packages/shell/web/src/index.ts` :
  - Exposition de `wasmContainerTransport` et des types `WasmContainerOptions`.
  - Validation complète du typecheck TypeScript (`tsc -p tsconfig.json --noEmit` exit 0).
