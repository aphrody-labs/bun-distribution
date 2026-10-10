<!-- SPDX-License-Identifier: Apache-2.0 -->
# Installation native Aphrody Web

`bun install` reste volontairement léger dans un checkout source : le hook
`postinstall` ne compile pas de code et ne télécharge pas de gros artefact.
Pour installer l’ensemble du runtime, utiliser :

```bash
aphrody web install --full
```

Le mode complet est idempotent et installe dans le répertoire de données Aphrody Web
(`~/.bxc/vendor` sous Linux/macOS, `%LOCALAPPDATA%\bxc\vendor` sous Windows) :

- Lightpanda pour la plateforme courante ;
- la bibliothèque dynamique précompilée `curl-impersonate` ;
- le workspace Rust en `rust-bridge/target/release` quand le dépôt source est
  présent, ou le pont Rust de la release Aphrody Web sous `bin/native` (not in repo) pour un paquet
  npm sans sources.

Les archives natives sont téléchargées depuis les releases amont et ne sont
jamais exécutées avant vérification de leur présence sur disque. Le chemin du
vendor peut être déplacé avec `BXC_VENDOR_DIR`.
Pour tester un miroir d’artefacts, `BXC_NATIVE_RELEASE_URL` remplace l’URL de
l’archive Rust et `BXC_CURL_DOWNLOAD_URL` celle de curl-impersonate.

## Checkout source

Pour exiger la compilation Rust et faire échouer l’installation si Cargo n’est
pas disponible :

```bash
aphrody web install --full --source
```

`--source` ne télécharge ni Rust, ni Zig, ni CMake, ni un compilateur C++.
Après le build, Aphrody Web signale les outils absents afin que l’environnement puisse
être préparé par le gestionnaire de paquets de la machine. Cela évite qu’une
installation applicative modifie silencieusement le système.

Dans un environnement CI où l’on veut aussi activer le hook de paquet :

```bash
BXC_INSTALL_FULL=1 bun install
```

Le hook reste non bloquant pour les erreurs réseau, comme l’exige le contrat
npm ; les builds natifs déterministes doivent être lancés explicitement par
`aphrody web install --full --source` ou par le workflow de release.

## Résolution des bibliothèques

Les chargeurs FFI cherchent dans cet ordre :

1. un chemin explicite (`BXC_RUST_BRIDGE_LIB` ou
   `LIBCURL_IMPERSONATE_PATH`) ;
2. le répertoire utilisateur Aphrody Web ;
3. les artefacts du checkout source ;
4. les fichiers embarqués dans un exécutable standalone.

Le port CDP 9222, les profils, cookies et données de crawl ne sont pas
concernés par cette installation et restent privés.
