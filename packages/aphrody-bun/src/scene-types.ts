// SPDX-License-Identifier: Apache-2.0
//
// Runtime-free scene wire types shared by `@aphrody/bun` (FFI) and browser
// consumers (`@aphrody/material-web` `md-3d-scene`): import them with
// `import type` from `@aphrody/bun/src/scene-types.js` without pulling in
// `bun:ffi`.

// Hand-maintained mirror of the JSON wire format produced by
// `crates/aphrody-render/src/scene.rs` (`serde` derive output). Keep in sync
// with that module; `aphrody-render`'s own round-trip test
// (`scene::tests::scene_round_trips_through_json`) is the source of truth.

/** Kebab-case M3 colour role name (`aphrody_m3_tokens::scheme::Role::name()`). */
export type M3Role = string;

export type Rect = { x: number; y: number; w: number; h: number };

export type Corners = { tl: number; tr: number; br: number; bl: number };

export type Rgba8 = { r: number; g: number; b: number; a: number };

export type Paint =
  { kind: "role"; value: M3Role } | { kind: "fixed"; value: Rgba8 };

export type Outline = { color: Paint; width: number };

export type StateKind = "hover" | "focus" | "pressed" | "dragged";

export type TypeStyleName =
  | "display-large"
  | "display-medium"
  | "display-small"
  | "headline-large"
  | "headline-medium"
  | "headline-small"
  | "title-large"
  | "title-medium"
  | "title-small"
  | "body-large"
  | "body-medium"
  | "body-small"
  | "label-large"
  | "label-medium"
  | "label-small";

export type SceneNode =
  | {
      node: "surface";
      rect: Rect;
      corners: Corners;
      fill: Paint;
      elevation: number;
      outline?: Outline | null;
    }
  | {
      node: "state_layer";
      rect: Rect;
      corners: Corners;
      content: Paint;
      state: StateKind;
    }
  | {
      node: "ripple";
      cx: number;
      cy: number;
      radius: number;
      color: Paint;
      alpha: number;
    }
  | {
      node: "text";
      rect: Rect;
      text: string;
      style: TypeStyleName;
      color: Paint;
    }
  | { node: "icon"; rect: Rect; path: string; color: Paint }
  | {
      node: "image";
      rect: Rect;
      width: number;
      height: number;
      rgba: number[];
    };

/** M3 dynamic-scheme variant name (`aphrody_m3_tokens::scheme::Variant::name()`). */
export type SchemeVariant =
  | "monochrome"
  | "neutral"
  | "tonal-spot"
  | "vibrant"
  | "expressive"
  | "rainbow"
  | "fruit-salad";

/** Mirrors `aphrody_render::scene::Scene`. */
export type Scene = {
  width: number;
  height: number;
  /** Packed `0xAARRGGBB` seed colour. */
  seed_argb: number;
  variant?: SchemeVariant;
  is_dark?: boolean;
  contrast_level?: number;
  background?: Paint | null;
  nodes: SceneNode[];
};

// ---------------------------------------------------------------------------
// 3D: hand-maintained mirror of `crates/aphrody-render/src/scene3d.rs` and
// `mesh3d.rs` (`serde` output). Optional fields take the Rust defaults.
// ---------------------------------------------------------------------------

export type Vec3 = [number, number, number];

/** Local transform `T * R * S`; rotation is XYZ Euler angles in degrees. */
export type Transform3d = {
  translation?: Vec3;
  rotation_deg?: Vec3;
  scale?: Vec3;
};

export type Projection3d =
  | { kind: "perspective"; fov_y_deg?: number; near?: number; far?: number }
  | { kind: "orthographic"; height?: number; near?: number; far?: number };

export type Camera3d = {
  eye?: Vec3;
  target?: Vec3;
  up?: Vec3;
  projection?: Projection3d;
};

export type Light3d =
  | { light: "ambient"; color: Paint; intensity?: number }
  | { light: "hemisphere"; sky: Paint; ground: Paint; intensity?: number }
  | {
      light: "directional";
      /** Direction the light travels, from the light towards the scene. */
      direction: Vec3;
      color: Paint;
      intensity?: number;
      cast_shadow?: boolean;
    }
  | {
      light: "point";
      position: Vec3;
      color: Paint;
      intensity?: number;
      range?: number;
    };

export type Geometry3d =
  | { shape: "box"; size?: Vec3 }
  | { shape: "rounded_box"; size?: Vec3; radius?: number; segments?: number }
  | {
      shape: "sphere";
      radius?: number;
      width_segments?: number;
      height_segments?: number;
    }
  | { shape: "plane"; size?: [number, number] }
  | {
      shape: "cylinder";
      radius_top?: number;
      radius_bottom?: number;
      height?: number;
      radial_segments?: number;
      open_ended?: boolean;
    }
  | {
      shape: "torus";
      radius?: number;
      tube?: number;
      radial_segments?: number;
      tubular_segments?: number;
    }
  | {
      shape: "mesh";
      positions: Vec3[];
      normals?: Vec3[] | null;
      indices: number[];
    };

export type Material3d = {
  base: Paint;
  metallic?: number;
  roughness?: number;
  emissive?: Paint | null;
  emissive_intensity?: number;
  opacity?: number;
  unlit?: boolean;
  double_sided?: boolean;
  cast_shadow?: boolean;
};

export type Node3d =
  | { node: "group"; transform?: Transform3d; children?: Node3d[] }
  | {
      node: "mesh";
      transform?: Transform3d;
      geometry: Geometry3d;
      material: Material3d;
    };

/** Mirrors `aphrody_render::scene3d::Scene3d`. */
export type Scene3d = {
  width: number;
  height: number;
  /** Packed `0xAARRGGBB` seed colour. */
  seed_argb: number;
  variant?: SchemeVariant;
  is_dark?: boolean;
  contrast_level?: number;
  background?: Paint | null;
  /** `1` or `4` (4x MSAA, the default). */
  samples?: 1 | 4;
  camera?: Camera3d;
  lights?: Light3d[];
  shadows?: { enabled?: boolean; resolution?: number };
  nodes?: Node3d[];
};

/** Backend policy for {@link m3Render3d}. */
export type Render3dPolicy = "cpu" | "auto" | "gpu";
