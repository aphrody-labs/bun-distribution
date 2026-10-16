/**
 * Catalogue des tâches de `rg-cron.service` — RÉEXPORT du contrat partagé.
 *
 * ── POURQUOI CE FICHIER NE CONTIENT PLUS LA LISTE ──────────────────────────
 * Elle vivait ici et elle était FAUSSE : dix-huit tâches là où le démon en sert
 * vingt-deux. `noctaly:import`, `campagnes:discord`, `campagnes:instagram` et
 * `campagnes:relais` existent dans `runnerMap` et répondent parfaitement en
 * HTTP, mais `/cron lancer` répondait « tâche inconnue » — parce que
 * `resoudreTache` ne les trouvait pas dans une liste recopiée à la main.
 *
 * Le catalogue est maintenant unique, dans `@rosegriffon/types/cron`, et il
 * porte en plus ce dont l'interface du site a besoin : libellé, famille, durée
 * indicative et MOTIF d'interdiction. Une interdiction sans motif finit
 * toujours par être levée « parce qu'on ne sait plus pourquoi elle était là ».
 *
 * Ce module reste en place pour les imports existants de `apps/bot`.
 */
export {
	CATALOGUE_TACHES,
	decrireTache,
	niveauTache,
	normaliserNomTache,
	peutDeclencher,
	PLANIFICATIONS,
	raisonRefus,
	resoudreTache,
	suggererTaches,
	TACHES_ADMIN,
	TACHES_ADMIN_STRICT,
	TACHES_CRON,
	TACHES_INTERDITES,
	VERBES_LECTURE,
	type DescriptionTache,
	type NiveauTache,
	type TacheCron,
} from "@rosegriffon/types/cron";
