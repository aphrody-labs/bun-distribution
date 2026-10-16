<!-- SPDX-License-Identifier: Apache-2.0 -->

# Extension Rust utilisant le SDK précompilé — 7 octobre 2026

L'[exemple Cargo](../../../../apps/aphrody-examples/runtime-rust-extension/README.md) produit
un `cdylib` Rust contre le contrat C du runtime Yolo. Son workspace indépendant
contient un seul paquet, sans dépendance Cargo externe ni crate moteur.
Le SDK natif reste un artefact précompilé fourni au linker.

## Source et commandes

Les cinq fichiers de l'exemple livré correspondent octet pour octet au snapshot
`d04d64d69db270d36c2975929cdd02e18c12d12e`. Les deux tests ont été exécutés sur
`306643d17e38`, avec les mêmes sources de l'exemple.

Les gates utilisent le propriétaire `scripts/build/rust/vps-cargo.ts`, son
`remoteRunScript`, les verrous usine et sccache sur le VPS. Les gates suivants
ont été relancés sur le snapshot déjà transféré, via le transport stdin du
propriétaire, sans nouveau packing Git :

| Gate | Commande Cargo, en complément de `--manifest-path examples/runtime-rust-extension/Cargo.toml --locked` | Résultat |
| --- | --- | --- |
| Tests | `test` | 2 passés, aucun échec ni ignoré |
| Check | `check --all-targets` | Code 0, 0,13 s |
| Clippy strict | `clippy --all-targets -- -D warnings` | Code 0, 0,33 s |
| Bibliothèque dynamique | `build --release` | Code 0, 0,21 s |

`YOLO_RUNTIME_LIB_DIR` désigne le SDK installé du pin `bdc0c91d825c`.
Les tests utilisent aussi son répertoire dans `LD_LIBRARY_PATH`, uniquement
pour le processus concerné. La négociation réelle retourne ABI 1.5.
Le SDK fait 317 728 376 octets ; SHA-256 :
`76137d1e22e705aa7ae38f0d4c4cefeb76a0c03f46b3f54752e44774079659fb`.
Cette empreinte est inchangée après les appels.

Les journaux de compilation ne contiennent que le paquet de l'exemple.
Les durées sont celles de ces invocations sur une fabrique déjà provisionnée ;
elles ne constituent pas un benchmark comparatif ni une mesure de build froid.

## Chargement et ownership vérifiés

L'hôte crée le runtime, le prête à l'extension, puis libère les buffers avec
`yolo_buffer_free`, l'allocateur du SDK. L'extension ne crée ni ne détruit le
runtime. ABI majeure différente ou mineure inférieure à 1.4 sont refusées
par sa négociation ; handle nul et pointeur de sortie nul sont refusés avant
l'appel de ressource.

Le chargement réel de la bibliothèque debug sur le VPS, puis de la bibliothèque
release récupérée et vérifiée sur WSL, réussit. Chaque sonde observe :

- 32 lectures par l'extension et une lecture directe après sa fermeture.
- 33 buffers libérés ; chaque descripteur est remis à zéro par le SDK.
- Un seul fournisseur SDK mappé dans le processus.
- Le runtime hôte reste utilisable après fermeture de l'extension et se détruit
  ensuite avec succès.

L'artefact release Linux x86-64 fait 416 536 octets ; SHA-256 :
`0b1c5f1135141022890e80cf5f2ee6c2cfad8089c20ad0afccc3f35edbfb35b3`.
Il demeure dans le store local de qualification, hors Git. Aucun runtime ou lien
PATH installé n'a été remplacé.

## Limites et traces

Cette preuve qualifie un consommateur Rust du SDK Linux et son emprunt de runtime.
Elle ne qualifie pas un chargeur d'extensions produit, leurs permissions,
Windows/macOS, le rendu desktop, ni tous les teardown et annulations du runtime.
Les autres exigences de `PLAN.md` restent ouvertes.

Deux premiers essais Clippy se sont arrêtés avec le code 3 avant compilation :
la garde usine protégeait une ressource temporaire associée à un processus vivant.
Le gate final passe ; sa sortie conserve un avertissement de cleanup protégé.
Ce reçu ne déclare pas cette réclamation temporaire qualifiée et aucun processus
concurrent n'a été tué.

Les preuves locales ignorées sont dans `.coord/proofs/rust-extension-20261007/` (not in repo) :
`metadata.json`, `sdk-probe.json`, `test.log`, `check.log`, `clippy-final.log`,
`build.log`, `debug-smoke.json`, `release-smoke-wsl.json` et `fetch.log`.
Les jobs finaux partagent le snapshot ci-dessus :
`2026-10-07T19-49-59-053Z-d04d64d69db2-sdk-clippy`,
`2026-10-07T19-50-18-298Z-d04d64d69db2-sdk-check` et
`2026-10-07T19-50-37-959Z-d04d64d69db2-sdk-build`.
