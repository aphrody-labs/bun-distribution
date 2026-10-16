import { describe, expect, it } from "bun:test";

import {
  chargeAnnonceTirage,
  type ContexteAnnonce,
  type GagnantAnnonce,
  imageAbsolue,
  neutraliserMentions,
  ordinalFr,
} from "./annonce-discord-charge";

/**
 * La charge du message d'annonce du tirage.
 *
 * C'EST LE SEUL ENDROIT DU DISPOSITIF QUI PARLE À LA COMMUNAUTÉ, et c'est celui
 * qui casse le plus salement : une charge qui viole une limite de l'API Discord
 * fait refuser le message ENTIER, embed compris. Personne ne voit alors rien —
 * pas même une erreur partielle — et le staff croit avoir annoncé le gagnant.
 *
 * ⚠ CE FICHIER VISE `annonce-discord-charge.ts` ET NON `annonce-discord.ts`.
 * Le second porte `import "server-only"` et ouvre le pool Postgres : sous
 * `bun test`, `server-only` n'est même pas résolvable. La coupure entre les deux
 * modules existe précisément pour que la moitié qui décide du texte soit
 * testable sans base ni réseau.
 */

const CTX: ContexteAnnonce = {
  baliseChaine: "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  baliseRound: 31_547_509,
  nbGagnants: 1,
  nbOeuvres: 16,
  nbParticipants: 14,
  numero: 1,
  poidsMode: "par_oeuvre",
  publieLe: "2026-08-23T12:00:00.000Z",
  slugCampagne: "iergday",
  titreCampagne: "Un mois de célébration",
};

function gagnant(surcharge: Partial<GagnantAnnonce> = {}): GagnantAnnonce {
  return {
    discordId: "908269053347504170",
    image: "https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/iergday/discord/a.png",
    lien: "https://x.com/San_La_Vraie/status/2090455666267713840",
    lot: null,
    pseudo: "Sanada",
    rang: 1,
    source: "x",
    ...surcharge,
  };
}

describe("limites dures de l'API Discord", () => {
  it("respecte les trois plafonds même avec des textes absurdement longs", () => {
    // Un pseudo est choisi par le participant, un lot est saisi par le staff :
    // ni l'un ni l'autre n'est borné à la source.
    const charge = chargeAnnonceTirage([gagnant({ lot: "L".repeat(5000), pseudo: "P".repeat(3000) })], {
      ...CTX,
      titreCampagne: "T".repeat(4000),
    });
    const embed = (charge.embeds as Array<Record<string, never>>)[0] as unknown as {
      description: string;
      author?: { name: string };
      footer: { text: string };
      title: string;
    };
    expect((charge.content as string).length).toBeLessThanOrEqual(2000);
    expect(embed.description.length).toBeLessThanOrEqual(4096);
    expect(embed.author?.name.length ?? 0).toBeLessThanOrEqual(256);
    expect(embed.title.length).toBeLessThanOrEqual(256);
    expect(embed.footer.text.length).toBeLessThanOrEqual(2048);
  });

  it("répartit les boutons en rangées de 5 au plus, et 5 rangées au plus", () => {
    const gagnants = Array.from({ length: 30 }, (_, i) =>
      gagnant({ discordId: null, pseudo: `Gagnant ${i + 1}`, rang: i + 1 }),
    );
    const rangees = chargeAnnonceTirage(gagnants, { ...CTX, nbGagnants: 30 }).components as Array<{
      components: unknown[];
    }>;
    expect(rangees.length).toBeLessThanOrEqual(5);
    for (const rangee of rangees) {
      expect(rangee.components.length).toBeLessThanOrEqual(5);
    }
    // Au-delà du 25e bouton, Discord refuserait le message : la personne garde
    // sa ligne dans le `content`, c'est le bouton qui manque, pas le gagnant.
    expect(rangees.flatMap(r => r.components)).toHaveLength(25);
  });

  it("ne pose aucune rangée quand il n'y a rien à lier", () => {
    expect(chargeAnnonceTirage([], CTX).components).toBeUndefined();
  });
});

describe("mentions", () => {
  it("interdit @everyone, @here et les rôles par `parse: []`", () => {
    const charge = chargeAnnonceTirage([gagnant()], CTX);
    const permises = charge.allowed_mentions as { parse: string[]; users?: string[] };
    expect(permises.parse).toEqual([]);
  });

  it("ne met en liste blanche que les flocons des gagnants, dédoublonnés", () => {
    const charge = chargeAnnonceTirage(
      [
        gagnant({ discordId: "908269053347504170", rang: 1 }),
        gagnant({ discordId: null, pseudo: "Ruvi_Seiya", rang: 2 }),
        gagnant({ discordId: "908269053347504170", pseudo: "Sanada (2)", rang: 3 }),
      ],
      { ...CTX, nbGagnants: 3 },
    );
    const permises = charge.allowed_mentions as { parse: string[]; users?: string[] };
    expect(permises.users).toEqual(["908269053347504170"]);
  });

  it("n'émet AUCUNE mention quand aucun gagnant n'a de flocon", () => {
    // Cinq des quatorze participants d'iergday n'existent que sur X ou Instagram.
    const charge = chargeAnnonceTirage([gagnant({ discordId: null, pseudo: "orphelinalius" })], CTX);
    const permises = charge.allowed_mentions as { parse: string[]; users?: string[] };
    expect(permises.users).toBeUndefined();
    // Et surtout : aucun `<@…>` n'est FABRIQUÉ. Un identifiant inventé pingue un
    // inconnu et lui attribue publiquement une œuvre qu'il n'a pas faite.
    expect(charge.content as string).not.toContain("<@");
    expect(charge.content as string).toContain("**orphelinalius**");
  });

  it("met le lien de la création même sans flocon Discord", () => {
    const lien = "https://www.instagram.com/p/DcUEDDKoTgP/";
    const charge = chargeAnnonceTirage(
      [gagnant({ discordId: null, lien, pseudo: "orphelinalius", source: "instagram" })],
      CTX,
    );
    const rangees = charge.components as Array<{ components: Array<{ url: string }> }>;
    expect(rangees[0]?.components[0]?.url).toBe(lien);
  });

  it("ne propage jamais un @everyone venu d'un lot ou d'un pseudo", () => {
    const charge = chargeAnnonceTirage(
      [gagnant({ discordId: null, lot: "@everyone un print A5", pseudo: "@everyone" })],
      { ...CTX, titreCampagne: "@here la campagne" },
    );
    const texte = JSON.stringify(charge);
    expect(texte).not.toContain("@everyone");
    expect(texte).not.toContain("@here");
    // Le mot reste lisible : on désarme le déclencheur, on ne censure pas.
    expect(charge.content as string).toContain("everyone");
  });

  it("rend inerte une mention brute recopiée dans un libellé", () => {
    expect(neutraliserMentions("<@908269053347504170> bravo")).toBe("@908269053347504170 bravo");
    expect(neutraliserMentions("<@&1072993826400124958>")).toBe("@1072993826400124958");
    expect(neutraliserMentions("<#1537458038623965194>")).toBe("#1537458038623965194");
  });
});

describe("contenu du message", () => {
  it("nomme chaque gagnant dans le `content`, qui doit se suffire", () => {
    // C'est la seule partie que Discord montre en notification : tout mettre dans
    // l'embed donnerait « Rose Griffon a envoyé un message », et le gagnant ne
    // saurait pas qu'il a gagné.
    const charge = chargeAnnonceTirage(
      [gagnant({ lot: "Un print A5", rang: 1 }), gagnant({ discordId: null, pseudo: "Grimnape", rang: 2 })],
      { ...CTX, nbGagnants: 2 },
    );
    const content = charge.content as string;
    expect(content).toContain("<@908269053347504170>");
    expect(content).toContain("— Un print A5");
    expect(content).toContain("**Grimnape**");
    expect(content).toContain("**1er ·**");
    expect(content).toContain("**2e ·**");
  });

  it("rappelle qu'aucun lot ni tirage n'avait été annoncé pendant la campagne", () => {
    // Personne n'a participé en sachant qu'il y aurait un tirage : le message le
    // dit lui-même, sinon il laisse croire à une promesse tenue.
    expect(chargeAnnonceTirage([gagnant()], CTX).content as string).toContain(
      "aucun lot ni tirage n'avait été annoncé pendant la campagne",
    );
  });

  it("n'écrit JAMAIS « deux fois plus de chances »", () => {
    // Faux dès deux gagnants, et mesuré : 82 366 sur 200 000 contre 90 000
    // annoncés par « N·w/W ». La formulation juste est celle du ticket.
    const charge = chargeAnnonceTirage([gagnant()], CTX);
    const embed = (charge.embeds as Array<{ description: string }>)[0];
    expect(embed?.description).toContain("Chaque œuvre est un ticket, tirés un par un sans remise.");
    expect(JSON.stringify(charge)).not.toContain("deux fois plus de chances");
  });

  it("dit le round drand et le mode de poids, en clair", () => {
    const embed = (chargeAnnonceTirage([gagnant()], CTX).embeds as Array<{ description: string }>)[0];
    expect(embed?.description).toContain("round #31547509");
    expect(embed?.description).toContain("une chance par œuvre");
    expect(embed?.description).toContain("14 participant·es · 16 œuvres");
  });

  it("horodate l'embed sur la publication, pas sur l'instant de l'envoi", () => {
    const embed = (chargeAnnonceTirage([gagnant()], CTX).embeds as Array<{ timestamp: string }>)[0];
    expect(embed?.timestamp).toBe("2026-08-23T12:00:00.000Z");
  });
});

describe("images", () => {
  it("rend absolue une URL d'asset relative", () => {
    expect(imageAbsolue(null, "campagnes/iergday/discord/a.png")).toMatch(
      /^https?:\/\/[^/]+\/storage\/v1\/object\/public\/assets\/campagnes\/iergday\/discord\/a\.png$/,
    );
  });

  it("REFUSE les hôtes dont les URL expirent", () => {
    // `cdn.discordapp.com` signe ses pièces jointes pour moins de 24 h : un embed
    // qui pointe là est une image cassée dans l'archive du salon dès le lendemain.
    expect(imageAbsolue("https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2&hm=3", null)).toBeNull();
    expect(imageAbsolue("https://media.discordapp.net/attachments/1/2/a.png", null)).toBeNull();
    expect(imageAbsolue("https://pbs.twimg.com/media/x.jpg?name=orig", null)).toBeNull();
  });

  it("garde une URL absolue servie par un hôte durable", () => {
    expect(imageAbsolue("https://cdn.rosegriffon.fr/dx11/a.png", null)).toBe("https://cdn.rosegriffon.fr/dx11/a.png");
  });

  it("n'attache aucune image quand le master manque", () => {
    expect(imageAbsolue(null, null)).toBeNull();
    const charge = chargeAnnonceTirage([gagnant({ image: null })], CTX);
    const embed = (charge.embeds as Array<{ image?: unknown }>)[0];
    expect(embed?.image).toBeUndefined();
  });
});

describe("ordinaux", () => {
  it("écrit les rangs à la française", () => {
    expect(ordinalFr(1)).toBe("1er");
    expect(ordinalFr(2)).toBe("2e");
    expect(ordinalFr(11)).toBe("11e");
  });
});
