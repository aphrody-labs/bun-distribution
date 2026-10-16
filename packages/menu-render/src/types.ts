/**
 * Types TS du contrat menu-layout.json (re/menu-layout.schema.md).
 * Canvas de référence : 1280×720 px, origine haut-gauche.
 */

export interface MenuCanvas {
  w: number;
  h: number;
}

export interface MenuTransform {
  /** Position pixel du pivot (relatif au parent si parent != null, sinon absolu). */
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Rotation en radians. */
  rot: number;
  /** Pivot dans le sprite (0..1). 0.5/0.5 = centre. */
  anchorX: number;
  anchorY: number;
}

export interface MenuSprite {
  /** Chemin logique G4TX (avec <LG> résolu). */
  logicalPath: string;
  /** URL PNG relative à assetBase (fournie au composant). */
  pngUrl: string;
  /** Taille naturelle de la texture en pixels. */
  w: number;
  h: number;
}

export interface MenuText {
  /** Clé hashée dans common/text/<locale>. */
  key: string;
  keyHash: number;
  /** Valeur résolue pour la locale courante (= `localized.fr` par défaut azalee). */
  value: string;
  /**
   * Libellé résolu par locale (`resolve-menu-text.ts`), pour un futur switch de langue.
   * Absent sur les layouts non encore post-traités → le renderer retombe sur `value`.
   */
  localized?: { fr: string; en: string; ja: string };
  /** Nom de la font du jeu (nie_main, nie_bold, nie_mono, …). */
  font: string;
  /** Taille en pixels à 1280×720. */
  size: number;
  /** Couleur CSS hex. */
  color: string;
  /** Alignement CSS horizontal. */
  align: "left" | "center" | "right";
}

export interface MenuAnim {
  /** Nom de la motion G4MT pour l'ouverture. */
  open: string | null;
  /** Nom de la motion G4MT pour la fermeture. */
  close: string | null;
}

export interface MenuPrimitive {
  /** Type de primitive (rect, circle, …). */
  type: string;
  /** Largeur en px. */
  w: number;
  /** Hauteur en px. */
  h: number;
  /** Couleur de remplissage CSS. */
  color: string;
  /** Opacité 0..1. */
  alpha: number;
}

export interface MenuObject {
  /** Nom du gmdMenuObj / objbin. */
  name: string;
  /** Nom du parent dans l'arbre, ou null si racine. */
  parent: string | null;
  transform: MenuTransform;
  /**
   * z-order de rendu (CMenuRenderComponent.m_drawPriority).
   * Valeur haute = au-dessus.
   */
  drawPriority: number;
  /** m_drawType (0 = normal, 1 = additive, 2 = multiplicative, …). */
  drawType: number;
  /** m_cameraName (ex: "menu", "bg"). */
  camera: string;
  /** Sprite G4TX (peut être null si texte-only ou primitive). */
  sprite: MenuSprite | null;
  /** Texte MenuTextSetting (peut être null). */
  text: MenuText | null;
  /** Animations open/close (noms motions G4MT). */
  anim: MenuAnim | null;
  /** Primitive CMenuCreatePrimitiveComponent (peut être null). */
  primitive: MenuPrimitive | null;
  /** Modèle 3D CMenuCharaModelComponent (phase 3D, null pour l'instant). */
  charModel: null;
}

export interface MenuLayout {
  /** Identifiant de l'écran (= dossier dx11/menu). */
  screen: string;
  /** Locale de rendu (en|fr|de|it|es|pt|ja|zh_hans|zh_hant). */
  locale: string;
  canvas: MenuCanvas;
  objects: MenuObject[];
}
