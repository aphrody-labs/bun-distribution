import { describe, expect, it } from "bun:test";

import {
  type ContexteMentions,
  analyserInline,
  extraireIdentifiantsMentionnes,
  parseDiscordMarkdown,
  texteBrut,
} from "./markdown-ast";
import { normaliserMessage } from "./types";
import { couleurDiscord, estUrlSure, urlEmojiPersonnalise } from "./url";

const CTX: ContexteMentions = {
  roles: { "222222222222222222": { couleur: "#f89c5a", nom: "Coach" } },
  salons: { "333333333333333333": "annonces" },
  utilisateurs: { "111111111111111111": "yoyo" },
};

/** Aplatit le premier paragraphe d'un contenu pour inspecter ses nœuds. */
function _noeudsDuPremierBloc(contenu: string, ctx: ContexteMentions = CTX) {
  const blocs = parseDiscordMarkdown(contenu, ctx);
  const premier = blocs[0];
  if (!premier || !("enfants" in premier)) return [];
  return premier.enfants;
}

describe("contenu vide", () => {
  it("ne produit aucun bloc", () => {
    expect(parseDiscordMarkdown("", CTX)).toEqual([]);
    expect(parseDiscordMarkdown("   \n\n  ", CTX)).toEqual([]);
    // Une valeur non conforme ne doit jamais faire tomber le rendu.
    expect(parseDiscordMarkdown(undefined as unknown as string, CTX)).toEqual([]);
    expect(analyserInline("", CTX)).toEqual([]);
  });
});

describe("mise en forme", () => {
  it("reconnait le gras", () => {
    const noeuds = analyserInline("un **mot** fort", CTX);
    expect(noeuds.some((n) => n.type === "gras")).toBe(true);
    expect(texteBrut(noeuds)).toBe("un mot fort");
  });

  it("reconnait l'italique en asterisque et en tiret bas", () => {
    expect(analyserInline("*penche*", CTX)[0]?.type).toBe("italique");
    expect(analyserInline("_penche_", CTX)[0]?.type).toBe("italique");
  });

  it("reconnait le gras italique combine", () => {
    const noeud = analyserInline("***tres fort***", CTX)[0];
    expect(noeud?.type).toBe("gras");
    expect(noeud && "enfants" in noeud && noeud.enfants[0]?.type).toBe("italique");
  });

  it("reconnait le souligne, le barre et le spoiler", () => {
    expect(analyserInline("__souligne__", CTX)[0]?.type).toBe("souligne");
    expect(analyserInline("~~barre~~", CTX)[0]?.type).toBe("barre");
    expect(analyserInline("||secret||", CTX)[0]?.type).toBe("spoiler");
  });

  it("reconnait le code inline sans interpreter son contenu", () => {
    const noeud = analyserInline("`**pas gras**`", CTX)[0];
    expect(noeud?.type).toBe("code");
    expect(noeud && "valeur" in noeud && noeud.valeur).toBe("**pas gras**");
  });

  it("reconnait un bloc de code avec son langage", () => {
    const blocs = parseDiscordMarkdown("avant\n```ts\nconst a = 1;\n```", CTX);
    const code = blocs.find((bloc) => bloc.type === "bloc-code");
    expect(code).toBeDefined();
    expect(code && code.type === "bloc-code" && code.langage).toBe("ts");
    expect(code && code.type === "bloc-code" && code.code).toBe("const a = 1;");
  });

  it("respecte l'echappement par antislash", () => {
    const noeuds = analyserInline(String.raw`\*\*pas gras\*\*`, CTX);
    expect(noeuds.every((n) => n.type === "texte")).toBe(true);
    expect(texteBrut(noeuds)).toBe("**pas gras**");
  });

  it("decoupe titres, citations et listes", () => {
    const blocs = parseDiscordMarkdown("# Titre\n> cite\n- un\n- deux", CTX);
    expect(blocs.map((bloc) => bloc.type)).toEqual(["titre", "citation", "liste"]);
    const liste = blocs[2];
    expect(liste?.type === "liste" ? liste.elements : []).toHaveLength(2);
  });
});

describe("mentions", () => {
  it("resout une mention d'utilisateur connue", () => {
    const noeud = analyserInline("salut <@111111111111111111>", CTX)[1];
    expect(noeud?.type).toBe("mention-utilisateur");
    expect(noeud && "nom" in noeud && noeud.nom).toBe("yoyo");
  });

  it("accepte la forme historique <@!id> et retombe sur « membre »", () => {
    const noeud = analyserInline("<@!999999999999999999>", CTX)[0];
    expect(noeud?.type).toBe("mention-utilisateur");
    expect(noeud && "nom" in noeud && noeud.nom).toBe("membre");
  });

  it("resout une mention de role avec sa couleur", () => {
    const noeud = analyserInline("<@&222222222222222222>", CTX)[0];
    expect(noeud?.type).toBe("mention-role");
    expect(noeud && "nom" in noeud && noeud.nom).toBe("Coach");
    expect(noeud && noeud.type === "mention-role" && noeud.couleur).toBe("#f89c5a");
  });

  it("resout une mention de salon", () => {
    const noeud = analyserInline("<#333333333333333333>", CTX)[0];
    expect(noeud?.type).toBe("mention-salon");
    expect(noeud && "nom" in noeud && noeud.nom).toBe("annonces");
  });

  it("marque @everyone et @here", () => {
    expect(analyserInline("@everyone", CTX)[0]?.type).toBe("mention-globale");
    expect(analyserInline("@here", CTX)[0]?.type).toBe("mention-globale");
  });

  it("releve les identifiants a resoudre cote serveur", () => {
    const ids = extraireIdentifiantsMentionnes([
      "<@111111111111111111> et <@&222222222222222222>",
      "vers <#333333333333333333>",
    ]);
    expect(ids.utilisateurs).toEqual(["111111111111111111"]);
    expect(ids.roles).toEqual(["222222222222222222"]);
    expect(ids.salons).toEqual(["333333333333333333"]);
  });
});

describe("emojis personnalises", () => {
  it("produit l'URL webp d'un emoji fixe", () => {
    const noeud = analyserInline("<:azalee:444444444444444444>", CTX)[0];
    expect(noeud?.type).toBe("emoji");
    expect(noeud && noeud.type === "emoji" && noeud.nom).toBe("azalee");
    expect(noeud && noeud.type === "emoji" && noeud.anime).toBe(false);
    expect(noeud && noeud.type === "emoji" && noeud.url).toBe(
      "https://cdn.discordapp.com/emojis/444444444444444444.webp",
    );
  });

  it("produit l'URL gif d'un emoji anime", () => {
    const noeud = analyserInline("<a:danse:555555555555555555>", CTX)[0];
    expect(noeud && noeud.type === "emoji" && noeud.anime).toBe(true);
    expect(noeud && noeud.type === "emoji" && noeud.url).toBe(
      "https://cdn.discordapp.com/emojis/555555555555555555.gif",
    );
    expect(urlEmojiPersonnalise("555555555555555555", true)).toBe(
      "https://cdn.discordapp.com/emojis/555555555555555555.gif",
    );
  });
});

describe("liens", () => {
  it("accepte un lien http(s) a libelle", () => {
    const noeud = analyserInline("[le site](https://rosegriffon.fr)", CTX)[0];
    expect(noeud?.type).toBe("lien");
    expect(noeud && noeud.type === "lien" && noeud.url).toBe("https://rosegriffon.fr");
  });

  it("detecte un lien nu et ecarte la ponctuation finale", () => {
    const noeud = analyserInline("voir https://rosegriffon.fr/shop.", CTX)[1];
    expect(noeud?.type).toBe("lien");
    expect(noeud && noeud.type === "lien" && noeud.url).toBe("https://rosegriffon.fr/shop");
  });

  it("REJETTE un lien javascript: et le laisse en texte brut", () => {
    const noeuds = analyserInline("[clique](javascript:alert(1))", CTX);
    expect(noeuds.some((n) => n.type === "lien")).toBe(false);
    expect(texteBrut(noeuds)).toContain("javascript:alert(1)");
  });

  it("REJETTE les autres schemas dangereux", () => {
    for (const dangereux of [
      "[x](data:text/html;base64,PHNjcmlwdD4=)",
      "[x](vbscript:msgbox(1))",
      "[x](JavaScript:alert(1))",
      "[x](file:///etc/passwd)",
    ]) {
      expect(analyserInline(dangereux, CTX).some((n) => n.type === "lien")).toBe(false);
    }
    expect(estUrlSure("javascript:alert(1)")).toBe(false);
    expect(estUrlSure("https://rosegriffon.fr")).toBe(true);
    expect(estUrlSure("/relatif")).toBe(false);
  });
});

describe("normalisation des messages", () => {
  it("refuse une ligne sans identifiants", () => {
    expect(normaliserMessage({ content: "coucou" })).toBeNull();
  });

  it("normalise encarts, pieces jointes, reactions et sondage", () => {
    const message = normaliserMessage({
      attachments: [
        {
          content_type: "image/png",
          filename: "visuel.png",
          height: 400,
          id: "1",
          url: "https://cdn.discordapp.com/a.png",
          width: 800,
        },
        { filename: "malveillant.png", id: "2", url: "javascript:alert(1)" },
      ],
      author_id: "111111111111111111",
      author_username: "EasyPoll",
      channel_id: "1135716082972381234",
      content: "sondage",
      created_at: "2026-08-12T10:00:00.000Z",
      embeds: [
        {
          color: 16_098_394,
          description: "Quel maillot ?",
          fields: [{ inline: true, name: "Option A", value: "12 votes" }],
          title: "Sondage",
        },
        {},
      ],
      message_id: "999999999999999999",
      poll: {
        allow_multiselect: false,
        answers: [
          { answer_id: 1, poll_media: { text: "Bleu" } },
          { answer_id: 2, poll_media: { text: "Or" } },
        ],
        expiry: "2026-08-15T10:00:00.000Z",
        question: { text: "Ta couleur ?" },
        results: {
          answer_counts: [
            { count: 7, id: 1 },
            { count: 3, id: 2 },
          ],
        },
      },
      reactions: [{ count: 4, emoji: { animated: false, id: null, name: "👍" } }],
      type: 0,
    });

    expect(message).not.toBeNull();
    // La pièce jointe au schéma non http est écartée.
    expect(message?.attachments).toHaveLength(1);
    expect(message?.attachments[0]?.est_image).toBe(true);
    // L'encart vide est écarté, la couleur devient une couleur CSS.
    expect(message?.embeds).toHaveLength(1);
    expect(message?.embeds[0]?.couleur).toBe("#f5a45a");
    expect(message?.embeds[0]?.champs).toHaveLength(1);
    expect(message?.reactions[0]?.compte).toBe(4);
    expect(message?.poll?.question).toBe("Ta couleur ?");
    expect(message?.poll?.total_votes).toBe(10);
    expect(message?.poll?.reponses[0]?.votes).toBe(7);
  });

  it("convertit les couleurs entieres de Discord", () => {
    expect(couleurDiscord(0)).toBeNull();
    expect(couleurDiscord(5_793_266)).toBe("#5865f2");
    expect(couleurDiscord("bleu")).toBeNull();
  });
});
