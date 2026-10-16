"use client";

import { useMemo, useReducer, useState } from "react";
import { cdnOrigin } from "@rosegriffon/assets";
import { Button } from "@rosegriffon/ui/button";
import { Input } from "@rosegriffon/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@rosegriffon/ui/select";
import { Modele3D, CurseurAtelier } from "./Modele3D";
import { ImportAvatar } from "./ImportAvatar";
import { Partage } from "./PanneauPartage";
import { encoder, specDe, valeursDepuisChoix, verifierSpec } from "./partage";
import {
  lireProjet,
  nouveauProjet,
  reduireProjet,
  telecharger,
  type EtatAvatar,
  type Projet,
} from "./projet";
import { iconePart, nomPart, NOMS_CATEGORIES } from "./liaisons";
import type { Catalogue } from "./types";
import "./atelier.css";

const CATEGORIES_MASQUEES = new Set([1, 16, 17, 18]);

/**
 * Les champs d'auteur voyagent avec la recette sans devenir des réglages de composition.
 * Le préfixe `fiche.` garde cette extension compatible avec les projets existants.
 */
const CHAMPS_FICHE: Array<{ cle: string; libelle: string; exemple: string; long?: boolean }> = [
  { cle: "fiche.surnom", libelle: "Surnom", exemple: "Le marchand de sable" },
  { cle: "fiche.pronoms", libelle: "Pronoms", exemple: "iel / il" },
  { cle: "fiche.age", libelle: "Âge", exemple: "10 à 12 ans" },
  { cle: "fiche.taille", libelle: "Taille", exemple: "162 cm" },
  { cle: "fiche.univers", libelle: "Univers", exemple: "Inazuma Eleven — saison 1" },
  {
    cle: "fiche.notes",
    libelle: "Notes",
    exemple: "Yeux caméléon, frange rousse sur blond rosé…",
    long: true,
  },
];

/** Pose ou retire une valeur : une clé vide ne doit pas gonfler le JSON partagé. */
function champsAvec(
  champs: Record<string, string>,
  cle: string,
  valeur: string,
): Record<string, string> {
  const suite = { ...champs };
  if (valeur.trim()) suite[cle] = valeur;
  else delete suite[cle];
  return suite;
}

/** Le serveur reste propriétaire de l’assemblage ; l’atelier édite sa recette. */
export function Atelier({
  catalogue,
  avatar,
  restaurer,
  url,
  cdn,
  codeInitial = "",
}: {
  catalogue: Catalogue;
  avatar: EtatAvatar;
  restaurer: (a: EtatAvatar) => void;
  url: string | null;
  cdn?: string;
  codeInitial?: string;
}) {
  const [h, dispatch] = useReducer(reduireProjet, avatar, (a) => ({
    passes: [],
    present: nouveauProjet(a),
    futurs: [],
  }));
  const [categorie, setCategorie] = useState(4);
  const [recherche, setRecherche] = useState("");
  const [message, setMessage] = useState("");
  const [importLocal, setImportLocal] = useState(false);
  const [partageOuvert, setPartageOuvert] = useState(codeInitial.length > 0);
  const p = h.present;
  const categories = catalogue.categories.filter(
    (c) => c.parts.length && !CATEGORIES_MASQUEES.has(c.faceSettingType),
  );
  const cat = categories.find((c) => c.faceSettingType === categorie) ?? categories[0];
  const active = cat?.faceSettingType ?? categorie;
  const origine =
    cdn ??
    (url?.includes("/model-avatar/") ? url.slice(0, url.indexOf("/model-avatar/")) : cdnOrigin());
  const selection = cat?.parts.find((part) => part.id === p.avatar.choix[active]);
  const pieces =
    cat?.parts
      .map((part, index) => ({ part, nom: nomPart(part, index) }))
      .filter(({ nom }) =>
        nom.toLocaleLowerCase("fr").includes(recherche.toLocaleLowerCase("fr")),
      ) ?? [];
  const modifier = (projet: Projet) => {
    dispatch({ type: "modifier", projet });
    restaurer(projet.avatar);
  };
  const changerAvatar = (suite: Partial<EtatAvatar>) =>
    modifier({ ...p, avatar: { ...p.avatar, ...suite } });
  const parcourir = (type: "annuler" | "retablir") => {
    const suite = reduireProjet(h, { type });
    dispatch({ type });
    restaurer(suite.present.avatar);
  };
  const codePartage = useMemo(() => {
    const spec = specDe(catalogue);
    if (!spec || verifierSpec(spec) !== null) return null;
    return encoder(
      spec,
      valeursDepuisChoix(catalogue, spec, p.avatar.choix, p.avatar.genre, p.avatar.morphologie),
    );
  }, [catalogue, p.avatar]);
  const restaurerSauvegarde = (suite: EtatAvatar) => {
    modifier({ ...p, avatar: suite });
    setPartageOuvert(false);
  };
  if (importLocal) return <ImportAvatar retour={() => setImportLocal(false)} />;
  return (
    <section className="nie-atelier" aria-label="Atelier 3D NIE">
      <header className="atelier-entete">
        <div className="atelier-titre">
          <h1>Atelier avatar</h1>
          <p>Votre personnage, pièce par pièce.</p>
        </div>
        <div className="atelier-actions">
          <Button variant="outline" onClick={() => setImportLocal(true)}>
            Importer 2D / 3D
          </Button>
          <Button
            variant="outline"
            disabled={!h.passes.length}
            onClick={() => parcourir("annuler")}
          >
            Annuler
          </Button>
          <Button
            variant="outline"
            disabled={!h.futurs.length}
            onClick={() => parcourir("retablir")}
          >
            Rétablir
          </Button>
          <Button variant="outline" onClick={() => setPartageOuvert(true)}>
            Compte et partage
          </Button>
          <Button
            onClick={() => {
              telecharger(
                new Blob([JSON.stringify(p, null, 2)], { type: "application/json" }),
                "avatar.nie.json",
              );
              setMessage("Projet exporté : conservez le fichier pour reprendre votre travail.");
            }}
          >
            Enregistrer le projet
          </Button>
        </div>
      </header>
      <output className="atelier-statut">
        {message || "Le projet conserve vos pièces et vos transformations."}
      </output>
      <div className="atelier-espace">
        <aside className="atelier-bibliotheque atelier-panneau" aria-label="Bibliothèque de pièces">
          <div className="atelier-section-titre">
            <h2>Bibliothèque</h2>
            <span>{cat?.parts.length ?? 0} pièces</span>
          </div>
          <label htmlFor="route-avatar-Atelier-tsx-1" className="atelier-champ">
            <span>Catégorie</span>
            <Select
              value={String(active)}
              disabled={!categories.length}
              onValueChange={(value) => {
                setCategorie(Number(value));
                setRecherche("");
              }}
            >
              <SelectTrigger id="route-avatar-Atelier-tsx-1" aria-label="Catégorie de pièces">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="atelier-menu">
                {categories.map((c) => (
                  <SelectItem key={c.faceSettingType} value={String(c.faceSettingType)}>
                    {NOMS_CATEGORIES[c.faceSettingType] ?? `Pièces ${c.faceSettingType}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label htmlFor="route-avatar-Atelier-tsx-2" className="atelier-champ">
            <span>Rechercher une pièce</span>
            <Input
              id="route-avatar-Atelier-tsx-2"
              type="search"
              placeholder="Nom de la pièce…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
          </label>
          <div className="atelier-pieces" aria-label={NOMS_CATEGORIES[active] ?? "Pièces"}>
            {pieces.map(({ part, nom }) => {
              const vignette = iconePart(origine, part);
              return (
                <Button
                  key={part.id}
                  variant="outline"
                  className="atelier-piece"
                  aria-label={nom}
                  aria-pressed={selection?.id === part.id}
                  data-part-id={part.id}
                  data-category={active}
                  data-icon-hash={part.iconeHash}
                  data-model-paths={JSON.stringify([...part.modeles, ...(part.modeles2 ?? [])])}
                  onClick={() => changerAvatar({ choix: { ...p.avatar.choix, [active]: part.id } })}
                >
                  <VignettePiece key={vignette ?? part.id} url={vignette} />
                  <span className="atelier-piece-nom">{nom}</span>
                  {selection?.id === part.id && (
                    <span className="atelier-selection" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </Button>
              );
            })}
          </div>
          {!pieces.length && (
            <p className="atelier-note">Aucune pièce ne correspond à cette recherche.</p>
          )}
          <p className="atelier-note" data-unsupported-category="18">
            Poitrine : réglage non pris en charge. Les préréglages de visage et de genre ne sont pas
            proposés ici.
          </p>
        </aside>
        <div className="atelier-scene" aria-label="Scène 3D">
          <div className="atelier-scene-titre">
            <span>{p.nom || "Sans titre"}</span>
            <span>Vue 3D</span>
          </div>
          {url ? (
            <Modele3D url={url} transformation={p.transformation} edition />
          ) : (
            <div className="atelier-vide">
              <h2>Aperçu indisponible</h2>
              <p>Choisissez une autre composition pour lancer l’assemblage.</p>
            </div>
          )}
        </div>
        <aside className="atelier-inspecteur atelier-panneau" aria-label="Inspecteur">
          <h2>Inspecteur</h2>
          <label htmlFor="route-avatar-Atelier-tsx-3" className="atelier-champ">
            <span>Nom du projet</span>
            <Input
              id="route-avatar-Atelier-tsx-3"
              maxLength={120}
              value={p.nom}
              onChange={(e) => modifier({ ...p, nom: e.target.value })}
            />
          </label>
          <label htmlFor="route-avatar-Atelier-tsx-4" className="atelier-champ">
            <span>Morphologie</span>
            <Select
              value={String(p.avatar.morphologie)}
              onValueChange={(value) => {
                const choix = { ...p.avatar.choix };
                delete choix[17];
                const morphologie = Number(value);
                changerAvatar({
                  choix,
                  morphologie,
                  genre: catalogue.modelesDeBase.morphologies[morphologie] === "female" ? 1 : 0,
                });
              }}
            >
              <SelectTrigger id="route-avatar-Atelier-tsx-4" aria-label="Morphologie">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="atelier-menu">
                {catalogue.modelesDeBase.morphologies.map((nom, i) => (
                  <SelectItem key={`${nom}-${i}`} value={String(i)}>
                    {nom}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="atelier-groupe">
            <h3>{NOMS_CATEGORIES[active] ?? "Pièce"}</h3>
            <p className="atelier-note">
              {selection
                ? nomPart(selection, cat!.parts.indexOf(selection))
                : "Composition par défaut — choisissez une pièce dans la bibliothèque."}
            </p>
            {cat && [3, 4, 6].includes(active) && (
              <label htmlFor="route-avatar-Atelier-tsx-5" className="atelier-champ">
                <span>Couleur</span>
                <Select
                  value={String(p.avatar.valeurs[`couleur.${active}`] ?? -1)}
                  onValueChange={(value) =>
                    changerAvatar({
                      valeurs: { ...p.avatar.valeurs, [`couleur.${active}`]: Number(value) },
                    })
                  }
                >
                  <SelectTrigger id="route-avatar-Atelier-tsx-5" aria-label="Couleur de la pièce">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="atelier-menu">
                    <SelectItem value="-1">Couleur par défaut</SelectItem>
                    {cat.couleurs.map((id, i) =>
                      catalogue.couleursRgb?.[id] ? (
                        <SelectItem key={`${id}-${i}`} value={String(i)}>
                          <span
                            className="atelier-echantillon"
                            style={{ backgroundColor: `#${catalogue.couleursRgb[id].rgb}` }}
                          />
                          #{catalogue.couleursRgb[id].rgb}
                        </SelectItem>
                      ) : null,
                    )}
                  </SelectContent>
                </Select>
              </label>
            )}
            {cat && [3, 4, 6].includes(active) && (
              <CouleurLibre
                cle={`couleur.libre.${active}`}
                libre={p.avatar.champs[`couleur.libre.${active}`] ?? ""}
                palette={
                  catalogue.couleursRgb?.[
                    cat.couleurs[p.avatar.valeurs[`couleur.${active}`] ?? -1] ?? ""
                  ]?.rgb ?? ""
                }
                changer={(hex) =>
                  changerAvatar({
                    champs: champsAvec(p.avatar.champs, `couleur.libre.${active}`, hex),
                  })
                }
              />
            )}
          </div>
          <div className="atelier-groupe">
            <h3>Objet complet</h3>
            <CurseurAtelier
              label="Rotation Y"
              valeur={p.transformation.rotation}
              unite="°"
              min={-180}
              max={180}
              step={5}
              changer={(rotation) =>
                modifier({ ...p, transformation: { ...p.transformation, rotation } })
              }
            />
            <CurseurAtelier
              label="Échelle"
              valeur={p.transformation.echelle}
              unite="×"
              min={0.25}
              max={4}
              step={0.05}
              changer={(echelle) =>
                modifier({ ...p, transformation: { ...p.transformation, echelle } })
              }
            />
            <Button
              variant="outline"
              className="atelier-bouton-large"
              onClick={() => modifier({ ...p, transformation: { rotation: 0, echelle: 1 } })}
            >
              Réinitialiser les transformations
            </Button>
            <p className="atelier-note">
              Glissez pour orbiter, utilisez la molette pour zoomer. Les transformations portent sur
              l’objet entier.
            </p>
          </div>
          <div className="atelier-groupe">
            <h3>Fiche du personnage</h3>
            <p className="atelier-note">
              Ces champs voyagent avec le projet. Ils ne changent pas la composition 3D : ils
              décrivent le personnage original.
            </p>
            {CHAMPS_FICHE.map(({ cle, libelle, exemple, long }) => (
              <label key={cle} className="atelier-champ">
                <span>{libelle}</span>
                {long ? (
                  <textarea
                    className="atelier-zone-texte"
                    rows={4}
                    maxLength={500}
                    placeholder={exemple}
                    value={p.avatar.champs[cle] ?? ""}
                    onChange={(e) =>
                      changerAvatar({ champs: champsAvec(p.avatar.champs, cle, e.target.value) })
                    }
                  />
                ) : (
                  <Input
                    maxLength={500}
                    placeholder={exemple}
                    value={p.avatar.champs[cle] ?? ""}
                    onChange={(e) =>
                      changerAvatar({ champs: champsAvec(p.avatar.champs, cle, e.target.value) })
                    }
                  />
                )}
              </label>
            ))}
          </div>
          <div className="atelier-groupe">
            <label htmlFor="route-avatar-Atelier-tsx-6" className="atelier-champ">
              <span>Ouvrir un projet</span>
              <Input
                id="route-avatar-Atelier-tsx-6"
                aria-label="Ouvrir un projet JSON"
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const fichier = e.target.files?.[0];
                  e.target.value = "";
                  if (!fichier) return;
                  try {
                    if (fichier.size > 100_000)
                      throw new Error("Projet trop volumineux (100 Ko maximum).");
                    modifier(lireProjet(await fichier.text(), catalogue));
                    setMessage("Projet ouvert. Annuler restaure le projet précédent.");
                  } catch (erreur) {
                    setMessage(erreur instanceof Error ? erreur.message : "Lecture impossible.");
                  }
                }}
              />
            </label>
            <p className="atelier-note">
              Le JSON conserve la recette éditable. Le GLB est un instantané 3D, pas une sauvegarde
              du jeu.
            </p>
          </div>
        </aside>
      </div>
      {partageOuvert && (
        <Partage
          etat={p.avatar}
          code={codePartage}
          codeInitial={codeInitial}
          restaurer={restaurerSauvegarde}
          fermer={() => setPartageOuvert(false)}
        />
      )}
    </section>
  );
}

/**
 * Couleur libre : la palette reste la valeur par défaut, mais l'auteur peut fournir
 * une teinte exacte sans inventer une nouvelle entrée dans le catalogue du jeu.
 */
function CouleurLibre({
  cle,
  libre,
  palette,
  changer,
}: {
  cle: string;
  libre: string;
  palette: string;
  changer: (hex: string) => void;
}) {
  const [draft, setDraft] = useState({ cle, libre, saisie: libre });
  const saisie = draft.cle === cle && draft.libre === libre ? draft.saisie : libre;
  const setSaisie = (value: string) => setDraft({ cle, libre, saisie: value });
  const fallback = /^[0-9A-Fa-f]{6}$/.test(palette) ? palette : "9A8F86";
  const apercu = `#${(/^[0-9A-Fa-f]{6}$/.test(libre) ? libre : fallback).replace(/^#/, "")}`;

  return (
    <div className="atelier-champ">
      <span>Couleur libre</span>
      <div className="atelier-couleur-libre">
        <input
          type="color"
          aria-label="Choisir une couleur libre"
          value={apercu}
          onChange={(e) => {
            const hex = e.target.value.slice(1).toUpperCase();
            setSaisie(hex);
            changer(hex);
          }}
        />
        <Input
          aria-label="Couleur libre en hexadécimal"
          maxLength={7}
          placeholder="#A9571F"
          value={saisie ? `#${saisie}` : ""}
          onChange={(e) => {
            const hex = e.target.value
              .replace(/[^0-9A-Fa-f]/g, "")
              .slice(0, 6)
              .toUpperCase();
            setSaisie(hex);
            if (hex.length === 6 || hex.length === 0) changer(hex);
          }}
        />
        <Button
          variant="outline"
          disabled={!libre}
          onClick={() => {
            setSaisie("");
            changer("");
          }}
        >
          Palette
        </Button>
      </div>
      <p className="atelier-note">
        {libre
          ? "Cette teinte remplace la palette du jeu."
          : "Aucune teinte libre : la palette du jeu décide."}
      </p>
    </div>
  );
}

function VignettePiece({ url }: { url: string | null }) {
  const [erreur, setErreur] = useState(false);
  return (
    <span className="atelier-vignette">
      {url && !erreur ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          width={88}
          height={88}
          onError={() => setErreur(true)}
        />
      ) : (
        <span className="atelier-vignette-absente">
          Aperçu {erreur ? "indisponible" : "non fourni"}
        </span>
      )}
    </span>
  );
}
