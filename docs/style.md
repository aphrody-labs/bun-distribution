# Upstream conventions

Identité Aphrody/Bun concise. Les sources importées gardent leurs licences et
conventions. Ces références gouvernent le code écrit dans ce dépôt.

| Périmètre      | Règles                                                                                   | Source                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript     | Deux espaces, 120 colonnes, virgules finales, parenthèses minimales pour les flèches     | `bun fmt` natif et `bunfmt.json`                                                                                                           |
| Rust           | rustfmt stable, ownership et nettoyage explicites, imports groupés par module            | [Kernel Rust](https://docs.kernel.org/rust/coding-guidelines.html), [COSMIC](https://github.com/pop-os/libcosmic/blob/master/rustfmt.toml) |
| C              | Tabs et accolades kernel, flux de contrôle court, fonctions ciblées                      | [Linux kernel](https://docs.kernel.org/process/coding-style.html)                                                                          |
| Sources/builds | Dépendances indépendantes, révisions exactes, notices conservées, builds non interactifs | [Debian Policy](https://www.debian.org/doc/debian-policy/ch-source.html)                                                                   |

Utilise les retours anticipés et le nettoyage partagé. Les commentaires
expliquent les contraintes d’ownership. `.editorconfig`, `bunfmt.json` et
rustfmt imposent le formatage. Les contrôles JavaScript utilisent directement
`bun check`, `bun lint`, `bun fmt` et `bun n2b` du runtime natif.

Références examinées avec `aphrody docs`, `aphrody awesome` et l’ingestion Git
distante ciblée. L’ingestion locale appartient au MCP Bun de ce runtime. Cette
convention ne certifie ni les paquets Debian ni les binaires natifs reproductibles.
