# Distributions WSL et systèmes Rust — état au 1 octobre 2026

Recherche documentaire pour orienter Aphrody OS. Les versions et dépôts ont été vérifiés le 1 octobre 2026. Ce document n’installe ni ne compile aucun système.

## Conclusions utiles pour Aphrody OS

- Pour construire une distribution WSL, le livrable principal est un root filesystem `tar`/`.wsl`. WSL 2 démarre celui-ci dans sa VM gérée avec **un noyau Linux partagé** entre les distributions. Le rootfs ne doit contenir ni noyau ni initramfs. Il n’existe donc pas un noyau Ubuntu par instance WSL.
- Ubuntu 26.04.1 LTS est disponible en image WSL et repose sur le noyau GA Linux **7.0** (avec mises à jour de paquets depuis la sortie). Au 1 octobre 2026, le dépôt du noyau Microsoft pour WSL publie **6.18.40.1**. Ce sont deux produits et deux usages différents : le noyau Ubuntu du système Ubuntu installé sur machine/VM contre le noyau commun utilisé par WSL2.
- Pour le premier rootfs Aphrody, Ubuntu 26.04.1 fournit une base LTS riche et testée par Microsoft/Canonical; NixOS-WSL est le meilleur modèle à étudier pour la configuration reproductible et le packaging WSL. Fedora, Arch et Alpine sont d’autres bases valables selon le besoin.
- Redox et Theseus sont des OS écrits principalement en Rust, pas des distributions Linux à importer sous WSL. Tock cible les microcontrôleurs. Asterinas est un noyau généraliste Rust à ABI Linux, encore en développement actif : c’est une piste de recherche séparée, pas un remplacement immédiat du noyau WSL.

## Distributions WSL open source avec sources vérifiables

| Distribution / dépôt primaire | Maturité et mode WSL | Noyau requis / intérêt |
|---|---|---|
| [Ubuntu WSL](https://github.com/ubuntu/WSL), [images Canonical](https://releases.ubuntu.com/26.04/) | Base WSL officiellement maintenue par Canonical; image `.wsl` officielle, LTS, support utilisateur large. | Noyau Microsoft partagé sous WSL2. **Meilleure base initiale** si priorité à compatibilité des paquets et outillage de développement. Ubuntu 26.04.1 est sorti le 27 août 2026. |
| [Debian](https://github.com/microsoft/WSL/blob/master/distributions/DistributionInfo.json) | Entrée officielle du manifeste Microsoft Store/`wsl --install`; la ligne pointe vers le paquet Debian publié. Debian elle-même est open source, mais le manifeste WSL n’est pas le code source de la distribution. | Même noyau WSL partagé; base stable/minimale. Alternative solide si Aphrody veut moins de changements qu’Ubuntu. |
| [NixOS-WSL](https://github.com/nix-community/NixOS-WSL) | Projet communautaire actif qui adapte NixOS à WSL et distribue des fichiers `.wsl`; intégration WSL plus spécialisée que le simple import d’un conteneur. | Noyau WSL partagé. **Meilleur exemple d’OS déclaratif/reproductible et de configuration versionnée** à reprendre pour les recettes Aphrody. |
| [Fedora Remix for WSL](https://github.com/WhitewaterFoundry/Fedora-Remix-for-WSL) | Remix communautaire actif, fondé sur Fedora Core et modifié pour WSL; sa propre documentation précise qu’il n’est pas endossé par Fedora/Red Hat. | Noyau WSL partagé. Paquets récents et bon choix pour tester rapidement la chaîne Rust; ne pas confondre ce remix avec une édition officielle Fedora. |
| [ArchWSL](https://github.com/yuk7/ArchWSL) et [son rootfs](https://github.com/yuk7/ArchWSL-FS) | Projet communautaire avec lanceur WSL et système de fichiers Arch; releases vérifiables. Distribution rolling, exigences d’administration plus fortes. | Noyau WSL partagé. Paquets très récents et contrôle fin, mais changements continus : mieux en image de développement secondaire qu’en base stable produit. |
| [Alpine Linux](https://alpinelinux.org/downloads/) | Le projet publie officiellement des mini-rootfs (et Microsoft documente leur import); l’image WSL n’est pas nécessairement le même produit qu’un port/launcher tiers. | Noyau WSL partagé. Petite base musl/BusyBox utile pour les images compactes; moins adaptée à un environnement généraliste complet sans travail d’intégration supplémentaire. |
| [AlmaLinux WSL images](https://github.com/AlmaLinux/wsl-images) | Sources d’images WSL officielles AlmaLinux; publication via le manifeste WSL Microsoft. | Noyau WSL partagé. Option entreprise compatible famille RHEL, moins naturellement centrée sur un poste de compilation Rust. |

Le manifeste Microsoft maintient aussi Ubuntu, Kali, Oracle Linux, SUSE/openSUSE et d’autres entrées. Pour identifier les distributions réellement installables sur une machine donnée, la source d’exécution est `wsl --list --online`; le manifeste GitHub permet d’auditer les URLs et sommes publiées. Un projet WSL communautaire peut utiliser un rootfs officiel sans que le lanceur soit officiellement soutenu par l’éditeur de la distribution.

## Linux avec un bon profil de développement Rust

« Orienté Rust » décrit ici la fraîcheur et l’accès aux outils du langage, pas un noyau écrit en Rust. Toute distribution Linux x86-64 WSL2 prise en charge peut exécuter les toolchains Rust usuelles.

| Base | Atout Rust | Compromis pour Aphrody |
|---|---|---|
| Fedora | Paquets officiels `rust`, `cargo`, `rust-analyzer`; cycles assez récents. | Excellent environnement de développement, mais Fedora Remix WSL est communautaire. |
| Arch Linux | Paquet officiel `rust` proche des dernières versions stables; accès facile à LLVM et outils natifs. | Très à jour, donc davantage de changements à absorber; packaging WSL communautaire. |
| NixOS | Outils et versions épinglables dans des environnements reproductibles; module WSL maintenu par la communauté NixOS. | Modèle d’administration/configuration différent d’apt/dnf; bonne source d’inspiration pour Aphrody build recipes. |
| Ubuntu 26.04.1 | LTS généraliste, paquets système et bibliothèque d’exemples très larges, intégration WSL officielle. Rust peut être fourni par paquets ou toolchain Rustup selon le besoin de versions multiples/nightly. | Paquet distro parfois en retard par rapport au canal Rustup; cela se maîtrise en déclarant la toolchain du projet. |

Pour un compilateur de noyau et d’OS, il est plus important d’épingler explicitement le compilateur Rust, les cibles, les paquets C/C++/LLVM et les sources que de changer de distribution pour obtenir un `rustc` récent. Arch et Fedora montrent les rythmes de paquets; NixOS montre la reproductibilité; Ubuntu donne le socle WSL le plus familier.

## OS principalement écrits en Rust

| Projet primaire | État et portée | Relation à WSL / valeur pour Aphrody |
|---|---|---|
| [Redox OS](https://github.com/redox-os/redox) | OS généraliste microkernel écrit en Rust avec gestionnaire de fenêtres, système de fichiers et applications; le plus complet des OS Rust cités, mais son écosystème et sa compatibilité restent nettement plus petits que Linux. | Ne s’installe pas comme rootfs Linux WSL2 : WSL attend un noyau Linux. À exécuter séparément dans une VM/QEMU ou matériel pris en charge. Candidat à étudier comme OS Aphrody à long terme, pas comme distro WSL. |
| [Theseus](https://github.com/theseus-os/Theseus) | OS expérimental écrit de zéro en Rust; le dépôt annonce explicitement qu’il n’est pas encore mature et le lance dans QEMU. | Ne peut pas remplacer directement le noyau Linux WSL. Intérêt recherche sur isolation, modularité et conception Rust. |
| [Asterinas](https://github.com/asterinas/asterinas) | Noyau généraliste « framekernel » écrit en Rust, ABI compatible Linux; projet actif, support système encore incomplet et une distribution expérimentale existe selon le dépôt. | Pas un rootfs WSL : WSL2 utilise un noyau Linux. Évaluer dans une VM x86-64 séparée, surtout si l’objectif futur est un noyau Linux-compatible écrit en Rust. |
| [Tock OS](https://github.com/tock/tock) | OS/kernel embarqué Rust, mature pour microcontrôleurs Cortex-M et RISC-V avec MPU; pas un OS PC généraliste. | Aucun intérêt comme noyau WSL. Pertinent uniquement pour une cible embarquée Aphrody. |

## Ubuntu 26.04.1 et noyaux : distinction exacte

- Ubuntu 26.04 LTS (Resolute Raccoon) a été publié le 23 avril 2026; le point release 26.04.1 a été publié le 27 août 2026. Canonical publie une image `ubuntu-26.04.1-wsl-amd64.wsl` ainsi que son manifeste. L’image WSL est donc téléchargeable officiellement.
- Ubuntu 26.04 est livré avec le noyau GA **Linux 7.0**. Le numéro précis du paquet évolue avec les mises à jour SRU; il ne faut donc pas figer `7.0.0-xx` sans vérifier l’archive Resolute du jour du build.
- Le noyau WSL2 est distinct : Microsoft publie `microsoft/WSL2-Linux-Kernel`; sa release la plus récente repérée au 1 octobre 2026 est `linux-msft-wsl-6.18.40.1` (publication du 1 août 2026), basée sur Linux 6.18. Un `uname -r` dans n’importe quelle distro WSL2 montre le noyau actif de la VM, pas le noyau d’un paquet Ubuntu de cette distro.
- WSL1 fonctionne comme couche de compatibilité dans Windows et ne démarre pas un noyau Linux par distribution; WSLg concerne WSL2 et s’appuie sur sa distribution système/composants graphiques. La distribution utilisateur n’apporte pas son propre kernel WSLg.

## Architecture conseillée pour Aphrody

1. Maintenir un rootfs Linux Aphrody qui suit une base documentée (Ubuntu LTS pour le premier prototype, ou NixOS comme étude parallèle), avec `/etc/wsl.conf`, `/etc/wsl-distribution.conf`, utilisateur initial et profil Windows Terminal.
2. Construire à part le noyau Microsoft WSL2 épinglé et l’image système WSLg. Le rootfs `.wsl` ne doit embarquer aucun noyau/initramfs. Le noyau personnalisé WSL est une configuration de la VM WSL, partagée, et ne doit pas être traité comme un paramètre privé à chaque distro.
3. Séparer les objectifs : `aphrody-wsl` fabrique et valide `.wsl`; les recettes `kernel` produisent le noyau et VHD de modules; `wslg` construit l’image GUI; une recette d’intégration teste les trois versions compatibles avant installation. Les versions/hashes des sources doivent faire partie des rapports de build.
4. Garder Redox/Theseus/Asterinas dans une cible OS/QEMU indépendante. Remplacer le noyau Linux de WSL par l’un de ces noyaux n’est pas un chemin de distribution WSL pris en charge.

## Sources primaires

- Microsoft Learn, [Build a Custom Linux Distribution for WSL](https://learn.microsoft.com/en-us/windows/wsl/build-custom-distro) — format `.wsl`, manifest, fichiers de configuration, consignes rootfs sans noyau/initramfs.
- Microsoft Learn, [Import any Linux distribution to use with WSL](https://learn.microsoft.com/en-us/windows/wsl/use-custom-distro) et [WSL overview](https://learn.microsoft.com/en-us/windows/wsl/about) — import rootfs et partage kernel/VM sous WSL2.
- Microsoft, [manifest des distributions WSL](https://github.com/microsoft/WSL/blob/master/distributions/DistributionInfo.json) et [sources WSL](https://github.com/microsoft/WSL).
- Canonical, [Ubuntu WSL](https://github.com/ubuntu/WSL), [archives 26.04.1](https://releases.ubuntu.com/26.04/) et [annonce de sortie](https://discourse.ubuntu.com/t/ubuntu-26-04-1-lts-released/86808).
- Canonical Kernel Team, [Ubuntu 26.04 livré avec Linux 7.0](https://discourse.ubuntu.com/t/26-04-lts-resolute-raccoon-shipping-with-the-final-7-0-linux-kernel/80838).
- Microsoft, [releases du noyau WSL2](https://github.com/microsoft/WSL2-Linux-Kernel/releases) et [branche source 6.18](https://github.com/microsoft/WSL2-Linux-Kernel/tree/linux-msft-wsl-6.18.y).
- Microsoft, [guide de build WSLg](https://github.com/microsoft/wslg/blob/main/config/BUILD.md); le système graphique WSLg est une image/distribution système séparée.
- Projets distro : [NixOS-WSL](https://github.com/nix-community/NixOS-WSL), [Fedora Remix](https://github.com/WhitewaterFoundry/Fedora-Remix-for-WSL), [ArchWSL](https://github.com/yuk7/ArchWSL), [AlmaLinux WSL images](https://github.com/AlmaLinux/wsl-images), [Alpine downloads](https://alpinelinux.org/downloads/).
- Paquets Rust maintenus par les distributions : [Fedora Packages: rust](https://packages.fedoraproject.org/pkgs/rust/rust/), [Arch Linux: rust](https://archlinux.org/packages/extra/x86_64/rust/).
- OS Rust : [Redox](https://github.com/redox-os/redox), [Theseus](https://github.com/theseus-os/Theseus), [Asterinas](https://github.com/asterinas/asterinas), [Tock](https://github.com/tock/tock).

## Vérification Context7 et Microsoft Learn

Context7 a résolu la documentation primaire de Redox (`/redox-os/redox`) et le projet NixOS-WSL (`/nix-community/nixos-wsl`). Microsoft Learn a été interrogé puis sa page « Build a Custom Linux Distribution for WSL » a été récupérée intégralement. Pour les dates et numéros de noyau, les releases et annonces des projets Canonical/Microsoft sont les sources déterminantes.
