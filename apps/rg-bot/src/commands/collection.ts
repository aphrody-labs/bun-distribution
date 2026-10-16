/**
 * `/collection` et `/personnaliser` — recruter des joueurs, les afficher.
 *
 * ── CE QUE LE MEMBRE ACHÈTE VRAIMENT ───────────────────────────────────────
 * Rien qui donne un avantage. Ni XP, ni rôle, ni place au classement : la
 * collection est un objet de fierté, pas une piste de progression parallèle. Un
 * membre qui ne recrute jamais n'est jamais derrière celui qui recrute tous les
 * jours — c'est la condition pour qu'une économie interne ne devienne pas une
 * taxe sur ceux qui n'y jouent pas.
 *
 * ── LES DEUX CHOSES QUI SE PAIENT ──────────────────────────────────────────
 *   - un RECRUTEMENT : un joueur tiré au sort parmi les 6 090 nommés du jeu,
 *     à égalité de chances (cf. `lib/collection.ts` — le taux n'est pas décidé
 *     par nous, il est celui du jeu) ;
 *   - une PLAQUE DE NOM : le fond de la carte de profil, parmi les 54 plaques
 *     réelles d'Inazuma Eleven Victory Road.
 *
 * ── L'ARGENT PART AVANT LE TIRAGE ──────────────────────────────────────────
 * Le débit, le tirage et l'inscription à l'inventaire sont UNE transaction
 * (`services/communaute.tirage`). L'ordre compte : tirer puis débiter
 * laisserait, sur une panne entre les deux, un joueur ajouté gratuitement — et
 * l'erreur ne se verrait jamais.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type User,
} from "discord.js";

import { getCharacterFaceUrl, resolveAssetUrl } from "@rosegriffon/azalee";

import { formaterJetons, verifierDepense } from "../lib/kizuna";
import { CASES_PAR_CARTE, renderCarteCollection, renderCarteTirage } from "../lib/canvas/communaute";
import { libelleCompletion, ordreRarete, rareteDe, resumerCollection, TARIFS } from "../lib/collection";
import {
  acheter,
  equiper,
  fichesPersonnages,
  inventaireDe,
  personnagesPossedes,
  plaques,
  possede,
  prochainTirageGaranti,
  profilDe,
  tirage,
  totalPersonnages,
} from "../services/communaute";
import {
  attention,
  borner,
  differer,
  differerEnPrive,
  echec,
  entierLisible,
  fiche,
  info,
  piedDeCommande,
  repondre,
  succes,
  vide,
} from "../lib/ui";

const HORS_GUILDE = "Cette commande n'a de sens que sur un serveur : la collection est propre à chaque communauté.";

/** URL de portrait exploitable, ou `null` (la lib rend un chemin local de repli). */
function portraitDe(code: string | null): string | null {
  if (!code) {
    return null;
  }
  const url = getCharacterFaceUrl(code);
  return url.startsWith("http") ? url : null;
}

// ─── Autocomplétions ────────────────────────────────────────────────────────

/**
 * Les joueurs de SA collection — jamais le catalogue entier.
 *
 * Proposer les 6 090 joueurs du jeu ferait choisir un favori qu'on ne possède
 * pas, et l'appel échouerait ensuite sans que le membre comprenne pourquoi. La
 * liste proposée est donc exactement la liste des choix valables.
 */
async function completerFavori(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.respond([]);
      return;
    }
    const saisie = String(interaction.options.getFocused() ?? "").toLowerCase();
    const collection = await personnagesPossedes(guildId, interaction.user.id);
    const retenus = collection
      .filter(joueur => saisie.length === 0 || joueur.nom.toLowerCase().includes(saisie))
      .toSorted((a, b) => ordreRarete(b.rarete) - ordreRarete(a.rarete))
      .slice(0, 25);
    await interaction.respond(
      retenus.map(joueur => ({
        name: borner(`${joueur.nom} · ${rareteDe(joueur.rarete).nom}`, 100),
        value: joueur.id,
      })),
    );
  } catch {
    // Une autocomplétion qui lève laisse le champ bloqué en « chargement ».
    await interaction.respond([]).catch(() => undefined);
  }
}

/** Les plaques possédées — même règle que pour les joueurs. */
async function completerPlaquePossedee(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.respond([]);
      return;
    }
    const saisie = String(interaction.options.getFocused() ?? "").toLowerCase();
    const [catalogue, inventaire] = await Promise.all([
      plaques(),
      inventaireDe(guildId, interaction.user.id, "plaque"),
    ]);
    const possedees = new Set(inventaire.map(entree => entree.objetId));
    const retenus = catalogue
      .filter(plaque => possedees.has(plaque.id))
      .filter(plaque => saisie.length === 0 || String(plaque.rang).includes(saisie))
      .slice(0, 25);
    await interaction.respond(retenus.map(plaque => ({ name: `Plaque n° ${plaque.rang}`, value: plaque.id })));
  } catch {
    await interaction.respond([]).catch(() => undefined);
  }
}

/** Les plaques ACHETABLES — celles qu'on n'a pas encore. */
async function completerPlaqueAAcheter(interaction: AutocompleteInteraction): Promise<void> {
  try {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.respond([]);
      return;
    }
    const saisie = String(interaction.options.getFocused() ?? "").toLowerCase();
    const [catalogue, inventaire] = await Promise.all([
      plaques(),
      inventaireDe(guildId, interaction.user.id, "plaque"),
    ]);
    const possedees = new Set(inventaire.map(entree => entree.objetId));
    const retenus = catalogue
      .filter(plaque => !possedees.has(plaque.id))
      .filter(plaque => saisie.length === 0 || String(plaque.rang).includes(saisie))
      .slice(0, 25);
    await interaction.respond(
      retenus.map(plaque => ({
        name: borner(`Plaque n° ${plaque.rang} — ${entierLisible(plaque.prix)} pts`, 100),
        value: plaque.id,
      })),
    );
  } catch {
    await interaction.respond([]).catch(() => undefined);
  }
}

@Discord()
@SlashGroup({
  description: "Recruter des joueurs d'Inazuma Eleven avec tes jetons Kizuna",
  name: "collection",
})
@SlashGroup("collection")
export class CollectionCommand {
  @Slash({ description: "Les joueurs que tu as recrutés", name: "voir" })
  async voir(
    @SlashOption({
      description: "Le membre dont tu veux voir la collection (toi par défaut)",
      name: "membre",
      required: false,
      type: ApplicationCommandOptionType.User,
    })
    membre: User | undefined,
    @SlashOption({
      description: "Page de la grille (24 joueurs par page)",
      maxValue: 300,
      minValue: 1,
      name: "page",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    page: number | undefined,
    @SlashOption({
      description: "Afficher la collection dans le salon (privé par défaut)",
      name: "partager",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    partager: boolean | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differer(interaction, { prive: partager !== true });
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
      return;
    }
    const cible = membre ?? interaction.user;
    try {
      const [collection, recense] = await Promise.all([personnagesPossedes(guildId, cible.id), totalPersonnages()]);
      if (collection.length === 0) {
        await repondre(
          interaction,
          vide(
            "Collection vide",
            cible.id === interaction.user.id
              ? `Ta collection est vide. \`/collection recruter\` en ouvre une pour ${entierLisible(TARIFS.tirage)} jetons Kizuna.`
              : `${cible.displayName} n'a encore recruté personne.`,
          ),
        );
        return;
      }

      const resume = resumerCollection(
        collection.map(joueur => ({ objetId: joueur.id, rarete: joueur.rarete })),
        recense,
      );

      // La page demandée, du plus rare au plus commun — c'est l'ordre dans
      // lequel on regarde une collection, et le seul qui rende la grille
      // lisible d'un coup d'œil.
      const trie = collection.toSorted(
        (a, b) => ordreRarete(b.rarete) - ordreRarete(a.rarete) || a.nom.localeCompare(b.nom, "fr"),
      );
      const pages = Math.max(1, Math.ceil(trie.length / CASES_PAR_CARTE));
      const numero = Math.min(pages, Math.max(1, Math.floor(page ?? 1)));
      const tranche = trie.slice((numero - 1) * CASES_PAR_CARTE, numero * CASES_PAR_CARTE);

      const image = await renderCarteCollection(
        cible.displayName,
        tranche.map(joueur => ({
          element: joueur.element,
          nom: joueur.nom,
          portraitUrl: portraitDe(joueur.code),
          rarete: joueur.rarete,
        })),
        {
          completion: libelleCompletion(resume, recense),
          note: `${entierLisible(collection.length)} joueur${collection.length > 1 ? "s" : ""} recruté${collection.length > 1 ? "s" : ""}`,
        },
      );

      // Le décompte par rareté reste en texte : c'est ce qu'on compare entre
      // deux membres, et une image ne se lit pas par un lecteur d'écran.
      const carte = fiche({
        description: libelleCompletion(resume, recense),
        icone: "collection",
        titre: `Collection de ${cible.displayName}`,
      });
      for (const entree of resume.parRarete.toReversed()) {
        carte.champ(entree.rarete.nom, entierLisible(entree.nombre), { enLigne: true });
      }

      await interaction.editReply({
        embeds: [piedDeCommande(carte.embed, interaction, { page: numero, pages })],
        files: [new AttachmentBuilder(image, { name: `collection-${cible.id}.png` })],
      });
    } catch (err) {
      await repondre(interaction, echec("Collection illisible", err instanceof Error ? err.message : String(err)));
    }
  }

  @Slash({
    description: `Recruter un joueur au hasard (${TARIFS.tirage} jetons Kizuna)`,
    name: "recruter",
  })
  async recruter(
    @SlashOption({
      description: "Montrer la prise dans le salon (privé par défaut)",
      name: "partager",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    partager: boolean | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differer(interaction, { prive: partager !== true });
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
      return;
    }

    try {
      const profil = await profilDe(guildId, interaction.user.id);
      const paiement = verifierDepense(profil.jetons, TARIFS.tirage);
      if (!paiement.ok) {
        await repondre(interaction, attention("Pas assez de jetons Kizuna", paiement.erreur, { prive: true }));
        return;
      }

      const garantie = await prochainTirageGaranti(guildId, interaction.user.id);
      const resultat = await tirage(guildId, interaction.user.id, {
        garantie,
        prix: TARIFS.tirage,
      });
      if (!resultat) {
        await repondre(
          interaction,
          echec(
            "Tirage impossible",
            "Le catalogue de joueurs est vide — c'est un problème de données, pas de ton côté.",
          ),
        );
        return;
      }

      const solde = paiement.soldeApres + (resultat.doublon ? resultat.rembourse : 0);
      const image = await renderCarteTirage({
        doublon: resultat.doublon,
        element: resultat.personnage.element,
        garanti: resultat.garanti,
        nom: resultat.personnage.nom,
        portraitUrl: portraitDe(resultat.personnage.code),
        position: resultat.personnage.position,
        rarete: resultat.personnage.rarete,
        rembourse: resultat.rembourse,
        solde,
      });

      const rarete = rareteDe(resultat.personnage.rarete);
      const carte = fiche({
        description: resultat.doublon
          ? `Déjà dans ta collection — ${formaterJetons(resultat.rembourse)} rendus.`
          : "Nouveau dans ta collection.",
        icone: "collection",
        intention: rarete.remarquable ? "succes" : "marque",
        titre: `${resultat.personnage.nom} — ${rarete.nom}`,
      });
      carte
        .champ("Solde", formaterJetons(solde), { enLigne: true })
        .champ(
          "Prochain garanti",
          (await prochainTirageGaranti(guildId, interaction.user.id))
            ? "le prochain tirage ne peut pas être un joueur Normal"
            : "au dixième tirage",
          { enLigne: true },
        );

      await interaction.editReply({
        embeds: [piedDeCommande(carte.embed, interaction)],
        files: [new AttachmentBuilder(image, { name: "recrutement.png" })],
      });
    } catch (err) {
      await repondre(interaction, echec("Recrutement impossible", err instanceof Error ? err.message : String(err)));
    }
  }

  @Slash({ description: "Les plaques de nom en vente", name: "plaques" })
  async listePlaques(
    @SlashOption({
      description: "Page de la liste (12 par page)",
      maxValue: 5,
      minValue: 1,
      name: "page",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    page: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
      return;
    }
    try {
      const [catalogue, inventaire, profil] = await Promise.all([
        plaques(),
        inventaireDe(guildId, interaction.user.id, "plaque"),
        profilDe(guildId, interaction.user.id),
      ]);
      const possedees = new Set(inventaire.map(entree => entree.objetId));

      const parPage = 12;
      const numero = Math.max(1, Math.floor(page ?? 1));
      const pages = Math.max(1, Math.ceil(catalogue.length / parPage));
      const tranche = catalogue.slice((numero - 1) * parPage, numero * parPage);

      const carte = fiche({
        description:
          `${entierLisible(catalogue.length)} plaques du jeu, ${entierLisible(possedees.size)} à toi. ` +
          `Tu as ${formaterJetons(profil.jetons)}.`,
        icone: "collection",
        titre: "Plaques de nom",
      });
      for (const plaque of tranche) {
        carte.champ(
          `Plaque n° ${plaque.rang}`,
          possedees.has(plaque.id) ? "✅ possédée" : `${entierLisible(plaque.prix)} pts — \`/collection acheter\``,
          { enLigne: true },
        );
      }
      await interaction.editReply({
        embeds: [piedDeCommande(carte.embed, interaction, { page: numero, pages })],
      });
    } catch (err) {
      await repondre(interaction, echec("Catalogue illisible", err instanceof Error ? err.message : String(err)));
    }
  }

  @Slash({ description: "Acheter une plaque de nom", name: "acheter" })
  async acheterPlaque(
    @SlashOption({
      autocomplete: completerPlaqueAAcheter,
      description: "La plaque à acheter",
      name: "plaque",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    plaqueId: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
      return;
    }
    try {
      const catalogue = await plaques();
      const plaque = catalogue.find(entree => entree.id === plaqueId);
      if (!plaque) {
        await repondre(
          interaction,
          echec("Plaque inconnue", "Choisis-la dans la liste proposée par l'autocomplétion."),
        );
        return;
      }

      const profil = await profilDe(guildId, interaction.user.id);
      const paiement = verifierDepense(profil.jetons, plaque.prix);
      if (!paiement.ok) {
        await repondre(interaction, attention("Pas assez de jetons", paiement.erreur, { prive: true }));
        return;
      }

      const achat = await acheter(guildId, interaction.user.id, "plaque", plaque.id, plaque.prix);
      if (!achat) {
        await repondre(
          interaction,
          info("Déjà à toi", "Tu possèdes déjà cette plaque : rien n'a été débité.", {
            prive: true,
          }),
        );
        return;
      }

      // Équiper dans la foulée : personne n'achète une plaque pour ne pas la
      // porter, et une seconde commande pour ça serait une friction gratuite.
      await equiper(guildId, interaction.user.id, "plaque", plaque.id);
      const carte = fiche({
        description: `Elle est posée en fond de ta carte de profil. Solde : ${formaterJetons(achat.solde)}.`,
        icone: "collection",
        image: plaque.cheminImage ? resolveAssetUrl(plaque.cheminImage) : null,
        intention: "succes",
        titre: `Plaque n° ${plaque.rang} achetée`,
      });
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Achat impossible", err instanceof Error ? err.message : String(err)));
    }
  }
}

@Discord()
@SlashGroup({
  description: "Ce que ta carte de profil affiche",
  name: "personnaliser",
})
@SlashGroup("personnaliser")
export class PersonnaliserCommand {
  @Slash({ description: "Le joueur affiché sur ta carte de profil", name: "favori" })
  async favori(
    @SlashOption({
      autocomplete: completerFavori,
      description: "Un joueur de ta collection (laisse vide pour l'enlever)",
      name: "joueur",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    joueurId: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
      return;
    }
    try {
      if (!joueurId) {
        await equiper(guildId, interaction.user.id, "perso_favori", null);
        await repondre(interaction, succes("Joueur fétiche retiré", "Ta carte n'en affiche plus.", { prive: true }));
        return;
      }
      if (!(await possede(guildId, interaction.user.id, "perso", joueurId))) {
        await repondre(
          interaction,
          echec(
            "Pas dans ta collection",
            "Tu ne peux afficher qu'un joueur que tu as recruté. `/collection recruter` en ajoute un.",
          ),
        );
        return;
      }
      const [joueur] = await fichesPersonnages([joueurId]);
      await equiper(guildId, interaction.user.id, "perso_favori", joueurId);
      await repondre(
        interaction,
        succes("Joueur fétiche posé", `**${joueur?.nom ?? "Joueur"}** apparaît désormais sur ta carte de profil.`, {
          miniature: portraitDe(joueur?.code ?? null),
          prive: true,
        }),
      );
    } catch (err) {
      await repondre(interaction, echec("Changement impossible", err instanceof Error ? err.message : String(err)));
    }
  }

  @Slash({ description: "La plaque de nom en fond de ta carte", name: "plaque" })
  async plaque(
    @SlashOption({
      autocomplete: completerPlaquePossedee,
      description: "Une plaque de ta collection (laisse vide pour l'enlever)",
      name: "plaque",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    plaqueId: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", HORS_GUILDE));
      return;
    }
    try {
      if (!plaqueId) {
        await equiper(guildId, interaction.user.id, "plaque", null);
        await repondre(interaction, succes("Plaque retirée", "Ta carte reprend son fond par défaut.", { prive: true }));
        return;
      }
      if (!(await possede(guildId, interaction.user.id, "plaque", plaqueId))) {
        await repondre(interaction, echec("Pas dans ta collection", "Achète-la d'abord avec `/collection acheter`."));
        return;
      }
      const catalogue = await plaques();
      const plaque = catalogue.find(entree => entree.id === plaqueId);
      await equiper(guildId, interaction.user.id, "plaque", plaqueId);
      await repondre(
        interaction,
        succes("Plaque posée", `La plaque n° ${plaque?.rang ?? "?"} est en fond de ta carte de profil.`, {
          image: plaque?.cheminImage ? resolveAssetUrl(plaque.cheminImage) : null,
          prive: true,
        }),
      );
    } catch (err) {
      await repondre(interaction, echec("Changement impossible", err instanceof Error ? err.message : String(err)));
    }
  }
}
