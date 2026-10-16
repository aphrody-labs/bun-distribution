<!-- SPDX-License-Identifier: Apache-2.0 -->
# Toolchains, build tools et compilation croisée Rust

## Canaux du workspace

Le checkout épingle Rust `1.98.1` dans [`rust-toolchain.toml`](../../rust-toolchain.toml).
C’est le canal stable reproductible utilisé par Cargo à la racine. Ne remplace
pas cet épinglage par `stable` flottant : un bump se fait avec les gates du
workspace et une mise à jour du fichier.

Le canal canary utilise la toolchain Rustup `nightly`. Il sert à détecter en
avance les régressions du compilateur et à évaluer les outils instables. Une
réussite nightly ne remplace pas la qualification stable; garde ses sorties
distinctes et n’utilise pas `RUSTC_BOOTSTRAP` pour masquer un échec.

Tous les builds locaux du monorepo passent par
[`cargo-serial.sh`](../../../../scripts/aphrody/build/rust/cargo-serial.sh), qui prend le
verrou partagé, borne les jobs à six au plus et désactive l’incrémental pour
permettre la réutilisation de sccache. Le wrapper accepte les arguments globaux
Cargo, dont `+nightly` :

```sh
scripts/build/rust/cargo-serial.sh check --workspace --locked
scripts/build/rust/cargo-serial.sh +nightly check -p aphrody --locked
```

Utilise `APHRODY_CARGO_JOBS=1..6` pour réduire la charge sur une machine
mémoire limitée. Ne lance pas plusieurs Cargo en parallèle et ne passe pas
`-j`; le verrou et la politique de jobs s’appliquent à toutes les sessions.

### Limite de ligne de commande Windows avec sccache

Sur Windows, le wrapper utilisateur `aphrody-rustc-router.exe` conserve sccache
pour les invocations courtes. Rustc reçoit un fichier réponse UTF-8 à arguments
séparés par des lignes lorsque la commande approche 24 000 unités UTF-16. Le
routeur Rust ([source](../../../../scripts/aphrody/build/rust/sccache-rustc-router.rs),
tests de qualification dans
[`cargo-serial-windows.test.ts`](../../../../scripts/aphrody/build/rust/cargo-serial-windows.test.ts))
couvre aussi l’expansion interne de sccache : si sccache échoue avec
`sccache: caused by:` et `os error 206` après avoir ajouté ses propres options,
il retente une seule fois la même compilation via `rustc @response-file`. Les
autres erreurs et codes de sortie de sccache sont transmis sans retry. Les
arguments non UTF-8 et contenant CR/LF sont refusés avant création du fichier;
les fichiers temporaires uniques sont supprimés après l’appel à rustc. Dans les
deux voies de fallback, le routeur développe une seule couche de response
files `@...` fournie par Cargo avant d’écrire son propre fichier réponse, car
rustc ne développe pas les fichiers imbriqués dans ce chemin. Les invocations
longues et les retries après l’erreur 206 compilent sans sccache, donc sans
cache pour cette compilation. Une commande Cargo qui dépasse la limite
CreateProcess Windows avant le démarrage du wrapper ne peut pas être réparée
par le routeur.

Qualification Windows (2026-10-11) : les sept tests unitaires Rust du routeur
passent, dont la compilation réelle via un `@response` Cargo aplati; strict
Clippy, `rustfmt`, les dix tests du wrapper Bun (59 assertions), le contrôle
TypeScript, `oxfmt` et le lint ciblé passent. Une invocation Cargo longue de
30 823 unités UTF-16 compile via la voie directe sans cache. Le contrôle réel
`cargo-serial.ts --msvc check -p uv-auth --locked --message-format=short`
(nightly 2026-09-15) a reproduit l’erreur sccache 206 puis terminé avec succès
après retry rustc, en 2,59 s. Une sonde courte a gagné un hit sccache après
recompilation. L’installation globale vérifie son reçu source/outils/binaire;
son second passage a signalé `CompileSkipped=true`, sans changement de binaire,
reçu, configuration ou environnement, et `-WhatIf` n’a planifié aucune écriture.
Ces résultats qualifient le routeur Windows et `uv-auth`, pas le workspace Bun
complet ni la fabrique qui invoque rustc directement.

Installe ou répare le routeur depuis une session PowerShell native Windows :
[`install-sccache-rustc-router.ps1`](../../../../scripts/aphrody/build/rust/install-sccache-rustc-router.ps1).

```powershell
./scripts/build/rust/install-sccache-rustc-router.ps1
```

L’installation met à jour le binaire et la configuration Cargo globale de
l’utilisateur, puis `RUSTC_WRAPPER` utilisateur quand ces valeurs sont absentes
ou pointent déjà vers sccache/le routeur. Les wrappers personnalisés et les
valeurs vides explicites restent inchangés. `cargo-serial.ts --msvc` route
séparément les deux variables `RUSTC_WRAPPER` et
`CARGO_BUILD_RUSTC_WRAPPER` quand elles désignent sccache, en gardant le chemin
du sccache effectif pour le cache. L’installation ne modifie pas les variables
Machine, le `CARGO_BUILD_RUSTC_WRAPPER` du processus courant, les paramètres
`SCCACHE_*` ni les données du cache. Elle ne détourne pas les compilateurs
C/C++; le script de factory Bun qui appelle rustc directement conserve ce
contrat.

## Outils installés avec Cargo

Le poste dispose de `cargo-nextest`, `cargo-deny`, `cargo-audit` et
`cargo-machete`. Pour le développement et la matrice de fonctionnalités,
`cargo-expand` et `cargo-hack` sont installés. La compilation croisée ajoute
`cargo-zigbuild` et `cargo-xwin`. Les installations de ce workspace utilisent
`cargo install --locked` via le wrapper partagé.

```sh
scripts/build/rust/cargo-serial.sh install --locked cargo-expand
scripts/build/rust/cargo-serial.sh install --locked cargo-hack
scripts/build/rust/cargo-serial.sh install --locked cargo-zigbuild
scripts/build/rust/cargo-serial.sh install --locked cargo-xwin
```

| Cible | Outil recommandé | Limite à garder en tête |
| --- | --- | --- |
| Linux natif x86_64 | Cargo stable + sccache | Cible bloquante principale du monorepo. |
| Linux GNU multi-architecture / glibc minimale | `cargo zigbuild` + Zig | Les dépendances C/C++ doivent aussi respecter le sysroot cible. macOS requiert ses SDK et sa signature sur hôte macOS. |
| Windows MSVC depuis Linux/WSL | `cargo xwin` | Télécharge et met en cache le CRT/SDK MSVC; les tests Windows nécessitent Wine ou un runner Windows. |
| WASM navigateur / WASI | `rustup target add` puis Cargo | Les crates dépendantes d’OS natif doivent être filtrées par features/targets. |
| Tests sur architectures émulées | `cross` avec Docker/Podman, au besoin | À réserver aux cibles qui demandent un sysroot ou une émulation; le moteur conteneur ajoute un coût disque. |

Les targets déjà configurées sont dans `rust-toolchain.toml`. `cargo-zigbuild`
permet de demander explicitement un minimum glibc, par exemple
`x86_64-unknown-linux-gnu.2.17`; ce suffixe n’est pas un engagement de
compatibilité tant que l’artefact et ses bibliothèques natives n’ont pas été
validés sur le runtime visé.

## Dépendances et publication

Privilégie crates.io pour une release stable publiée, et un Git URL avec révision
immuable lorsque l’API amont nécessaire n’est pas encore publiée. Évite les
copies de sources vendored sauf contrainte de licence, de génération ou de
reproductibilité démontrée. Les dépendances Git, les features par défaut, les
build scripts natifs et les dépendances `path` demandent une qualification
individuelle avant publication; le workspace entier ne devient pas publiable
par un changement global de manifeste.

Avant de publier une crate, vérifie ses fichiers inclus et ses dépendances :

```sh
cargo package -p <crate> --list
cargo package -p <crate> --no-verify --locked
```

Publie d’abord les crates Aphrody dont elle dépend, avec leurs versions
compatibles, puis passe les consommateurs de `path + version` au registre.
Conserve les crates internes d’application en `publish = false` lorsqu’elles
ne forment pas une API stable.

Les macros et outils de build doivent rester hors des dépendances d’exécution
quand Cargo le permet. Pour réduire la compilation, préfère des features
facultatives explicites et des dépendances ciblées; ne supprime pas les
features ou le bundling qui garantissent une installation reproductible sans
mesure de compatibilité et de taille.

## Références amont

- [Cargo configuration](https://doc.rust-lang.org/cargo/reference/config.html)
- [Rustup toolchains](https://rust-lang.github.io/rustup/concepts/toolchains.html)
- [Rustup toolchain overrides](https://rust-lang.github.io/rustup/overrides.html)
- [cargo-zigbuild](https://github.com/rust-cross/cargo-zigbuild)
- [cargo-xwin](https://github.com/rust-cross/cargo-xwin)
- [cross](https://github.com/cross-rs/cross)
- [Cargo publishing](https://doc.rust-lang.org/cargo/reference/publishing.html)
