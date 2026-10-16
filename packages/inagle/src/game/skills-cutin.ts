/**
 * Types de cut-in des hissatsu. Les données canoniques sont servies par
 * `wikiService` depuis PostgreSQL (`inagle_skill_cutins`).
 *
 * Source : `nie-data/src/skill.rs::SkillInfo::cutin_assets()` — chemins VFS dérivés de
 * `event_id_name` + `skill_id_str`, vérifiés byte-exact sur whs00340. Permet à la page skill
 * d'afficher le modèle 3D du cut-in, le telop (nom rendu) par langue, et les assets son/effets,
 * tous déjà servis live par `nie-model-serve` (`/raw`, `/tex`, `/model-*`).
 */
/** Chemins VFS des assets de cut-in d'un hissatsu. */
export interface SkillCutin {
  event_id_name: string;
  model_g4mg: string;
  model_g4md: string;
  texture_g4tx: string;
  sound_cfg: string;
  effects_dir: string;
  /** `[langue, chemin .g4tx du telop]` par langue disponible (8 avec la MAJ du 2026-08-15 :
   * de/en/es/fr/it/pt/zh_hans/zh_hant). `string[][]`, pas un tuple : un import JSON brut
   * n'inférerait jamais `[string,string]` (TS widen systématiquement en `string[]`), et le
   * cast `as SkillsCutinFile` échouait le type-check de déploiement pour cette seule raison. */
  telop_by_lang: string[][];
}

/** Une entrée skill enrichie (identité + cut-in). */
export interface SkillCutinEntry {
  skill_id_str: string;
  skill_id: string;
  event_id_name: string;
  element: number;
  element_name: { fr: string; en: string; ja: string };
  category: number;
  category_name: { fr: string; en: string; ja: string };
  power_min: number;
  power_max: number;
  consume_tp: number;
  foul_rate: number;
  growth_type: number;
  recast_time: number;
  partner_type: number;
  cutin: SkillCutin | null;
}
