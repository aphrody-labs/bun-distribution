# Paquets Linux pour Aphrody WSL — audit APT et bibliothèques Rust

Date : 2026-10-01. Hôte mesuré : Ubuntu **24.04.5 Noble**, amd64. Cible : Ubuntu **26.04.1 Resolute**. Aucun Cargo ni compilation Linux n'a été exécuté pour cet audit ; aucune source APT de l'hôte n'a été modifiée.

Preuves structurées : `apt-resolute/inventory.json` (paquets, installation hôte, candidat Noble, version/composant/Homepage Resolute), `apt-resolute/rust-licenses.json` (licences et dépôts déclarés des sources Rust déjà en cache). Index Resolute `main` et `universe` téléchargés depuis `https://archive.ubuntu.com/ubuntu/dists/resolute/`, SHA256 comparés au **InRelease signé**, signature vérifiée par `gpgv` avec `/usr/share/keyrings/ubuntu-archive-keyring.gpg` : clé Ubuntu Archive 2018 `F6ECB3762474EDA9D21B7022871920D1991BC93C`. Il s'agit des versions de base du lancement ; consulter aussi `resolute-updates` et `resolute-security` dans la distribution cible pour les correctifs courants.

## Socle et profils

| Profil | Paquets APT pertinents | État de l'hôte / décision |
|---|---|---|
| Distro avec services | systemd, systemd-sysv, dbus, dbus-user-session, udev, sudo, util-linux, ca-certificates | Présents ; socle nécessaire à systemd et au tunnel. Garder `/etc/wsl.conf` avec systemd activé. Les périphériques restent ceux exposés par l'hyperviseur. |
| Construction native Linux | build-essential, pkg-config, clang, llvm, lld, libclang-dev, cmake, ninja-build, git | Présents. Les dépendances C et linkers restent nécessaires même pour les applications Rust. |
| Noyau WSL / images | bison, flex, bc, libelf-dev, dwarves, libncurses-dev, cpio, xz-utils, e2fsprogs, qemu-utils, squashfs-tools, debootstrap | Présents. mmdebstrap et dosfstools absents ; disponibles en Resolute pour assembler d'autres rootfs/partitions. |
| Réseau / diagnostic | iproute2, iputils-ping, bind9-dnsutils, nftables, ethtool, socat, openssh-client | iproute2, ping, ethtool et client SSH présents ; bind9-dnsutils/nftables/socat absents. Serveur SSH facultatif, pas nécessaire à un tunnel Hyper-V. |
| USB / PCI / disques | linux-tools-common, pciutils, usbutils, udisks2, smartmontools, nvme-cli | Plusieurs outils absents ; utiles à l'inventaire. Leur installation ne donne pas un passthrough matériel. USB physique WSL nécessite aussi le serveur Windows usbipd-win. |
| Wayland / GPU | libwayland-dev, wayland-protocols, libxkbcommon-dev, libgbm-dev, libegl1-mesa-dev, libvulkan-dev, vulkan-tools, mesa-vulkan-drivers | Bibliothèques de développement et Vulkan présents ; mesa-utils absent. Pas de pilote GPU Linux propriétaire à substituer au driver Windows/`/dev/dxg` pour WSL. |
| Audio | libpipewire-0.3-dev, libpulse-dev, libasound2-dev ; pipewire, wireplumber | Bibliothèques présentes, daemons absents. Un daemon audio supplémentaire dans la distro est un choix produit : WSLg expose déjà son audio ; éviter de démarrer deux propriétaires du même flux. |
| Desktop Tauri | libgtk-3-dev, libwebkit2gtk-4.1-dev, librsvg2-dev, libayatana-appindicator3-dev | GTK/WebKit/SVG et Ayatana présents. libappindicator3-dev absent ; choisir l'API exigée par les features de l'application, pas installer arbitrairement les deux variantes. |
| Conteneurs locaux | podman, crun, slirp4netns, fuse-overlayfs | Présents. docker.io absent ; aucun besoin d'ajouter un deuxième daemon pour la recette WSLg utilisant Podman. |
| CLI Rust accessibles par APT | ripgrep, fd-find, bat, eza, zoxide, sccache | rg/fd/bat/eza présents via APT ; zoxide/sccache présents comme binaires privés, donc l'absence du paquet APT ne signifie pas un outil manquant. |

APT sur WSL installe parfois les noms `fdfind` et `batcat`. Conserver les propriétaires des commandes déjà configurés ; la session actuelle résout `fd`, `bat`, `nu`, `zoxide` et `sccache` dans les magasins privés d'Aphrody. Mesures actuelles : Nushell **0.115.1**, sccache **0.18.0**, zoxide **0.10.0**, eza **0.18.2**, rustc **1.98.1**.

## Rust système, rustup et crates

APT `rustc` / `cargo` sont les outils compilateurs empaquetés par Ubuntu ; `librust-<nom>-dev` contient le **code source** d'une bibliothèque sous `/usr/share/cargo/registry`. Cela sert au packaging Debian hors réseau et à son graphe de dépendances. Ce ne sont pas des bibliothèques dynamiques à installer pour exécuter tous les programmes Rust, ni un moyen de mettre à jour automatiquement le Cargo.lock Aphrody. [Politique Debian Rust](https://wiki.debian.org/Teams/RustPackaging/Policy), [guide Debian Rust](https://wiki.debian.org/Rust).

Versions APT vérifiées : Noble rustc/cargo **1.75**, Resolute base **1.93.1ubuntu1** ; rustup Resolute **1.27.1-8** ; sccache Resolute **0.13.0+ds-3**. Le projet utilise déjà Rust **1.98.1** : conserver le pin rustup et les binaires actuels. Rust recommande rustup pour la majorité des développeurs. [Installation officielle Rust](https://rust-lang.org/tools/install/).

APT Tokio Resolute **1.48.0-2** n'est pas le Tokio en cache **1.53.1** ; ce constat illustre pourquoi installer tous les `librust-*` n'est pas un alignement de l'écosystème. Les versions ci-dessous sont des sources déjà présentes, pas une déclaration de « dernière version » ni un choix de nouvelle dépendance.

| Besoin | Bibliothèques Rust vérifiées | Licence principale déclarée / dépendance système |
|---|---|---|
| CLI, sérialisation, logs, async | clap, serde, tracing, tokio | MIT / Apache-2.0 suivant crate ; principalement Rust, conserver Cargo.lock. |
| Unix, vsock, processus | libc, rustix, nix | MIT/Apache-2.0, nix MIT ; APIs du noyau réellement exposées. |
| Windows natif | windows, windows-sys | MIT/Apache-2.0 ; exécutables Windows utilisent MSVC/SDK et les APIs Windows, pas les libs Rust Debian Linux. |
| D-Bus et notifications fichiers | zbus, notify | MIT et CC0-1.0 ; D-Bus système/session selon besoin, inotify natif. |
| HTTP, persistance | reqwest, rusqlite | MIT/Apache-2.0 et MIT ; TLS rustls ou natif détermine OpenSSL, SQLite bundled ou système détermine libsqlite3-dev. |
| Fenêtres et GPU | winit, wayland-client, wgpu, ash | Apache-2.0 / MIT suivant crate ; Wayland/X11/Vulkan/driver système restent des couches séparées. |
| Audio | alsa ; bindings PipeWire selon propriétaire existant | ALSA Rust Apache-2.0/MIT ; headers ALSA/PipeWire et serveur effectif si feature utilisée. |

## Nushell et maintenance

`nushell` est absent des index officiels Ubuntu main/universe inspectés. La documentation amont propose son **dépôt APT propre Gemfury signé**, ou les binaires officiels GitHub ; ce n'est pas un paquet du dépôt Ubuntu. Aucun dépôt tiers n'a été ajouté ici. Nu actuel reste opérationnel, et ses plugins doivent être vérifiés par `plugin list` avant d'en dépendre. Le guide amont précise que les builds récents utilisent rustls par défaut, `libssl-dev` seulement pour native-tls, et que Nu 0.116 requiert Rust >=1.96.1 : le Rust de base Resolute serait trop ancien pour reconstruire cette version. [Installation officielle Nushell](https://www.nushell.sh/book/installation.html).

Main bénéficie de cinq années de maintenance standard Ubuntu LTS. Universe suit son modèle communautaire ; Ubuntu Pro/esm-apps étend la couverture de sécurité, il ne faut pas attribuer automatiquement la garantie Main à tous les outils Rust Universe. Aucun abonnement n'a été attaché. [Maintenance officielle Ubuntu](https://ubuntu.com/security/esm).

## Licences et distribution Aphrody

Les champs APT Homepage et composants donnent provenance et maintenance ; ils ne constituent pas un inventaire complet de licences. Lire `/usr/share/doc/<paquet>/copyright` et conserver notices/sources correspondantes lors du packaging. Exemples vérifiés localement : ripgrep Unlicense/MIT, fd-find et bat MIT/Apache-2.0, eza MIT, Podman Apache-2.0 (avec dépendances supplémentaires), systemd LGPL-2.1+ et parties GPL/MIT, OpenSSL Apache-2.0, Wayland X11, GTK LGPL avec parties GPL, WebKit licences multiples. Les licences des dépendances ne se résument pas à celle du programme principal.

La compatibilité 26.04 est établie ici au niveau **disponibilité des paquets**, pas par une exécution exhaustive : installer et vérifier les dépendances dans le rootfs 26.04 cible, conserver Noble en fonctionnement, examiner les SONAME et services avant de publier la distribution. `dnsutils` a son équivalent `bind9-dnsutils` dans l'index Resolute ; `usbip` n'est pas un paquet autonome trouvé ici, examiner les outils du noyau et le serveur Windows correspondant. Les binaires Linux doivent être testés dans cette image, les composants Windows dans Windows, et les images WSLg dans leur système Mariner/Azure Linux propre.
