<!-- SPDX-License-Identifier: Apache-2.0 -->
# Agent Home : profils, espaces et sessions

Ce document décrit comment organiser le contexte durable d'un agent Aphrody.
Le générateur des inventaires locaux est
[`agent-home.ts`](../../../packages/infra/workspace/src/agent-home.ts) ; les
fichiers d'amorçage sont intégrés dans
[`onboard.rs`](../../../crates/ai/agent-home/src/onboard.rs) depuis
`plugins/aphrody/home`.

## Modèle de portée

| Élément | Contenu | Portée et règle |
| --- | --- | --- |
| Profil | Configuration d'un domaine (`aphrody`, `dbfr`, `ie`) | Isolé des autres domaines |
| Espace de travail | Instructions, identité, préférences et mémoire curatée | Un espace actif par profil |
| Session | Échange natif d'un agent | Reste dans le store de cet agent |
| Dépôt | Code, docs et règles locales du projet | Le dépôt courant fait autorité pour la tâche |

Le cwd indique le projet de travail ; il ne définit pas le profil et ne prouve
pas l'identité d'une session. Les miroirs de session ne sont exploitables que
si leur marqueur de domaine est présent. Les associations historiques fondées
sur le cwd ou l'heure sont des candidates, pas une attribution certaine.

## Fichiers de l'espace

| Fichier | Rôle | Durée |
| --- | --- | --- |
| `AGENTS.md` | Règles durables, périmètre et méthode | Long terme, révisé avec les règles |
| `SOUL.md` | Ton, personnalité et limites | Long terme |
| `IDENTITY.md` | Nom et description courte de l'agent | Long terme |
| `USER.md` | Préférences stables de l'utilisateur | Long terme, sans journal quotidien |
| `TOOLS.md` | Outils détectés et routage local | Généré ou actualisé depuis l'état installé |
| `BOOT.md` | Vérifications courtes au début d'une session | Exécuté à chaque démarrage concerné |
| `BOOTSTRAP.md` | Configuration de première utilisation | Ponctuel, retiré après configuration |
| `MEMORY.md` | Index curaté de faits, décisions et procédures utiles | Long terme, privé au profil |
| `memory/YYYY-MM-DD.md` | Notes datées récupérables à la demande | Historique du profil |
| `sessions/<agent>/` | Sessions natives ou miroir prévu par l'outil | Privé, ne pas éditer comme de la mémoire |

Ne duplique pas un même fait dans plusieurs couches : mets les préférences dans
`USER.md`, les règles dans `AGENTS.md`, les faits durables dans `MEMORY.md`, et
les détails temporaires dans une note datée. Les documents de projet et leurs
instructions restent dans leur dépôt. Ne copie pas les corpus ou les secrets
dans le profil.

## Conventions Markdown

- Utiliser UTF-8, fins de ligne LF, une ligne vide entre blocs et aucun espace
  de fin de ligne.
- Mettre un seul titre `#` au début, puis des titres hiérarchiques sans saut de
  niveau.
- Garder le frontmatter YAML valide et limité aux champs lus par le parseur.
- Préférer des listes courtes et des tableaux uniquement pour comparer des
  champs de même nature.
- Écrire les chemins du dépôt en liens relatifs vérifiables ; ne pas inclure
  de chemin machine, secret, identifiant de session ou extrait de conversation.
- Dater les notes volatiles et marquer explicitement ce qui est observé,
  inféré ou à vérifier.

## Pratiques recoupées

- OpenClaw distingue les fichiers d'amorçage, les notes quotidiennes et la
  mémoire curatée, et recommande un espace par agent :
  [Agent workspace](https://docs.openclaw.ai/agent-workspace) et
  [Agent runtime](https://docs.openclaw.ai/concepts/agent).
- Hermes Agent isole la mémoire, les sessions et la configuration par profil ;
  ses fichiers de mémoire sont bornés :
  [Persistent Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory)
  et [Profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles).

Ces modèles externes éclairent l'organisation ; les contrats effectifs sont
ceux du parseur Aphrody, du générateur et des règles du dépôt courant.
