/**
 * `/moderation multicomptes` — reconnaître les doubles comptes d'une personne.
 *
 * ── CE QUE CETTE COMMANDE AJOUTE AU BOT ────────────────────────────────────
 * Rien, dans l'arbre existant, ne permettait de relier deux comptes entre eux.
 * `/moderation historique` rend le dossier d'UN membre ; un membre banni qui
 * revient sous un autre pseudo repart donc d'un dossier vierge, et le staff n'a
 * aucun moyen de le savoir autrement qu'en le reconnaissant à sa façon d'écrire.
 * C'est le trou que ces quatre sous-commandes ferment.
 *
 * ── ELLE NE PROUVE RIEN, ET ELLE LE DIT ────────────────────────────────────
 * Discord ne donne ni adresse IP ni empreinte d'appareil : tout repose sur des
 * ressemblances observables, et la conclusion appartient au staff. Aucun libellé
 * ne suggère de sanction, aucun niveau ne s'appelle « coupable » — le plus haut
 * dit « rattachement établi », et il n'est atteint que lorsque la personne a
 * elle-même relié ses deux comptes au même profil du site.
 *
 * ── POURQUOI SOUS `/moderation` ET PAS SOUS `/staff` ───────────────────────
 * Trois de ces sous-commandes ne modifient rien, et la règle du dépôt veut que
 * la consultation vive sous `/staff`. Elles sont ici pour la même raison que
 * `/moderation historique` : c'est un dossier de modération, on l'ouvre au
 * milieu d'une décision de modération, et l'envoyer chercher sous une autre
 * racine obligerait à sortir du groupe pour lire ce sur quoi on va agir.
 * `verdict`, lui, écrit — il est donc à sa place sans discussion.
 *
 * ── TOUJOURS EN PRIVÉ ──────────────────────────────────────────────────────
 * Un rapprochement nomme deux membres et affirme qu'ils pourraient n'être qu'une
 * personne. Publié dans un salon, même de staff, il devient une accusation que
 * personne n'a portée. L'éphémère est exactement l'outil pour ça.
 */
import { ButtonComponent, Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type User,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { GUILD_ID } from "../../lib/config";
import {
  clePaire,
  ICONES_NIVEAU,
  LIBELLES_NIVEAU,
  libelleBalayage,
  NIVEAUX,
  type EmpreinteCompte,
  type Niveau,
  type Rapprochement,
} from "../../lib/multicomptes";
import {
  balayerServeur,
  LIBELLES_VERDICT,
  oublierPopulation,
  poserVerdict,
  rapprochementsDe,
  retirerVerdict,
  verdictsDe,
  VERDICTS,
  type LigneVerdict,
  type Verdict,
} from "../../services/multicomptes";
import {
  borner,
  bornerPage,
  decoderEtat,
  echapper,
  echec,
  encoderEtat,
  fiche,
  ilYA,
  nombreDePages,
  pied,
  piedDeCommande,
  rangeePagination,
  repondre,
  succes,
  tranche,
  vide,
} from "../../lib/ui";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import "./racine-moderation";

/** Préfixe des boutons de pagination de cette surface. */
const PREFIXE = "mc";

/** Rapprochements par page. Deux lignes chacun : au-delà, la liste ne se lit plus. */
const PAR_PAGE = 6;

/**
 * Décisions affichées par `tranchees`.
 *
 * Vingt tiennent dans les cinq champs de `bloc()` même quand chaque motif fait
 * ses 400 caractères réglementaires — au-delà, `decouper` jetterait le surplus
 * en silence, et le titre continuerait d'annoncer un total que le corps ne
 * montre pas.
 */
const PAR_PAGE_TRANCHEES = 20;

/**
 * Niveau retenu par défaut.
 *
 * `faible` n'est pas le défaut, et c'est une décision : sur la production du
 * 30/8/2026, le balayage complet rend 1 048 rapprochements dont 979 de niveau
 * `faible` — deux comptes créés le même jour, rien de plus. Servir cette liste
 * en premier, c'est garantir qu'on n'ouvrira plus jamais la commande. À
 * `possible`, il en reste 69, c'est-à-dire une file de travail.
 */
const NIVEAU_DEFAUT: Niveau = "possible";

/**
 * Les choix de niveau, libellés court.
 *
 * Le format est contraint par un plafond DUR : Discord compte 8 000 caractères
 * pour une commande entière — noms, descriptions et valeurs de tout son arbre —
 * et refuse l'enregistrement de TOUTES les commandes du bot au-delà (`50035`,
 * `APPLICATION_COMMAND_TOO_LARGE`). C'est ce plafond qui a imposé de couper
 * `/administration` en trois racines. `/moderation` en consomme 7 086 avec ce
 * groupe : chaque libellé se paye deux fois, une par sous-commande qui l'offre.
 */
const CHOIX_NIVEAU = NIVEAUX.map(niveau => ({
  name: `${ICONES_NIVEAU[niveau]} ${LIBELLES_NIVEAU[niveau]} et +`,
  value: niveau,
})) as Array<{ name: string; value: Niveau }>;

// ─── Présentation ───────────────────────────────────────────────────────────

/** Nom lisible d'un compte, même s'il a quitté le serveur. */
function nomDe(empreintes: ReadonlyMap<string, EmpreinteCompte>, id: string): string {
  const compte = empreintes.get(id);
  if (!compte) {
    return `\`${id}\``;
  }
  const parti = compte.partiLe ? " ⤴" : "";
  return `${echapper(compte.nomAffiche ?? compte.pseudo)}${parti}`;
}

/** Marque d'une paire déjà tranchée par le staff. */
function marqueVerdict(verdict: LigneVerdict | undefined): string {
  if (!verdict) {
    return "";
  }
  return verdict.verdict === "confirme" ? " ✔️ confirmé" : " ✖️ écarté";
}

/**
 * Deux lignes par rapprochement : qui, à quel niveau, sur quoi.
 *
 * Les mentions `<@…>` sont là pour l'ACTION qui suit — c'est ce qu'on copie
 * pour lancer `/moderation historique` ou un bannissement. Elles ne notifient
 * personne : Discord ne déclenche pas de mention depuis un embed.
 */
function ligneRapprochement(
  rapprochement: Rapprochement,
  empreintes: ReadonlyMap<string, EmpreinteCompte>,
  verdicts: ReadonlyMap<string, LigneVerdict>,
): string {
  const cle = clePaire(rapprochement.compteA, rapprochement.compteB);
  const entete =
    `${ICONES_NIVEAU[rapprochement.niveau]} **${rapprochement.score}** · ` +
    `${nomDe(empreintes, rapprochement.compteA)} ↔ ${nomDe(empreintes, rapprochement.compteB)}` +
    marqueVerdict(verdicts.get(cle));
  const indices = rapprochement.indices
    .filter(indice => indice.poids > 0)
    .map(indice => indice.icone)
    .join(" ");
  return `${entete}\n<@${rapprochement.compteA}> ↔ <@${rapprochement.compteB}> · ${indices}`;
}

/**
 * Le rapprochement ne connaît qu'un serveur.
 *
 * `discord_members` n'a pas de colonne `guild_id` : elle décrit la communauté
 * Rose Griffon et rien d'autre. Or les commandes du profil `rg` sont
 * enregistrées sur trois serveurs. Lancée depuis Azalée ou Achillea, la commande
 * balayerait donc une population qui n'est pas celle qu'on a sous les yeux — et
 * rendrait des noms que personne ne reconnaît, sans rien signaler.
 */
async function guildeAttendue(interaction: ChatInputCommandInteraction | ButtonInteraction): Promise<boolean> {
  if (interaction.guildId === GUILD_ID) {
    return true;
  }
  await repondre(
    interaction,
    echec(
      "Serveur non couvert",
      "Le rapprochement de comptes s'appuie sur la population synchronisée du serveur " +
        "Rose Griffon, la seule que `discord_members` décrive. Lance la commande depuis ce serveur.",
    ),
  );
  return false;
}

/** Ce que le staff doit avoir en tête avant de lire une liste de rapprochements. */
const AVERTISSEMENT =
  "Ce sont des ressemblances, pas des preuves : Discord ne donne ni adresse IP " +
  "ni identifiant d'appareil. Deux frères, deux amis sur le même réseau ou deux " +
  "fans de la même image se ressemblent aussi.";

// ─── La page de balayage ────────────────────────────────────────────────────

async function rendrePage(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  etat: { niveau: Niveau; jours: number; page: number },
): Promise<void> {
  const resultat = await balayerServeur(GUILD_ID, {
    depuisJours: etat.jours > 0 ? etat.jours : null,
    niveauMinimum: etat.niveau,
  });
  const total = resultat.rapprochements.length;

  if (total === 0) {
    await repondre(
      interaction,
      vide(
        "Aucun rapprochement",
        `Rien au niveau « ${LIBELLES_NIVEAU[etat.niveau]} »${etat.jours > 0 ? ` sur les ${etat.jours} derniers jours` : ""}. ` +
          "Élargis avec l'option `niveau`, ou retire le filtre `jours`.",
      ),
    );
    return;
  }

  const pages = nombreDePages(total, PAR_PAGE);
  const page = bornerPage(etat.page, total, PAR_PAGE);
  const entrees = tranche(resultat.rapprochements, page, PAR_PAGE);

  const carte = fiche({
    contexte: [
      `niveau ≥ ${LIBELLES_NIVEAU[etat.niveau]}`,
      etat.jours > 0 ? `arrivées des ${etat.jours} derniers jours` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    description: `${libelleBalayage(resultat)}\n\n${AVERTISSEMENT}`,
    icone: "membre",
    intention: resultat.parNiveau.certain > 0 ? "attention" : "marque",
    titre: `${total} rapprochement${total > 1 ? "s" : ""}`,
  });

  carte.bloc(
    "Paires",
    entrees.map(rapprochement => ligneRapprochement(rapprochement, resultat.empreintes, resultat.verdicts)).join("\n"),
    4,
  );
  carte.champ(
    "Ensuite",
    "`/moderation multicomptes membre` pour le détail d'un compte · " +
      "`/moderation multicomptes verdict` pour trancher une paire.",
  );

  // `piedDeCommande` lit `interaction.options` pour reconstruire le chemin de la
  // commande : un bouton n'en a pas. On pose donc le chemin à la main de ce
  // côté-là, plutôt que de transtyper une interaction en une autre.
  const note = `cliché ${ilYA(resultat.chargeeLe)}`;
  const embed = interaction.isChatInputCommand()
    ? piedDeCommande(carte.embed, interaction, { note, page, pages })
    : pied(carte.embed, { note: `${note} · /moderation multicomptes balayage`, page, pages });
  await interaction.editReply({
    components: rangeePagination({
      identifiant: cible => encoderEtat(PREFIXE, [etat.niveau, etat.jours, cible]),
      page,
      pages,
      prefixe: PREFIXE,
    }),
    embeds: [embed],
  });
}

// ─── La commande ────────────────────────────────────────────────────────────

@Discord()
@SlashGroup({
  description: "Rapprocher les comptes qui pourraient appartenir à la même personne",
  name: "multicomptes",
  root: "moderation",
})
@SlashGroup("multicomptes", "moderation")
export class ModerationMulticomptesCommand {
  @Slash({ description: "Les comptes qui ressemblent à un membre donné", name: "membre" })
  async membre(
    @SlashOption({
      description: "Le membre à rapprocher",
      name: "membre",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    cible: User,
    @SlashChoice(...CHOIX_NIVEAU)
    @SlashOption({
      description: "Niveau minimum retenu",
      name: "niveau",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    niveau: Niveau | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction)) || !(await guildeAttendue(interaction))) {
      return;
    }
    try {
      const resultat = await rapprochementsDe(GUILD_ID, cible.id, {
        niveauMinimum: niveau ?? "faible",
      });
      if (!resultat.compte) {
        await repondre(
          interaction,
          vide(
            `${cible.displayName} n'est pas dans la population examinée`,
            "Le rapprochement s'appuie sur `discord_members`, qui ne décrit que le serveur " +
              "Rose Griffon et qui est alimentée par `rg-cron`. Un membre arrivé il y a " +
              "moins d'une demi-heure peut ne pas encore y figurer.",
          ),
        );
        return;
      }

      const retenus = resultat.rapprochements.filter(
        paire => NIVEAUX.indexOf(paire.niveau) >= NIVEAUX.indexOf(niveau ?? NIVEAU_DEFAUT),
      );
      const carte = fiche({
        description:
          retenus.length === 0
            ? `Aucun compte ne ressemble à ${echapper(cible.displayName)} au niveau demandé.\n\n${AVERTISSEMENT}`
            : `${retenus.length} compte${retenus.length > 1 ? "s" : ""} rapproché${retenus.length > 1 ? "s" : ""}.\n\n${AVERTISSEMENT}`,
        icone: "membre",
        intention: retenus.some(paire => paire.niveau === "certain") ? "attention" : "marque",
        miniature: cible.displayAvatarURL({ extension: "png", size: 128 }),
        titre: `Rapprochements — ${cible.displayName}`,
      });

      // Un champ par compte rapproché : le détail des indices est ce qu'on
      // vient chercher ici, contrairement à la liste de `balayage`.
      for (const rapprochement of retenus.slice(0, 6)) {
        const autre = rapprochement.compteA === cible.id ? rapprochement.compteB : rapprochement.compteA;
        const verdict = resultat.verdicts.get(clePaire(rapprochement.compteA, rapprochement.compteB));
        carte.champ(
          `${ICONES_NIVEAU[rapprochement.niveau]} ${rapprochement.score} · ${nomDe(resultat.empreintes, autre)}${marqueVerdict(verdict)}`,
          [
            `<@${autre}> · \`${autre}\``,
            // `detail` recopie des pseudos et des surnoms — donc du texte écrit
            // par le membre examiné. Un surnom de 27 caractères suffit à poser
            // un lien Markdown cliquable au milieu d'un rapport de modération
            // que le staff lit comme venant du bot.
            ...rapprochement.indices.map(indice => `${indice.icone} ${echapper(indice.detail)}`),
            verdict?.motif ? `📝 ${echapper(verdict.motif)}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      if (retenus.length > 6) {
        carte.champ(
          "Suite",
          `${retenus.length - 6} autre(s) rapprochement(s) non affiché(s). ` +
            "Utilise `/moderation multicomptes balayage` pour la liste complète.",
        );
      }
      // Ce qui est SOUS le seuil compte : sur une fiche individuelle, savoir
      // qu'il existe onze coïncidences de plus évite de conclure « rien à
      // signaler » alors qu'on a seulement regardé le haut de la pile.
      const sousLeSeuil = resultat.rapprochements.length - retenus.length;
      if (sousLeSeuil > 0) {
        carte.champ(
          "Sous le seuil",
          `${sousLeSeuil} coïncidence(s) de niveau inférieur, non retenue(s). ` +
            "Rejoue avec `niveau: Coïncidence` pour les voir.",
          { enLigne: true },
        );
      }

      await interaction.editReply({
        embeds: [piedDeCommande(carte.embed, interaction, { note: `cliché ${ilYA(resultat.chargeeLe)}` })],
      });
    } catch (err) {
      await repondre(interaction, echec("Rapprochement impossible", messagePanne(err)));
    }
  }

  @Slash({ description: "Tous les rapprochements du serveur, du plus fort au plus faible", name: "balayage" })
  async balayage(
    @SlashChoice(...CHOIX_NIVEAU)
    @SlashOption({
      description: "Niveau minimum retenu",
      name: "niveau",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    niveau: Niveau | undefined,
    @SlashOption({
      description: "Limiter aux arrivées des N derniers jours",
      maxValue: 365,
      minValue: 1,
      name: "jours",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    jours: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction)) || !(await guildeAttendue(interaction))) {
      return;
    }
    try {
      await rendrePage(interaction, {
        jours: jours ?? 0,
        niveau: niveau ?? NIVEAU_DEFAUT,
        page: 1,
      });
    } catch (err) {
      await repondre(interaction, echec("Balayage impossible", messagePanne(err)));
    }
  }

  @Slash({
    description: "Trancher une paire : même personne, ou faux positif",
    name: "verdict",
  })
  async verdict(
    @SlashOption({
      description: "Premier compte",
      name: "compte",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    premier: User,
    @SlashOption({
      description: "Second compte",
      name: "autre-compte",
      required: true,
      type: ApplicationCommandOptionType.User,
    })
    second: User,
    @SlashChoice(
      { name: "✔️ Même personne — confirmé", value: "confirme" },
      { name: "✖️ Faux positif — ne plus remonter", value: "ecarte" },
      { name: "↩️ Annuler le verdict posé", value: "retirer" },
    )
    @SlashOption({
      description: "La décision",
      name: "decision",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    decision: Verdict | "retirer",
    @SlashOption({
      description: "Pourquoi — ce que lira le prochain qui ouvre la paire",
      maxLength: 400,
      name: "motif",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    motif: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin || !(await guildeAttendue(interaction))) {
      return;
    }
    if (premier.id === second.id) {
      await repondre(
        interaction,
        echec("Deux comptes différents sont attendus", "Un compte ne peut pas être son propre double."),
      );
      return;
    }
    try {
      if (decision === "retirer") {
        const retire = await retirerVerdict(GUILD_ID, premier.id, second.id);
        oublierPopulation();
        if (retire) {
          // Journalisé comme la POSE l'est, et pour une raison plus forte :
          // après le `delete`, plus rien en base ne dit ce que le staff avait
          // décidé. Annuler la décision d'un collègue est précisément ce qui
          // doit laisser une trace — on y recopie donc le verdict effacé.
          await logAdminAction({
            action: "discord.multicomptes-verdict-retire",
            adminId: admin.profileId,
            details: {
              autre_compte: second.id,
              motif_efface: retire.motif,
              pose_par: retire.parQui,
              verdict_efface: retire.verdict,
            },
            discordId: interaction.user.id,
            targetId: premier.id,
            targetType: "discord_member",
          });
        }
        await repondre(
          interaction,
          retire
            ? succes(
                "Verdict retiré",
                `La paire ${echapper(premier.displayName)} ↔ ${echapper(second.displayName)} redevient examinable.` +
                  `\nDécision effacée : ${LIBELLES_VERDICT[retire.verdict]}` +
                  (retire.motif ? ` — ${echapper(retire.motif)}` : ""),
              )
            : vide("Aucun verdict à retirer", "Cette paire n'avait jamais été tranchée."),
        );
        return;
      }

      if (!(VERDICTS as readonly string[]).includes(decision)) {
        await repondre(interaction, echec("Décision inconnue", "Choisis une valeur dans la liste."));
        return;
      }

      await poserVerdict({
        a: premier.id,
        b: second.id,
        guildId: GUILD_ID,
        motif: motif ?? null,
        parQui: interaction.user.id,
        verdict: decision,
      });
      // Le cliché porte les verdicts : sans cet oubli, le balayage suivant
      // remonterait la paire qu'on vient d'écarter, pendant cinq minutes.
      oublierPopulation();

      await logAdminAction({
        action: "discord.multicomptes-verdict",
        adminId: admin.profileId,
        details: {
          autre_compte: second.id,
          motif: motif ?? null,
          verdict: decision,
        },
        discordId: interaction.user.id,
        targetId: premier.id,
        targetType: "discord_member",
      });

      await repondre(
        interaction,
        succes(
          LIBELLES_VERDICT[decision],
          `${echapper(premier.displayName)} ↔ ${echapper(second.displayName)}` +
            (motif ? `\n📝 ${echapper(motif)}` : "") +
            (decision === "ecarte"
              ? "\n\nLa paire ne remontera plus dans les balayages. `verdict … retirer` annule cette décision."
              : "\n\nCe verdict est une NOTE : il ne bannit personne et ne déclenche rien."),
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Verdict non enregistré", messagePanne(err)));
    }
  }

  @Slash({ description: "Les paires déjà tranchées par le staff", name: "tranchees" })
  async tranchees(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction)) || !(await guildeAttendue(interaction))) {
      return;
    }
    try {
      // `verdictsDe` et non `balayerServeur` : cette sous-commande ne lit que la
      // table des décisions. Passer par le balayage chargeait les 2 098 comptes,
      // calculait 4 821 paires et 1 338 rapprochements — puis n'en gardait rien.
      const verdicts = await verdictsDe(GUILD_ID);
      const lignes = [...verdicts.values()].toSorted((gauche, droite) => droite.le.getTime() - gauche.le.getTime());
      if (lignes.length === 0) {
        await repondre(
          interaction,
          vide(
            "Aucune paire tranchée",
            "Le staff n'a encore confirmé ni écarté aucun rapprochement. " +
              "`/moderation multicomptes verdict` sert à ça.",
          ),
        );
        return;
      }
      // Le titre annonçait un total dont le corps ne montrait qu'une part : au-delà
      // de cinq champs, `decouper` jette le reste SANS que `Fiche.tronquee` s'en
      // aperçoive — la troncature était donc muette, sur la seule surface où une
      // décision manquante se lit comme une décision jamais prise.
      const montrees = lignes.slice(0, PAR_PAGE_TRANCHEES);
      const carte = fiche({
        description:
          "Ce que le staff a déjà décidé. Les paires écartées ne remontent plus dans " +
          "`balayage` ; elles restent visibles sur la fiche de chaque membre.",
        icone: "journal",
        titre: `${lignes.length} paire(s) tranchée(s)`,
      });
      carte.bloc(
        montrees.length < lignes.length
          ? `Décisions — les ${montrees.length} plus récentes sur ${lignes.length}`
          : "Décisions",
        montrees
          .map(
            ligne =>
              `${ligne.verdict === "confirme" ? "✔️" : "✖️"} <@${ligne.compteA}> ↔ <@${ligne.compteB}>` +
              `${ligne.parQui ? ` · par <@${ligne.parQui}>` : ""} · ${ilYA(ligne.le)}` +
              `${ligne.motif ? `\n   ${borner(echapper(ligne.motif), 120)}` : ""}`,
          )
          .join("\n"),
        5,
      );
      if (montrees.length < lignes.length) {
        carte.champ(
          "Suite",
          `${lignes.length - montrees.length} décision(s) plus ancienne(s) non affichée(s). ` +
            "Elles restent visibles sur la fiche de chaque membre concerné.",
        );
      }
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Lecture impossible", messagePanne(err)));
    }
  }

  /**
   * Pagination du balayage.
   *
   * Le niveau et la fenêtre voyagent dans l'identifiant du bouton : aucune
   * mémoire de processus, donc aucun bouton mort après un redémarrage — et une
   * page 3 rendue reste la page 3 des MÊMES critères.
   */
  @ButtonComponent({ id: /^mc\|/ })
  async paginer(interaction: ButtonInteraction) {
    const champs = decoderEtat(PREFIXE, interaction.customId, 3);
    if (!champs) {
      return;
    }
    const [niveau, jours, page] = champs;
    await interaction.deferUpdate();
    if (!(await exigerDroits(interaction)) || !(await guildeAttendue(interaction))) {
      return;
    }
    try {
      await rendrePage(interaction, {
        jours: Number.parseInt(jours ?? "0", 10) || 0,
        niveau: (NIVEAUX as readonly string[]).includes(niveau ?? "") ? (niveau as Niveau) : NIVEAU_DEFAUT,
        page: Number.parseInt(page ?? "1", 10) || 1,
      });
    } catch (err) {
      await repondre(interaction, echec("Page illisible", messagePanne(err)));
    }
  }
}
