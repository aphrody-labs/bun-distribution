<!-- SPDX-License-Identifier: Apache-2.0 -->
# Audit Infra du 1 octobre 2026

Cet audit vérifie Aphrody Infra Rust et Bun, WSL, VPS et dbfr, avec des contrôles Python et IECODE bornés. **Le déploiement complet du monorepo reste non démontré.** Aucun build Cargo ou Next, navigateur, crawler, déploiement ni écriture SQL n’a été effectué.

Le [snapshot monorepo](current-report.json) conserve **105 contrôles : 87 réussis et 18 échoués**, avec 131 contrôles différés et 199 gates manquantes. Il inventorie 185 crates Rust, dont 7 Infra, 85 packages Bun, 181 fichiers source Infra et 849 scripts. Les modules et features inventoriés ne constituent pas une couverture exécutée.

Après ce snapshot, le typecheck OVH a été corrigé ; les typechecks Infra workspace et OVH passent en `--noEmit`. Les [tests Infra finaux](completion-tests.log) donnent **191 réussites, 1 échec et 1 ignoré**, soit 193 tests et 760 assertions. L’échec restant concerne `apps/shenron/bot/package.json` : `drizzle-orm` doit reprendre `catalog:` sous le claim du lead SQL. Les quatre autres manifestes ont été corrigés ; les 3341 packages résolus du lock restent identiques. Ces réparations ne réécrivent pas les 18 échecs du snapshot.

Le lint Infra retourne 0 avec ses avertissements conservés. Après une première passe réussie, le [dernier formatage des 112 fichiers du périmètre corrigé](completion-owned-format.log) conserve un défaut dans `workspace-layout.ts`, modifié concurremment ; le [contrôle élargi](completion-format.log) signale encore 13 fichiers, notamment les sources détenues par le lead SQL et la documentation importée. Vingt tests Rust Git passent via un binaire déjà présent ; les sources Rust modifiées n’ont pas été compilées ni qualifiées.

Les observations réelles confirment PostgreSQL, Redis et les quick checks SQLite sur VPS/dbfr. VPS reste en échec pour la readiness Shenron HTTP **404** ; le téléchargement d’un objet Supabase WSL retourne **500**. Neon accepte les requêtes read-only et contient **0 table utilisateur**, état intentionnel avant les migrations : cette connexion ne qualifie pas le schéma de production. Les sauvegardes, restaurations et retraits de bases restent sous ownership SQL. Voir [le rapport du plan de données](rg-data-plane-audit.json).

Les [preuves Python et IECODE](python-iecode-audit.json) conservent les résultats suivants : SDK Python 490 réussites, autres suites 61, IECODE Python 125 ; le SDK Antigravity intégré présente 11 échecs et Ruff 24 diagnostics. Python utilise SQLite 3.45.1, inférieur au minimum 3.51.3 du contrat SQL. Les checks légers IECODE passent, mais la suite Bun agrégée conserve 3 échecs et une erreur ; le défaut de sélection du miroir SQLite est reproduit isolément. Les deux timeouts de swap passent isolément, sans cause établie. Aucun transfert de code ou de données IEVR n’a été effectué par cet audit.

Le [LCOV final](coverage-completion.lcov.info), dont les compteurs ont été vérifiés, mesure uniquement **43 fichiers Bun importés** : 5405/10904 lignes (49.57 %) et 623/829 fonctions (75.15 %). Il couvre 42 fichiers source `packages/infra` et `scripts/check-infra.ts`, sans couverture de Rust ni du monorepo entier.

La [notation objective précédente](../deployability-audit-2026-10-01.json) reste **3 sur 10 globalement**, séparée par Rust, Bun, Python, apps, libs, Infra, GitHub, remotes Git, organisation et packages npm, compte crates.io et registre Cargo. Ce suivi ne remplace pas cette note et ne démontre pas un déploiement depuis un clone propre.

[summary.json](summary.json) contient les commandes, timestamps, SHA256 des artefacts et limites ; [completion-results.json](completion-results.json) conserve les exit codes exacts du lead. Les snapshots sont conservés sans écrasement ; le [suivi du contrat Bun](bun-contract-followup.json) omet les enveloppes de coordination brutes. Les identités d’objets sensibles sont masquées dans les preuves et aucun fichier privé d’environnement n’a été lu pour cet archivage.
