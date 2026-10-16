/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ce que ces tests protègent : la galerie publique affichait
 * « Dessin sous contrainte de <@198209347589898240> » et
 * « ma fille shirel ça faisait longtemps <:RG_Roy_coeur1:1141460972754702436> ».
 * Six des quinze créations Discord d'IERG Day portaient ce genre de balise.
 *
 * Les textes utilisés ici sont de VRAIS messages de la campagne, repris tels quels : un test
 * écrit sur des chaînes inventées n'aurait pas attrapé la perte du début d'extrait ci-dessous.
 */

import { describe, expect, it } from "bun:test";

import {
  collecterIdentifiantsDiscord,
  decouperTexteDiscord,
  extraitTexteDiscord,
  type ResolutionDiscord,
  resoudreMentions,
  texteDiscordEnClair,
  urlEmojiDiscord,
} from "./discord-texte";

const RESOLUTION: ResolutionDiscord = {
  membres: {
    "198209347589898240": "RompishKaru",
    "469900328758935552": "Jenn Scarlet",
    "908269053347504170": "Sanada (Allez Tao)",
  },
  roles: { "1152050533289443358": "Membre" },
  salons: { "1537458038623965194": "🍰〡iergday" },
};

describe("collecterIdentifiantsDiscord", () => {
  it("ramasse membres, rôles et salons sur tout un lot", () => {
    const trouve = collecterIdentifiantsDiscord([
      "caméo de <@198209347589898240>",
      "rdv dans <#1537458038623965194> <@&1152050533289443358>",
      "sans aucune mention",
    ]);
    expect(trouve.membres).toEqual(["198209347589898240"]);
    expect(trouve.roles).toEqual(["1152050533289443358"]);
    expect(trouve.salons).toEqual(["1537458038623965194"]);
  });

  it("dédoublonne : un membre nommé trois fois ne fait pas trois requêtes", () => {
    const trouve = collecterIdentifiantsDiscord([
      "<@198209347589898240> et <@198209347589898240>",
      "encore <@!198209347589898240>",
    ]);
    expect(trouve.membres).toEqual(["198209347589898240"]);
  });

  it("ne rend rien sur un texte vide ou sans balise", () => {
    const trouve = collecterIdentifiantsDiscord(["", "juste du texte 🐑"]);
    expect(trouve).toEqual({ membres: [], roles: [], salons: [] });
  });

  /*
   * Le drapeau `g` d'une `RegExp` PARTAGÉE garde son `lastIndex` : réutilisée telle quelle,
   * elle saute le début du texte suivant. Ce test échouerait si les expressions redevenaient
   * des constantes de module au lieu d'être reconstruites à chaque appel.
   */
  it("ne garde aucun état entre deux appels", () => {
    const texte = "<@198209347589898240> puis <@469900328758935552>";
    expect(collecterIdentifiantsDiscord([texte])).toEqual(collecterIdentifiantsDiscord([texte]));
    expect(collecterIdentifiantsDiscord([texte, texte]).membres).toHaveLength(2);
  });
});

describe("resoudreMentions", () => {
  it("remplace un membre connu par son nom affiché", () => {
    expect(resoudreMentions("caméo de <@198209347589898240> ici", RESOLUTION)).toBe("caméo de @RompishKaru ici");
  });

  it("accepte l'ancienne forme <@!id> des surnoms", () => {
    expect(resoudreMentions("<@!469900328758935552>", RESOLUTION)).toBe("@Jenn Scarlet");
  });

  it("rend un mot neutre pour un identifiant inconnu, jamais le nombre brut", () => {
    const rendu = resoudreMentions("<@111111111111111111> et <#222222222222222222>", RESOLUTION);
    expect(rendu).toBe("@membre et #salon");
    expect(rendu).not.toContain("111111111111111111");
  });

  it("résout rôles et salons", () => {
    expect(resoudreMentions("<@&1152050533289443358> dans <#1537458038623965194>", RESOLUTION)).toBe(
      "@Membre dans #🍰〡iergday",
    );
  });

  it("laisse @everyone et @here intacts : ce sont déjà des mots", () => {
    expect(resoudreMentions("@everyone et @here", RESOLUTION)).toBe("@everyone et @here");
  });

  it("laisse les émojis personnalisés en place — c'est l'écran qui les rendra", () => {
    const texte = "mes enfants de RG <:RG_roy_confetti:1412136639303520380>";
    expect(resoudreMentions(texte, RESOLUTION)).toBe(texte);
  });

  it("rend un horodatage en date absolue, jamais en « il y a » (l'ISR le figerait)", () => {
    const rendu = resoudreMentions("le <t:1755900000:F>", RESOLUTION);
    expect(rendu).toContain("2025");
    expect(rendu).not.toContain("<t:");
    expect(rendu).not.toContain("il y a");
  });

  it("sans résolution, tout retombe sur les libellés neutres", () => {
    expect(resoudreMentions("<@198209347589898240>")).toBe("@membre");
  });
});

describe("decouperTexteDiscord", () => {
  it("garde l'ordre du texte et des émojis", () => {
    const morceaux = decouperTexteDiscord("avant <:mouahaha:1296067836388708513> après");
    expect(morceaux).toEqual([
      { type: "texte", valeur: "avant " },
      { anime: false, id: "1296067836388708513", nom: "mouahaha", type: "emoji" },
      { type: "texte", valeur: " après" },
    ]);
  });

  it("reconnaît la variante animée <a:nom:id>", () => {
    const morceaux = decouperTexteDiscord("<a:danse:1296067836388708513>");
    expect(morceaux[0]).toMatchObject({ anime: true, type: "emoji" });
  });

  it("ne prend pas pour un émoji ce qui n'a pas la forme d'un identifiant Discord", () => {
    const morceaux = decouperTexteDiscord("<:a:1> ratio 16:9");
    expect(morceaux).toEqual([{ type: "texte", valeur: "<:a:1> ratio 16:9" }]);
  });

  it("rend une liste vide sur une chaîne vide", () => {
    expect(decouperTexteDiscord("")).toEqual([]);
  });
});

describe("texteDiscordEnClair", () => {
  it("réduit un émoji à :nom: pour les attributs alt et les métadonnées", () => {
    expect(texteDiscordEnClair("Tarpin en retard <:RG_riccardo_crying:1147803370896228352>", RESOLUTION)).toBe(
      "Tarpin en retard :RG_riccardo_crying:",
    );
  });

  it("résout aussi les mentions", () => {
    expect(texteDiscordEnClair("<@198209347589898240> 🐑", RESOLUTION)).toBe("@RompishKaru 🐑");
  });
});

describe("extraitTexteDiscord", () => {
  /*
   * LE DÉFAUT QUE CE TEST A ATTRAPÉ, sur un vrai message de la campagne : quand un morceau
   * de texte débordait du budget, la fonction rendait CE SEUL morceau tronqué et jetait tout
   * ce qui précédait — « Je crois que je suis pile dans les temps :mouahaha: Bellatrix… » se
   * réduisait à « Bellatrix… ».
   */
  it("garde le début du texte quand la coupe tombe dans un morceau tardif", () => {
    const extrait = extraitTexteDiscord(
      "Je crois que je suis pile dans les temps <:mouahaha:1296067836388708513> \nBellatrix en compagnie de mon OC Asuka <:Asuka_mimi:1385263950962233496>",
      60,
      RESOLUTION,
    );
    expect(extrait.startsWith("Je crois que je suis pile")).toBe(true);
    expect(extrait.endsWith("…")).toBe(true);
  });

  it("ne coupe JAMAIS à l'intérieur d'une balise d'émoji", () => {
    for (let budget = 1; budget <= 60; budget++) {
      const extrait = extraitTexteDiscord(
        "ma fille shirel <:RG_Roy_coeur1:1141460972754702436> ça faisait longtemps",
        budget,
        RESOLUTION,
      );
      // Une balise ouverte sans être refermée est le déchet qu'on veut interdire.
      const ouvertures = (extrait.match(/<a?:/g) ?? []).length;
      const fermetures = (extrait.match(/:\d{15,20}>/g) ?? []).length;
      expect(ouvertures).toBe(fermetures);
    }
  });

  it("rend le texte entier quand il tient dans le budget", () => {
    expect(extraitTexteDiscord("court", 60, RESOLUTION)).toBe("court");
  });

  it("résout les mentions avant de mesurer la longueur", () => {
    // La balise fait 21 caractères, le nom résolu 12 : mesurer la balise couperait à tort.
    expect(extraitTexteDiscord("<@198209347589898240> ok", 20, RESOLUTION)).toBe("@RompishKaru ok");
  });

  it("retire les liens t.co, comme l'extrait générique", () => {
    expect(extraitTexteDiscord("voir https://t.co/abc123 ici", 60, RESOLUTION)).toBe("voir  ici");
  });
});

describe("urlEmojiDiscord", () => {
  it("sert du webp pour un émoji fixe et du gif pour un animé", () => {
    expect(urlEmojiDiscord("1412136639303520380", false)).toContain(".webp");
    expect(urlEmojiDiscord("1412136639303520380", true)).toContain(".gif");
  });

  it("reste sur le CDN de Discord, seul hôte autorisé par img-src pour ces images", () => {
    expect(urlEmojiDiscord("1412136639303520380", false).startsWith("https://cdn.discordapp.com/emojis/")).toBe(true);
  });
});
