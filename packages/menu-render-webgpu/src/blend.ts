/**
 * Table de blend WebGPU par `drawType` (CMenuRenderComponent.m_drawType).
 *
 * Les textures sont chargées en **premultiplied alpha** (`premultiplyAlpha:'premultiply'`)
 * et le canvas est configuré `alphaMode:'premultiplied'` → les facteurs ci-dessous sont
 * exprimés pour des couleurs prémultipliées (src.rgb déjà × src.a).
 *
 * | drawType | sémantique      | blend (premultiplied)                                  |
 * |----------|-----------------|--------------------------------------------------------|
 * | 0 normal | alpha over      | color: one / one-minus-src-alpha ; alpha: idem         |
 * | 1 add    | additive        | color: one / one ; alpha: one / one                    |
 * | 2 mult   | multiplicative  | color: dst / zero ; alpha: dst / zero                  |
 *
 * Toute valeur inconnue retombe sur `0` (alpha over).
 */

/** Type miroir de `GPUBlendState` (sans dépendre de @webgpu/types côté logique pure testée). */
export interface BlendComponent {
  operation: "add" | "subtract" | "reverse-subtract" | "min" | "max";
  srcFactor: GPUBlendFactor;
  dstFactor: GPUBlendFactor;
}

export interface BlendState {
  color: BlendComponent;
  alpha: BlendComponent;
}

const OVER: BlendState = {
  color: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one-minus-src-alpha" },
};

const ADDITIVE: BlendState = {
  color: { operation: "add", srcFactor: "one", dstFactor: "one" },
  alpha: { operation: "add", srcFactor: "one", dstFactor: "one" },
};

const MULTIPLY: BlendState = {
  color: { operation: "add", srcFactor: "dst", dstFactor: "zero" },
  alpha: { operation: "add", srcFactor: "dst", dstFactor: "zero" },
};

/** Les trois `drawType` supportés, dans l'ordre de leur identifiant. */
export const DRAW_TYPES: readonly number[] = [0, 1, 2];

/** Retourne l'état de blend WebGPU pour un `drawType` donné. */
export function blendForDrawType(drawType: number): BlendState {
  switch (drawType) {
    case 1: {
      return ADDITIVE;
    }
    case 2: {
      return MULTIPLY;
    }
    default: {
      return OVER;
    }
  }
}

/**
 * Projette une position pixel (origine haut-gauche, +Y vers le bas) du repère canvas
 * `canvasW × canvasH` vers le clip space WebGPU (`x ∈ [-1,1]`, `y ∈ [-1,1]`, +Y vers le haut).
 *
 * Pur (aucune dépendance GPU) — c'est exactement le calcul du vertex shader, exposé pour
 * la vérification headless.
 */
export function projectOrtho(
  px: number,
  py: number,
  canvasW: number,
  canvasH: number,
): { x: number; y: number } {
  return {
    x: (2 * px) / canvasW - 1,
    y: 1 - (2 * py) / canvasH,
  };
}
