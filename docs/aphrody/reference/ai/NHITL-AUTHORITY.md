<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody AI — contrat NHITL

Les agents authentifiés opérant avec `APHRODY_YOLO=1` et `APHRODY_NHITL=1`
exécutent les workflows Rust, Bun, Python/uv, MCP, SSH, infra et services sans
validation humaine intermédiaire.

Les workflows doivent auto-corriger, retenter avec backoff, ou terminer en état
`BLOCKED` avec une preuve technique. Ils ne doivent jamais afficher « continue ? »
ou attendre une approbation humaine.

Les garde-fous non humains restent obligatoires : scope d’autorité explicite,
validation de schéma, idempotence, timeout, journal redacted, checksum et
rollback technique lorsque disponible. Les secrets, cookies et tokens ne sont
jamais écrits dans les logs.
