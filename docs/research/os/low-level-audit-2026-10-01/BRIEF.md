# Audit « libaphrody + couche bas niveau » — brief commun (2026-10-01)

Dépôt : /home/aphro/aphrody (monorepo Rust + Bun, branche main). Machine : WSL2 (WSLg : Wayland + X11 ;
Tauri/WebKitGTK exige GDK_BACKEND=x11 ici). « libaphrody » = la bibliothèque C-ABI `libaphrody_ffi.so`
(crate `aphrody-ffi`, crates/interop/ffi ; en-tête crates/interop/ffi/include/aphrody.h ; chargeur Bun
packages/interop/native ; artefact release local target/release/libaphrody_ffi.so, 257 Mo).

## Règles impératives
- AUDIT EN LECTURE SEULE. N'édite AUCUN fichier du dépôt. Écris uniquement dans /tmp/audit-low-level/<axe>.md.
- AUCUN `cargo` (build, check, clippy, test, metadata), `rustc`, `bun test`, `bun install`. Le lead exécute une
  vérification cargo en ce moment ; ne pas la gêner. Outils autorisés : rg, grep, sed -n, git show/log/ls-files,
  nm -D, readelf, objdump, ldd, file, ls, wc, python3 (analyse de texte), lecture des sources du registre
  ~/.cargo/registry/src pour vérifier une API tierce.
- Méthode : utilise les skills et agents du plugin Aphrody comme grille de lecture
  (config/ai/plugins/aphrody/skills/<nom>/SKILL.md, config/ai/plugins/aphrody/agents/<nom>.md) — ceux cités dans ton axe.
  Lis aussi docs/architecture/rust-crate-gpu-window-ownership.md et docs/architecture/os/ARCHITECTURE.md si utile.
- Règles du dépôt (CLAUDE.md) : noms de crates/paquets, API, arguments CLI, schémas = contrats de compatibilité ;
  `upstream/`, code importé (koharu, obscura, taffy, material-web…) est signalé « importé », pas « first-party ».
- Preuve : chaque constat cite `chemin:ligne`, ce que tu as LU (pas supposé), et un niveau : [V] vérifié dans le code,
  [P] plausible/non reproduit. Niveau de preuve global = P1 (statique). Ne conclus jamais « conforme » depuis une
  compilation. Pas de constat générique (style, lint) : seulement des défauts de sûreté, de contrat ABI,
  de robustesse, de portabilité (Wayland/X11/Windows/macOS), de sécurité ou de dérive.
- Sévérité : CRITIQUE (exécution de code/corruption mémoire/escalade), HAUTE (crash, fuite de ressource non bornée,
  contrat ABI rompu, fonction inutilisable sur Wayland), MOYENNE, BASSE.
- Distingue toujours : ce qui existe et est faux / ce qui manque / ce qui est correct et à garder.
- Termine par la liste explicite « NON EXAMINÉ ».

## Format de sortie
1. Écris le détail complet dans /tmp/audit-low-level/<axe>.md (français, identifiants de code tels quels).
2. Ta réponse finale (≤ 70 lignes, français) : périmètre réellement lu (fichiers/lignes), tableau
   `ID | sévérité | chemin:ligne | constat | preuve`, 5 recommandations priorisées, NON EXAMINÉ, chemin du fichier détail.
   Maximum ~15 constats, les plus graves d'abord. Pas de remplissage.

## Addendum — vague 2 « hors Linux » (2026-10-01)
La vague 1 (7 axes) a surtout audité Linux/WSLg ; Windows et macOS ont été « lus, non vérifiés ». Cette vague audite
spécifiquement les chemins Windows et macOS (cfg(windows), cfg(target_os="macos"), code natif Win32/AppKit/Metal,
packaging, signature, permissions OS). Mêmes règles : lecture seule, aucun cargo/rustc/bun test, preuve [V]/[P],
sévérité CRITIQUE/HAUTE/MOYENNE/BASSE, fichier détail dans /tmp/audit-low-level/<axe>.md, résumé ≤ 70 lignes en français.
Tu peux consulter les rapports de la vague 1 (/tmp/audit-low-level/{abi,artefact,affichage,capture,gpu,os,terminal}.md)
pour ne pas les répéter : cite leurs IDs (OS-xx, CAP-xx, G-x, T-xx, ART-xx, F-xx, AFF-xx) quand tu les confirmes ou
les complètes côté Windows/macOS, et ne rapporte comme nouveau que ce qui est propre à ces plateformes.
Aucune machine Windows/macOS n'est disponible : tout est statique (P1). Les sources des crates tierces sont dans
~/.cargo/registry/src (lire pour confirmer le comportement réel sous Windows/macOS).

## Addendum 2 — vague 3 « scope élargi » (2026-10-01)
Consigne du propriétaire : « élargis le scope et oublie tes préjugés : Aphrody est un OS plus grand et natif que tu ne le crois ;
utilise le workspace pour voir nos crates os, shell, etc. » Les vagues 1 et 2 ont supposé « Tauri + wgpu autour d'un CLI ».
C'est trop étroit. N'écarte RIEN par présupposé : vérifie par le code. L'écosystème réel :
- Monorepo /home/aphro/aphrody : 182 crates (os 28 = noyau Aphrody OS, init/systemd Rust, coreutils uutils, compat Wine/Proton/.NET,
  winclean 166 outils Windows, re = reverse PE/ELF/Mach-O, sandbox/guard/execpolicy, a2a ; shell 4 ; native 1 ; compat 14 ; infra 6 =
  ssh/ovh/vpn/git/orchestrateur/yolo ; contracts 5 ; ai 62 ; web 18 = moteur de navigateur Obscura + web-engine ; ui 16 ; koharu 25 importé ;
  interop 1 = libaphrody_ffi), packages/* (Bun), apps/{cli,koharu,rg,shenron}, upstream/, et les dossiers racine services/ systemd/ cloud/
  host/ inventory/ nginx/ docker/ config/ scripts/ py/ patches/ plugins/.
- Dépôts frères, PARTIE du système : /home/aphro/iecode (202 membres Cargo : Bevy vendoré, forks winit/egui, aphrody-gpu-backend,
  émulateurs Wii/3DS/Switch/NDS, NIE ; ~2,3 M lignes Rust) et /home/aphro/aphrody-py (espace uv, ~20 paquets Python).
  /home/aphro/cosmic-epoch = checkout de référence COSMIC (30 sous-modules, rien de compilé) ; ne pas l'auditer, s'en servir comme source de réutilisation.
- Doctrine documentée : docs/architecture/os/ARCHITECTURE.md et research/RUST-OS-ARCHITECTURE-AND-BAREMETAL-ANALYSIS.md (méta-OS espace utilisateur,
  jamais bare-metal ; kernel = plan de contrôle privilégié MCP/JSON-RPC ; sous-systèmes). Confronte la doc au code : promesse tenue ou nominale ?
Outils : `@aphrody/workspace` (bun packages/infra/workspace/src/ops.ts <op> --root /home/aphro/aphrody) pour cartographier ; ops autorisées sans effet
de bord : cargo-boundaries, imports-exports, ecosystem-deps, workspace-deps, workspace-layout, binaries, repository-state (lecture). INTERDITES :
monorepo-gate, runtime-gate, ai-release-gate, ui-verify, desktop-smoke, workspace-clean, workspace-repair, tout `--apply`/`--fix`. Pas de cargo
(y compris `cargo metadata` : utilise le JSON précalculé /tmp/stack-dedup/metadata-after.json, graphe complet du workspace, via python3).
Ne répète pas la vague 1/2 : lis la section NON EXAMINÉ des rapports voisins (/tmp/audit-low-level/*.md) pour savoir ce qui reste à couvrir,
et cite leurs IDs quand tu confirmes un constat. Pour chaque trou trouvé, propose AUSSI une brique existante à réutiliser (principe du propriétaire :
« utiliser les libs/CLI/apps Rust de cosmic-epoch ou d'ailleurs plutôt que tout refaire ») : nom, licence déclarée, présent ou non dans Cargo.lock,
marqué « à évaluer ». Dis explicitement, par domaine, ce qui est fonctionnalité OS native first-party (noyau, init, IPC, fenêtrage, entrées, GPU,
sécurité) et ce qui n'est qu'un enrobage d'un outil externe.
