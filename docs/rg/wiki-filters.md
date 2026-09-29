# Gestion des filtres et détails du Wiki (Azalée)

Ce document explique le fonctionnement du filtrage et de la résolution des catégories/éléments dans le wiki d'Azalée (`apps/website/src/lib/wiki-service.ts`), suite aux corrections apportées pour pallier les limitations de la base de données.

## 1. Problématique de la Base de Données

Dans la table `inagle_skills` (techniques spéciales) :
* Les colonnes de clés étrangères `category_id` et `element_id` (de type integer) sont entièrement `NULL` dans la base de données active.
* Le champ `sheet_data` est également vide ou incomplet pour les techniques (les données sont dans la clé `data` de type JSONB).
* Les informations réelles de catégorie et d'élément sont stockées sous forme de texte brut en français dans les colonnes `category` et `element` (ex: `"Tir"`, `"Feu"`).

## 2. Solutions implémentées dans `wiki-service.ts`

### A. Filtrage dans la liste des techniques (`getSkillsList`)
Les paramètres passés à l'API de filtrage utilisent les termes en anglais (`shoot`, `block`, `Fire`, `Wind`, etc.). Puisque les colonnes de clés de la base de données sont `NULL`, nous traduisons dynamiquement ces paramètres vers leurs équivalents textuels en français pour interroger la base :

```typescript
// Exemple pour les éléments
const elementMap: Record<string, string> = {
    fire: "Feu",
    wind: "Vent",
    forest: "Forêt",
    mountain: "Montagne",
    void: "Néant"
};
const searchElem = elementMap[params.element.toLowerCase()] || params.element;
query = query.eq("element", searchElem);
```

```typescript
// Exemple pour les catégories
const categoryMap: Record<string, string> = {
    shoot: "Tir",
    block: "Défense",
    dribble: "Dribble",
    catch: "Arrêt"
};
const searchCat = categoryMap[params.category.toLowerCase()] || params.category;
query = query.eq("category", searchCat);
```

### B. Résolution dans la fiche technique (`getSkill` / `getSkillsList`)
Pour renvoyer les objets d'informations multilingues attendus par l'application (au lieu de `"Aucun"` / `"Néant"` provoqués par les `element_id`/`category_id` à `NULL`), les valeurs textuelles de la base sont traduites vers des structures multilingues :

```typescript
const elementMap: Record<string, { en: string; ja: string; fr: string }> = {
    Feu: { en: "Fire", ja: "火", fr: "Feu" },
    Vent: { en: "Wind", ja: "風", fr: "Vent" },
    Forêt: { en: "Forest", ja: "林", fr: "Forêt" },
    Montagne: { en: "Mountain", ja: "山", fr: "Montagne" },
    Néant: { en: "Void", ja: "無", fr: "Néant" },
    Aucun: { en: "Void", ja: "無", fr: "Néant" }
};

const categoryMap: Record<string, { en: string; ja: string; fr: string }> = {
    Tir: { en: "Shoot", ja: "シュート", fr: "Tir" },
    Dribble: { en: "Dribble", ja: "ドリブル", fr: "Dribble" },
    Défense: { en: "Block", ja: "ブロック", fr: "Défense" },
    Arrêt: { en: "Catch", ja: "キャッチ", fr: "Arrêt" }
};
```

### C. Gestion de l'Overdrive
La clé JSONB d'identification d'overdrive dans la table `inagle_skills` est `data->>skillID` et non `sheet_data->>skillID`. La requête a été corrigée en conséquence pour le filtre `overdrive=1`.

## 3. Gestion des auras et métadonnées (Keshins, Souls, Miximax, etc.)

Les auras (Esprits Guerriers, Totems, Miximax, Éveils, Changements de Mode) possèdent des liaisons spécifiques avec les joueurs dans le jeu, mais ont des structures complexes et contraintes.

### A. Pipeline d'ingestion et persistance (`cli-push.ts`)
Auparavant, l'upsert des auras écrasait ou ignorait les métadonnées de jeu. La pipeline a été corrigée pour insérer :
* Les objets bruts complets de l'extraction de jeu dans le champ `data` (JSONB).
* Les données de personnalisation communautaires et techniques dans le champ `sheet_data` (JSONB) pour toutes les tables (`inagle_keshins`, `inagle_souls`, `inagle_miximax`, `inagle_awakenings`, `inagle_mode_changes`).
* Le support de la description anglaise (`description_en`) de façon native.

### B. Liaison de Propriétaire manquante en base de données
Les tables d'auras en base de données ne possèdent pas de colonne `owner_chara_id` exploitable.
* **Solution** : Pour afficher le propriétaire ("Owner") de l'aura sur sa page de détails, `wiki-service.ts` fait un fallback de recherche automatique de liaison dans `change_aura_skills.json` (qui mappe les `id` d'auras vers les `charaParamId` de personnages propriétaires).

### C. Enrichissement de la fiche joueur
Dans la fiche d'un personnage (`apps/website/src/app/wiki/chara/[id]/page.tsx`), la fonction `getCharacterAuras` récupère désormais le champ `sheet_data` des auras et extrait :
* L'effet passif (`passiveEffect`)
* Le nom de la technique spéciale associée (`hissatsuName`)

Ces informations réelles de jeu sont passées en props aux cartes `AuraCard` pour un affichage enrichi et précis des techniques et des passifs d'auras associés au joueur.
