export enum ClanMemberRole {
  Trial,
  Member,
  SubCaptain,
  Captain,
}

// Les libellés d'affichage vivent dans `@rosegriffon/achillea-core/labels`
// (`CLAN_MEMBER_ROLE_LABELS`) : le contrat décrit des données échangées, pas du
// texte destiné à un humain — sinon il cesse d'être traduisible mécaniquement.

export enum ClanMemberDistinction {
  Player = "Joueur",
  Staff = "Staff",
  Artist = "Artiste",
  ContentCreator = "Créateur de contenu",
}
