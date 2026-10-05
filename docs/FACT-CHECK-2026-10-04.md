<!-- SPDX-License-Identifier: Apache-2.0 -->
# Fact-check du 2026-10-04

Ce relevé examine les affirmations du texte fourni et les prérequis du
[plan producteur](../PLAN.md). Le [reçu JSON](fact-check-2026-10-04.json)
conserve résultats, commandes et limites. Les observations ont été prises dans
la nuit du 3 au 4 octobre (horodatages UTC dans le reçu).

## Preuves acquises

- Dispatcher MCP Aphrody via le CLI propriétaire `aphrody-kernel` : lectures
  du contrat ABI et du manifest A2A ; service kernel actif, PID 331 ; outil
  `workspace_build_factory_status` route vers `vps`.
- Diagnostics OS : 14 sous-systèmes et 166 outils WinClean, ABI 1.0.0-canary.
  Il s'agit d'un inventaire, pas d'une qualification de chaque outil Windows.
- Versions Windows réellement exécutées : Rust/Cargo 1.99.0, Bun 1.4.2 ;
  Visual Studio Build Tools localisé par vswhere sous Program Files (x86).
- Dix gates locaux réussis sur `7e545c549c54` : whitespace, TypeScript, lint,
  format, tests Bun, rustfmt, mdBook, imports, lint Python et pytest.
  Clippy, nextest, workspace check, deny et runtime-test ne sont pas exécutés.
- Quatre tests Bun privilege réussis, huit assertions. Le cœur Rust contient
  neuf tests dans les sources, dont deux privilege ; exécution Rust non requalifiée.
- Quatre hashes de la release locale 0.1.0 concordent. Manifest ABI 1.3 et
  révision `ee1a466528fd` : aucune qualification de HEAD ou ABI 1.4 déduite.

## Corrections du texte

La détection POSIX utilise geteuid. Les sondes sudo et Windows sont synchrones
et sans timeout ; `sudo -n` évite la demande de mot de passe mais ne démontre
pas une absence de blocage. Aucune mesure ne justifie « zéro latence ».
Windows utilise `net session` ; aucun appel token/UAC dans la couche observée.
L'enveloppe Windows retourne la commande inchangée et ne l'élève pas.

Les six pairs A2A sont résolus avec des URLs nulles. Aucun listener 8788 local
n'était observé ; aucun broadcast n'a été envoyé pendant la vérification.
Le manifest ne prouve ni fédération opérationnelle ni réception.

`aphrody shell status` affiche des constantes. Nushell installé retourne
0.116.0 ; ce statut ne prouve pas l'activité du bridge PTY.
Le statut runtime détecte CUDA et les exécutables ; il ne prouve pas la
synchronisation MCP ni une inférence. Le build MSVC et le check complet Aphrody
annoncés restent non requalifiés par ce relevé.

[setuid(2)](https://www.man7.org/linux/man-pages/man2/setuid.2.html) autorise aussi,
sous ses règles, la sélection d'un UID réel ou sauvegardé ; CAP_SETUID dépend
du namespace utilisateur. [Polkit](https://polkit.pages.freedesktop.org/polkit/polkit.8.html)
applique une politique et peut demander une authentification.
[Windows](https://learn.microsoft.com/en-us/windows/win32/secbp/running-with-administrator-privileges)
distingue inspection de token et déclenchement d'une élévation.

## Travail restant

La fabrique pointe toujours vers un hôte déclaré execution-only. Aucun hôte
remplaçant qualifié n'a été désigné. Les providers desktop/browser sont réservés ;
JSC/parité V8, ownership Windows et distribution cinq cibles restent ouverts.
Le périmètre courant exclut src, crates, packages et apps ; ces implémentations
ne peuvent pas être fermées par ce lot documentaire/opérationnel.
Les anciens succès restent datés ; aucun jalon n'est déclaré achevé sans son gate.

Les lectures Actions et releases via `aphrody git api` retournent HTTP 404.
Ce client ne permet donc pas de requalifier leur état courant ; ce résultat
ne prouve ni suppression du dépôt ni absence de releases.
