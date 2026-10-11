<!-- SPDX-License-Identifier: Apache-2.0 -->
# WinClean live artifacts

`scripts/tools/os/scripts/live-winclean-artifacts.ts` localise par défaut le binaire GUI ChatGPT
de l'installation MSIX `OpenAI.Codex` (`app/ChatGPT.exe`), exécute le noyau compilé
sur Windows réel et écrit les résultats dans `var/winclean-live/latest` (not in repo) ainsi que
dans un répertoire de session horodaté. Ce n'est pas un dry-run : les appels passent
par le named pipe du kernel et les opérations d'analyse lisent le binaire installé.

```powershell
bun scripts/tools/os/scripts/live-winclean-artifacts.ts
```

Le manifeste `manifest.json` décrit le binaire cible, le producteur, les consommateurs, les transports
et l'owner Rust de chaque artefact. Les fichiers `binary-*.json` sont produits par les
handlers `aphrody-re`; `os-info.json` vérifie le backend Windows WinClean réel.

`a2a-codex-gui-electron.json` est l'enveloppe A2A `codex-gui-electron` issue du même
appel `binary_hash_multi`. Elle peut être consommée directement par un client Codex,
la GUI Electron ou un importeur Aphrody sans relancer l'analyse.

Schéma stable : `aphrody.winclean.live.v1`. Les valeurs instables (machine, utilisateur,
horodatage et chemins) restent dans les artefacts ; les hashes et DTO d'analyse sont
directement réutilisables pour une comparaison ou une vue GUI.
