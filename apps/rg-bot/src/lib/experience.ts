/**
 * Niveaux de communauté — RÉEXPORT du contrat partagé.
 *
 * ── POURQUOI CE MODULE A DÉMÉNAGÉ ──────────────────────────────────────────
 * La courbe d'expérience est celle du JEU (`inagle_exp_table`, cent paliers), et
 * elle a maintenant deux lecteurs : le bot, qui la fait gagner, et le SITE, qui
 * l'affiche sur la carte de joueur du profil public. Recopier une table de cent
 * valeurs et quatre rangs dans la seconde surface, c'était garantir qu'un jour
 * le niveau affiché sur le web diffère de celui annoncé sur Discord — sur la
 * seule donnée que les membres comparent entre eux.
 *
 * Le module est PUR (aucune E/S, aucun `discord.js`) : il vit donc dans
 * `@rosegriffon/types`, comme le schéma des réglages avant lui. Ce fichier reste
 * en place parce que huit modules du bot l'importent par ce chemin.
 */
export {
  CUMULS,
  GAIN_DEFAUT,
  gainDeMessage,
  jetonsDeMontee,
  meriteAnnonce,
  messageEligible,
  NIVEAU_MAX,
  niveauPour,
  niveauxFranchis,
  PALIERS_EXPERIENCE,
  prochainRang,
  progression,
  RANGS,
  rangDe,
  XP_NIVEAU_MAX,
  xpPourAtteindre,
  type Progression,
  type Rang,
  type ReglesGain,
} from "@rosegriffon/types/experience";
