import { describe, expect, test } from "bun:test";

import {
  CONNEXIONS,
  DESCRIPTIONS,
  aIdentiteNative,
  connexionsAuthentifiantes,
  etatCompte,
  peutDelier,
  type Compte,
  type ConnexionLiee,
} from "../src/index";

const profil = { nomAffiche: "Membre" };
const email: ConnexionLiee = {
  type: "email",
  adresse: "membre@exemple.fr",
  libelle: "membre@exemple.fr",
  verifiee: true,
  motDePasseConfigure: true,
};
const discord: ConnexionLiee = {
  type: "discord",
  identifiant: "discord-123",
  libelle: "membre",
};
const google: ConnexionLiee = { type: "google", identifiant: "google-456" };
const patreon: ConnexionLiee = { type: "patreon", identifiant: "patreon-789" };
const achillea: ConnexionLiee = { type: "achillea", identifiant: "achillea-012" };

function compte(connexions: readonly ConnexionLiee[]): Compte {
  return { id: "compte-1", profil, connexions };
}

describe("registre des connexions", () => {
  test("décrit exhaustivement chaque type déclaré", () => {
    expect(CONNEXIONS).toEqual(["email", "discord", "patreon", "twitch", "google", "steam", "achillea"]);
    expect(Object.keys(DESCRIPTIONS).sort()).toEqual([...CONNEXIONS].sort());
  });
});

describe("méthodes d'accès", () => {
  test("reconnaît l'e-mail vérifié avec mot de passe et les fournisseurs OAuth", () => {
    expect(connexionsAuthentifiantes([email, discord, patreon])).toEqual([email, discord, patreon]);
  });

  test("un e-mail non vérifié, sans mot de passe ou invalidé n'ouvre pas de session", () => {
    const nonVerifie: ConnexionLiee = { ...email, verifiee: false };
    const sansMotDePasse: ConnexionLiee = { ...email, motDePasseConfigure: false };
    const revoque: ConnexionLiee = { ...discord, valide: false };
    expect(connexionsAuthentifiantes([nonVerifie, sansMotDePasse, revoque])).toEqual([]);
  });

  test("seul un e-mail natif réellement utilisable rend le compte autonome", () => {
    expect(aIdentiteNative([email])).toBe(true);
    expect(aIdentiteNative([{ ...email, verifiee: false }, discord])).toBe(false);
  });
});

describe("peutDelier", () => {
  test("autorise le cas nominal quand une autre méthode valide subsiste", () => {
    expect(peutDelier(compte([email, discord]), "discord")).toEqual({ autorise: true });
    expect(peutDelier(compte([email, discord]), "email")).toEqual({ autorise: true });
  });

  test("refuse de supprimer la dernière méthode d'authentification", () => {
    expect(peutDelier(compte([discord, { type: "steam", identifiant: "steam-123" }]), "discord")).toEqual({
      autorise: false,
      raison: "derniere_methode_acces",
    });
    expect(peutDelier(compte([email]), "email")).toEqual({
      autorise: false,
      raison: "derniere_methode_acces",
    });
    expect(peutDelier(compte([patreon]), "patreon")).toEqual({
      autorise: false,
      raison: "derniere_methode_acces",
    });
  });

  test("ignore comme secours les liaisons invalides et l'e-mail non vérifié", () => {
    expect(
      peutDelier(compte([{ ...email, verifiee: false }, discord, { ...google, valide: false }]), "discord"),
    ).toEqual({ autorise: false, raison: "derniere_methode_acces" });
  });

  test("gère un compte avec plusieurs fournisseurs", () => {
    expect(peutDelier(compte([discord, google, patreon]), "discord")).toEqual({
      autorise: true,
    });
    expect(peutDelier(compte([discord, google, patreon]), "google")).toEqual({
      autorise: true,
    });
  });

  test("autorise une liaison de capacité, même si elle n'ouvre pas de session", () => {
    expect(peutDelier(compte([{ type: "steam", identifiant: "steam-123" }]), "steam")).toEqual({
      autorise: true,
    });
    expect(peutDelier(compte([discord, achillea]), "achillea")).toEqual({
      autorise: true,
    });
  });

  test("refuse une connexion absente du compte", () => {
    expect(peutDelier(compte([email]), "steam")).toEqual({
      autorise: false,
      raison: "connexion_non_liee",
    });
  });
});

describe("état de la page compte", () => {
  test("avertit seulement les comptes sans identité native utilisable", () => {
    expect(etatCompte([discord]).avertissement).toContain("adresse e-mail");
    expect(etatCompte([{ ...email, motDePasseConfigure: false }]).avertissement).toContain("adresse e-mail");
    expect(etatCompte([email, discord]).avertissement).toBeNull();
  });

  test("ne propose que les connexions non liées", () => {
    const proposees = etatCompte([email, discord]).disponibles.map(c => c.id);
    expect(proposees).not.toContain("email");
    expect(proposees).not.toContain("discord");
    expect(proposees).toContain("achillea");
  });
});
