/** Définition de la commande slash `/tournoi` (enregistrée par PUT sur le serveur configuré). */
export const COMMAND_NAME = "tournoi";
export const REGISTER_PREFIX = "tournoi:register:";

/** Types d'options Discord (doc « Application Commands »). */
const SUB_COMMAND = 1;
const STRING = 3;
const BOOLEAN = 5;
const USER = 6;

export const FORMAT_CHOICES = [
  { name: "Élimination directe", value: "single_elimination" },
  { name: "Double élimination", value: "double_elimination" },
  { name: "Round robin", value: "round_robin" },
  { name: "Ronde suisse", value: "swiss" },
];

export interface CommandDefinition {
  name: string;
  type: 1;
  description: string;
  options: unknown[];
}

/** Les options obligatoires précèdent les facultatives (contrainte Discord). */
export function commandDefinitions(): CommandDefinition[] {
  return [
    {
      name: COMMAND_NAME,
      type: 1,
      description: "Gérer un tournoi Challonge",
      options: [
        {
          type: SUB_COMMAND,
          name: "creer",
          description: "Créer un tournoi et ouvrir les inscriptions (organisateurs)",
          options: [
            {
              type: STRING,
              name: "nom",
              description: "Nom du tournoi",
              required: true,
              max_length: 60,
            },
            { type: STRING, name: "jeu", description: "Jeu joué", max_length: 60 },
            {
              type: STRING,
              name: "format",
              description: "Format du tournoi (défaut : élimination directe)",
              choices: FORMAT_CHOICES,
            },
            {
              type: STRING,
              name: "url",
              description: "Identifiant d'URL : lettres, chiffres et _",
              max_length: 60,
            },
          ],
        },
        {
          type: SUB_COMMAND,
          name: "inscrire",
          description: "S'inscrire au tournoi en cours",
          options: [
            {
              type: STRING,
              name: "pseudo",
              description: "Nom affiché dans le bracket (défaut : ton pseudo Discord)",
              max_length: 60,
            },
          ],
        },
        {
          type: SUB_COMMAND,
          name: "demarrer",
          description: "Lancer le tournoi (organisateurs)",
          options: [
            {
              type: BOOLEAN,
              name: "melanger",
              description: "Tirer les têtes de série au sort avant de lancer",
            },
          ],
        },
        {
          type: SUB_COMMAND,
          name: "score",
          description: "Saisir le score d'un match (organisateurs)",
          options: [
            {
              type: STRING,
              name: "match",
              description: "Lettre du match sur le bracket (A, B…) ou son ID",
              required: true,
            },
            {
              type: STRING,
              name: "score",
              description: "Score joueur1-joueur2, ex. 2-1 (plusieurs manches : 3-1,2-4,3-0)",
              required: true,
            },
            {
              type: USER,
              name: "gagnant",
              description: "Gagnant, si le score ne suffit pas à le désigner",
            },
            { type: BOOLEAN, name: "egalite", description: "Match nul (round robin / suisse)" },
          ],
        },
        {
          type: SUB_COMMAND,
          name: "terminer",
          description: "Clôturer le tournoi et figer le classement (organisateurs)",
        },
        { type: SUB_COMMAND, name: "bracket", description: "Afficher le lien du bracket" },
      ],
    },
  ];
}
