/**
 * Couverture des règles que les actions serveur du staff appliquent.
 *
 * Remplace `test-staff.ts`, un script mort : il s'annonçait en
 * `node --loader ts-node/esm` (interdit ici, Bun uniquement), n'appelait jamais
 * sa fonction (`// TestStaff();`, avec une majuscule qui ne correspondait à
 * rien), ne contenait aucune assertion, et importait un module `"use server"`
 * qui ne s'exécute pas hors d'un rendu Next.
 *
 * Les actions délèguent la totalité de leur validation, de leur normalisation et
 * de leur tri à `staff-schema.ts` : le tester revient à tester leur
 * comportement observable, sans démarrer l'application ni toucher la base.
 *
 * Exécution : `bun test apps/website/src/app/admin/staff/staff.test.ts`
 */
import { describe, expect, test } from "bun:test";

import {
  avecNomEquipe,
  comparerMembres,
  comparerMembresParNom,
  construireCheminImage,
  construireUrlPubliqueAsset,
  messagesParChamp,
  premierMessage,
  schemaIdentifiant,
  schemaMembre,
  schemaMiseAJourMembre,
  TAILLE_MAX_IMAGE,
  validerFichierImage,
} from "./staff-schema";
import { EQUIPES, estIdEquipe, libelleEquipe, NOMBRE_EQUIPES, rangEquipe } from "./teams";

const MEMBRE_MINIMAL = {
  name: "Jean Dupont",
  role: "Développeur",
  team_id: "loreteam",
};

describe("référentiel des équipes", () => {
  test("les identifiants sont uniques et correspondent à ceux stockés en base", () => {
    const ids = EQUIPES.map(equipe => equipe.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("assoteam");
    expect(ids).toContain("collabteam");
    expect(ids.length).toBe(NOMBRE_EQUIPES);
  });

  test("chaque équipe a un libellé, et un identifiant inconnu se rend tel quel", () => {
    expect(libelleEquipe("assoteam")).toBe("Membres de l'Association");
    expect(libelleEquipe("equipe-fantome")).toBe("equipe-fantome");
    expect(estIdEquipe("loreteam")).toBe(true);
    expect(estIdEquipe("loreteam ")).toBe(false);
  });

  test("les équipes inconnues sont reléguées en fin de tri", () => {
    expect(rangEquipe("bureauteam")).toBe(0);
    expect(rangEquipe("equipe-fantome")).toBe(NOMBRE_EQUIPES);
  });
});

describe("validation d'un membre", () => {
  test("accepte un membre minimal et active par défaut", () => {
    const resultat = schemaMembre.safeParse(MEMBRE_MINIMAL);
    expect(resultat.success).toBe(true);
    expect(resultat.data?.is_active).toBe(true);
    expect(resultat.data?.display_index).toBeNull();
    expect(resultat.data?.member_link).toBeNull();
    expect(resultat.data?.discord_user_id).toBeNull();
  });

  test("refuse un nom vide ou uniquement composé d'espaces", () => {
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, name: "" }).success).toBe(false);
    const resultat = schemaMembre.safeParse({ ...MEMBRE_MINIMAL, name: "   " });
    expect(resultat.success).toBe(false);
    expect(premierMessage(resultat.error!)).toBe("Le nom est obligatoire.");
  });

  test("refuse une équipe hors référentiel", () => {
    const resultat = schemaMembre.safeParse({ ...MEMBRE_MINIMAL, team_id: "equipe-fantome" });
    expect(resultat.success).toBe(false);
    expect(messagesParChamp(resultat.error!).team_id).toBe("Sélectionnez une équipe valide.");
  });

  test("rogne les espaces autour du nom et du rôle", () => {
    const resultat = schemaMembre.safeParse({
      ...MEMBRE_MINIMAL,
      name: "  Jean Dupont  ",
      role: "  Dessinateur ",
    });
    expect(resultat.data?.name).toBe("Jean Dupont");
    expect(resultat.data?.role).toBe("Dessinateur");
  });

  test("un champ facultatif vidé devient NULL et non `undefined`", () => {
    // Régression : le formulaire envoyait `undefined`, clé retirée à la
    // sérialisation, si bien qu'aucun champ ne pouvait jamais être effacé.
    const resultat = schemaMembre.safeParse({
      ...MEMBRE_MINIMAL,
      discord_user_id: "",
      display_index: "",
      image_url: "",
      member_link: "   ",
    });
    expect(resultat.success).toBe(true);
    expect(resultat.data).toMatchObject({
      discord_user_id: null,
      display_index: null,
      image_url: null,
      member_link: null,
    });
    expect(Object.hasOwn(resultat.data!, "member_link")).toBe(true);
  });

  test("l'ordre accepte une chaîne numérique et refuse le reste", () => {
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, display_index: "12" }).data?.display_index).toBe(12);
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, display_index: 7 }).data?.display_index).toBe(7);
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, display_index: "abc" }).success).toBe(false);
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, display_index: "1.5" }).success).toBe(false);
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, display_index: "-3" }).success).toBe(false);
    // `display_index` est un smallint : 40000 casserait l'INSERT côté Postgres.
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, display_index: "40000" }).success).toBe(false);
  });

  test("l'identifiant Discord doit être un flocon de 17 à 20 chiffres", () => {
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, discord_user_id: "531549483067244566" }).success).toBe(true);
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, discord_user_id: "1234" }).success).toBe(false);
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, discord_user_id: "pas-un-identifiant" }).success).toBe(false);
  });

  test("le lien de profil doit être une URL http(s)", () => {
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, member_link: "https://rosegriffon.fr" }).success).toBe(true);
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, member_link: "rosegriffon.fr" }).success).toBe(false);
    // Une URL `javascript:` passerait `new URL()` : elle doit être refusée.
    expect(schemaMembre.safeParse({ ...MEMBRE_MINIMAL, member_link: "javascript:alert(1)" }).success).toBe(false);
  });

  test("la mise à jour partielle n'invente aucun champ", () => {
    const resultat = schemaMiseAJourMembre.safeParse({ is_active: false });
    expect(resultat.success).toBe(true);
    expect(Object.keys(resultat.data!)).toEqual(["is_active"]);
    expect(resultat.data!.is_active).toBe(false);
  });

  test("la mise à jour partielle valide quand même les champs fournis", () => {
    expect(schemaMiseAJourMembre.safeParse({ name: "" }).success).toBe(false);
    expect(schemaMiseAJourMembre.safeParse({ team_id: "equipe-fantome" }).success).toBe(false);
  });

  test("l'identifiant du membre doit être un UUID", () => {
    expect(schemaIdentifiant.safeParse("05b9a15f-cd49-4908-8046-ed997d266957").success).toBe(true);
    expect(schemaIdentifiant.safeParse("1 OR 1=1").success).toBe(false);
    expect(schemaIdentifiant.safeParse("").success).toBe(false);
  });
});

describe("dérivation de team_name", () => {
  test("le libellé est toujours dérivé de l'identifiant d'équipe", () => {
    // 30 lignes avaient `team_name` à NULL et `assoteam` portait deux libellés
    // concurrents ; la colonne est lue publiquement sur /profil/[username].
    expect(avecNomEquipe({ team_id: "assoteam" }).team_name).toBe("Membres de l'Association");
    expect(avecNomEquipe({ team_id: "mediationteam" }).team_name).toBe("Cellule de Médiation");
  });

  test("une mise à jour sans équipe ne touche pas au libellé", () => {
    const misAJour: { is_active: boolean; team_id?: string } = { is_active: false };
    expect(avecNomEquipe(misAJour)).toEqual({ is_active: false });
  });
});

describe("photos de membres", () => {
  test("refuse un format non image, un fichier vide ou trop lourd", () => {
    expect(validerFichierImage({ name: "a.pdf", size: 10, type: "application/pdf" }).ok).toBe(false);
    expect(validerFichierImage({ name: "a.png", size: 0, type: "image/png" }).ok).toBe(false);
    expect(validerFichierImage({ name: "a.png", size: TAILLE_MAX_IMAGE + 1, type: "image/png" }).ok).toBe(false);
    expect(validerFichierImage({ name: "a.png", size: 2048, type: "image/png" }).ok).toBe(true);
    expect(validerFichierImage({ name: "a.webp", size: 2048, type: "image/webp" }).ok).toBe(true);
  });

  test("l'extension vient du type MIME, jamais du nom fourni par le client", () => {
    // `file.name.split(".").pop()` produisait un chemin terminé par le nom
    // entier pour un fichier sans extension, et laissait passer une entrée
    // hostile dans le chemin de l'objet Storage.
    expect(construireCheminImage("image/png", "abc123")).toBe("team-members/abc123.png");
    expect(construireCheminImage("image/jpeg", "abc123")).toBe("team-members/abc123.jpg");
    const chemin = construireCheminImage("image/png", "../../etc/passwd");
    expect(chemin.includes("..")).toBe(false);
    expect(chemin.split("/")).toHaveLength(2);
  });

  test("l'URL publique n'est jamais l'origine interne du VPS", () => {
    // `getPublicUrl()` du client service renvoie SUPABASE_INTERNAL_URL :
    // injoignable depuis un navigateur, et absente de `images.remotePatterns`.
    const url = construireUrlPubliqueAsset("team-members/abc.png", ["http://127.0.0.1:8811", "https://rosegriffon.fr"]);
    expect(url).toBe("https://rosegriffon.fr/storage/v1/object/public/assets/team-members/abc.png");
  });

  test("les origines locales ou privées sont écartées, avec repli sur le domaine public", () => {
    for (const origine of ["http://localhost:3000", "http://192.168.1.10", "http://10.0.0.4", ""]) {
      expect(construireUrlPubliqueAsset("x.png", [origine])).toBe(
        "https://rosegriffon.fr/storage/v1/object/public/assets/x.png",
      );
    }
    expect(construireUrlPubliqueAsset("x.png", [])).toBe(
      "https://rosegriffon.fr/storage/v1/object/public/assets/x.png",
    );
  });

  test("la première origine publique gagne, sans slash en double", () => {
    expect(construireUrlPubliqueAsset("/x.png", ["https://rosegriffon.fr/"])).toBe(
      "https://rosegriffon.fr/storage/v1/object/public/assets/x.png",
    );
  });
});

describe("ordre d'affichage", () => {
  const membres = [
    { display_index: null, name: "Zoé" },
    { display_index: 2, name: "Bea" },
    { display_index: null, name: "Alex" },
    { display_index: 2, name: "Ana" },
    { display_index: 1, name: "Yann" },
  ];

  test("reproduit exactement le tri du site public", () => {
    // `get-team-members.ts` : ORDER BY display_index ASC NULLS LAST, name ASC.
    expect(membres.toSorted(comparerMembres).map(m => m.name)).toEqual(["Yann", "Ana", "Bea", "Alex", "Zoé"]);
  });

  test("le tri alphabétique respecte les règles françaises", () => {
    expect(
      [
        { display_index: null, name: "Émile" },
        { display_index: null, name: "Eva" },
      ]
        .toSorted(comparerMembresParNom)
        .map(m => m.name),
    ).toEqual(["Émile", "Eva"]);
  });
});
