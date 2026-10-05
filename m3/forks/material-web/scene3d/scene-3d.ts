import { customElement, property } from "lit/decorators.js";
import type { PropertyValues } from "lit";
import type * as THREE_TYPE from "three/webgpu";
import type {
  Geometry3d,
  Light3d,
  Material3d,
  Node3d,
  Paint,
  Scene3d,
  Transform3d,
} from "@aphrody/bun/src/scene-types.js";
import { M3Canvas3D, disposeObject } from "../canvas3d/canvas-3d.js";

export type { Scene3d } from "@aphrody/bun/src/scene-types.js";

type Three = typeof THREE_TYPE;

/** One draw group: every mesh sharing a geometry and a material. */
interface DrawGroup {
  geometry: Geometry3d;
  material: Material3d;
  matrices: THREE_TYPE.Matrix4[];
}

/**
 * Renders an `aphrody_render::scene3d::Scene3d` — the same JSON scene the
 * native CPU/GPU renderer (`crates/ui/render`, `m3Render3d`) consumes —
 * with three.js `WebGPURenderer` (WebGL2 fallback).
 *
 * The scene graph is flattened once per change and meshes that share a
 * geometry and a material are grouped into a single `InstancedMesh` (one draw
 * call per group, like the native `DrawBatch`es). Geometries and materials are
 * cached and reused across rebuilds. M3 colour roles resolve from
 * `--md-sys-color-<role>` and follow theme changes live; the first
 * shadow-casting directional light gets a PCF soft shadow map fitted to the
 * casters. Frames are drawn on demand by {@link M3Canvas3D}.
 *
 * ```html
 * <md-3d-scene .scene3d=${scene}></md-3d-scene>
 * <md-3d-scene src="/scenes/showcase.json"></md-3d-scene>
 * ```
 */
@customElement("md-3d-scene")
export class M3Scene3D extends M3Canvas3D {
  /** The scene to render (`width`/`height` are ignored: the element sizes it). */
  @property({ attribute: false })
  public scene3d: Scene3d | null = null;

  /** URL of a scene JSON document, fetched when `scene3d` is not set. */
  @property()
  public src = "";

  private root: THREE_TYPE.Group | null = null;
  private lights: THREE_TYPE.Light[] = [];
  private geometries = new Map<string, THREE_TYPE.BufferGeometry>();
  private materials = new Map<string, THREE_TYPE.Material>();
  /** Material colour slots bound to M3 roles, re-resolved on theme change. */
  private paintBindings: Array<{ paint: Paint; apply: (color: THREE_TYPE.Color, alpha: number) => void }> = [];
  private initialised = false;
  private fetchAbort: AbortController | null = null;

  constructor() {
    super();
    this.enableControls = true;
  }

  protected override async initThree() {
    await super.initThree();
    const THREE = this.THREE;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.initialised = true;
    await this.rebuild();
  }

  override updated(changed: PropertyValues<this>) {
    super.updated(changed);
    if (!this.initialised) return;
    if (changed.has("scene3d") || (changed.has("src") && !this.scene3d)) void this.rebuild();
  }

  protected override onThemeChange() {
    this.resolvePaints();
    super.onThemeChange();
  }

  private async loadScene(): Promise<Scene3d | null> {
    if (this.scene3d) return this.scene3d;
    if (!this.src) return null;
    this.fetchAbort?.abort();
    this.fetchAbort = new AbortController();
    const response = await fetch(this.src, { signal: this.fetchAbort.signal });
    if (!response.ok) throw new Error(`md-3d-scene: ${this.src}: HTTP ${response.status}`);
    return (await response.json()) as Scene3d;
  }

  /** Rebuild the three.js scene from the current `scene3d` / `src`. */
  public async rebuild() {
    const THREE = this.THREE;
    if (!THREE) return;
    let scene: Scene3d | null;
    try {
      scene = await this.loadScene();
    } catch (error) {
      if ((error as Error).name !== "AbortError") console.error(error);
      return;
    }

    // Drop the previous build; cached geometries/materials stay alive.
    if (this.root) this.scene.remove(this.root);
    for (const light of this.lights) {
      this.scene.remove(light);
      (light as THREE_TYPE.DirectionalLight).shadow?.dispose();
      light.dispose();
    }
    this.lights = [];
    this.paintBindings = [];
    this.root = null;
    if (!scene) {
      this.requestRender();
      return;
    }

    this.applyCamera(THREE, scene);
    this.bindPaint(scene.background ?? null, (color, alpha) => {
      this.renderer.setClearColor(color, alpha);
    }, true);

    // Flatten the graph into world matrices, grouped by geometry + material.
    const groups = new Map<string, DrawGroup>();
    const bounds: THREE_TYPE.Sphere[] = [];
    const visit = (node: Node3d, parent: THREE_TYPE.Matrix4, depth: number) => {
      if (depth > 64) return;
      const world = parent.clone().multiply(toMatrix(THREE, node.transform));
      if (node.node === "group") {
        for (const child of node.children ?? []) visit(child, world, depth + 1);
        return;
      }
      const key = `${JSON.stringify(node.geometry)}|${JSON.stringify(node.material)}`;
      let group = groups.get(key);
      if (!group) {
        group = { geometry: node.geometry, material: node.material, matrices: [] };
        groups.set(key, group);
      }
      group.matrices.push(world);
    };
    const identity = new THREE.Matrix4();
    for (const node of scene.nodes ?? []) visit(node, identity, 0);

    const root = new THREE.Group();
    const used = new Set<string>();
    for (const group of groups.values()) {
      const geometryKey = JSON.stringify(group.geometry);
      const materialKey = JSON.stringify(group.material);
      used.add(`g:${geometryKey}`).add(`m:${materialKey}`);
      const geometry = this.geometry(THREE, geometryKey, group.geometry);
      const material = this.material(THREE, materialKey, group.material);
      const castShadow = group.material.cast_shadow ?? true;
      let object: THREE_TYPE.Mesh;
      if (group.matrices.length === 1) {
        object = new THREE.Mesh(geometry, material);
        group.matrices[0].decompose(object.position, object.quaternion, object.scale);
      } else {
        const instanced = new THREE.InstancedMesh(geometry, material, group.matrices.length);
        group.matrices.forEach((m, i) => instanced.setMatrixAt(i, m));
        instanced.instanceMatrix.needsUpdate = true;
        instanced.computeBoundingSphere();
        object = instanced;
      }
      object.castShadow = castShadow && (group.material.opacity ?? 1) >= 1;
      object.receiveShadow = true;
      root.add(object);
      if (object.castShadow) {
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        for (const m of group.matrices) {
          bounds.push(geometry.boundingSphere!.clone().applyMatrix4(m));
        }
      }
    }
    this.evictUnused(used);
    this.root = root;
    this.scene.add(root);
    this.addLights(THREE, scene, bounds);
    this.resolvePaints();
    this.requestRender();
  }

  private applyCamera(THREE: Three, scene: Scene3d) {
    const cam = scene.camera ?? {};
    const projection = cam.projection ?? { kind: "perspective" };
    const rect = this.getBoundingClientRect();
    const aspect = rect.width / (rect.height || 1);
    const near = projection.near ?? 0.1;
    const far = projection.far ?? 100;
    let camera: THREE_TYPE.PerspectiveCamera | THREE_TYPE.OrthographicCamera;
    if (projection.kind === "orthographic") {
      const half = (projection.height ?? 4) / 2;
      camera = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, near, far);
    } else {
      camera = new THREE.PerspectiveCamera(projection.fov_y_deg ?? 50, aspect, near, far);
    }
    camera.position.fromArray(cam.eye ?? [0, 0, 5]);
    camera.up.fromArray(cam.up ?? [0, 1, 0]);
    const target = new THREE.Vector3().fromArray(cam.target ?? [0, 0, 0]);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    this.camera = camera;
    this.controls.object = camera;
    this.controls.target.copy(target);
    this.controls.update();
  }

  private addLights(THREE: Three, scene: Scene3d, casters: THREE_TYPE.Sphere[]) {
    const shadowsOn = scene.shadows?.enabled ?? true;
    const resolution = Math.min(Math.max(scene.shadows?.resolution ?? 2048, 256), 4096);
    let shadowAssigned = false;
    const sceneBounds = new THREE.Sphere();
    if (casters.length) {
      const box = new THREE.Box3();
      for (const s of casters) box.expandByPoint(s.center.clone().addScalar(s.radius)).expandByPoint(s.center.clone().subScalar(s.radius));
      box.getBoundingSphere(sceneBounds);
    }
    for (const light of scene.lights ?? []) {
      const created = this.createLight(THREE, light);
      if (!created) continue;
      if (
        light.light === "directional" &&
        shadowsOn &&
        !shadowAssigned &&
        (light.cast_shadow ?? true) &&
        casters.length
      ) {
        shadowAssigned = true;
        const directional = created as THREE_TYPE.DirectionalLight;
        const dir = new THREE.Vector3().fromArray(light.direction).normalize();
        const r = Math.max(sceneBounds.radius, 1e-3);
        directional.position.copy(sceneBounds.center).addScaledVector(dir, -2 * r);
        directional.target.position.copy(sceneBounds.center);
        directional.castShadow = true;
        directional.shadow.mapSize.set(resolution, resolution);
        const cam = directional.shadow.camera;
        cam.left = -r;
        cam.right = r;
        cam.top = r;
        cam.bottom = -r;
        cam.near = r * 0.5;
        cam.far = r * 3.5;
        cam.updateProjectionMatrix();
        directional.shadow.normalBias = ((2 * r) / resolution) * 1.5;
      }
      this.scene.add(created);
      if (created instanceof THREE.DirectionalLight) this.scene.add(created.target);
      this.lights.push(created);
    }
  }

  private createLight(THREE: Three, light: Light3d): THREE_TYPE.Light | null {
    // Native ambient terms are not divided by π (three's are): scale so both
    // lanes light a scene identically.
    switch (light.light) {
      case "ambient": {
        const l = new THREE.AmbientLight(0xffffff, (light.intensity ?? 1) * Math.PI);
        this.bindPaint(light.color, (c) => l.color.copy(c));
        return l;
      }
      case "hemisphere": {
        const l = new THREE.HemisphereLight(0xffffff, 0xffffff, (light.intensity ?? 1) * Math.PI);
        this.bindPaint(light.sky, (c) => l.color.copy(c));
        this.bindPaint(light.ground, (c) => l.groundColor.copy(c));
        return l;
      }
      case "directional": {
        const l = new THREE.DirectionalLight(0xffffff, light.intensity ?? Math.PI);
        const dir = new THREE.Vector3().fromArray(light.direction).normalize();
        l.position.copy(dir).multiplyScalar(-10);
        this.bindPaint(light.color, (c) => l.color.copy(c));
        return l;
      }
      case "point": {
        const l = new THREE.PointLight(0xffffff, light.intensity ?? Math.PI, light.range ?? 0, 2);
        l.position.fromArray(light.position);
        this.bindPaint(light.color, (c) => l.color.copy(c));
        return l;
      }
      default:
        return null;
    }
  }

  private geometry(THREE: Three, key: string, g: Geometry3d): THREE_TYPE.BufferGeometry {
    const cached = this.geometries.get(key);
    if (cached) return cached;
    let geometry: THREE_TYPE.BufferGeometry;
    const seg = (value: number | undefined, fallback: number, min: number) =>
      Math.min(Math.max(Math.floor(value ?? fallback), min), 512);
    switch (g.shape) {
      case "box": {
        const [x, y, z] = g.size ?? [1, 1, 1];
        geometry = new THREE.BoxGeometry(x, y, z);
        break;
      }
      case "rounded_box": {
        const [x, y, z] = g.size ?? [1, 1, 1];
        const radius = Math.min(g.radius ?? 0.1, x / 2, y / 2, z / 2);
        geometry = roundedBox(THREE, x, y, z, radius, seg(g.segments, 4, 1));
        break;
      }
      case "sphere":
        geometry = new THREE.SphereGeometry(
          g.radius ?? 0.5,
          seg(g.width_segments, 32, 3),
          seg(g.height_segments, 16, 2),
        );
        break;
      case "plane": {
        const [w, h] = g.size ?? [1, 1];
        geometry = new THREE.PlaneGeometry(w, h);
        break;
      }
      case "cylinder":
        geometry = new THREE.CylinderGeometry(
          g.radius_top ?? 0.5,
          g.radius_bottom ?? 0.5,
          g.height ?? 1,
          seg(g.radial_segments, 32, 3),
          1,
          g.open_ended ?? false,
        );
        break;
      case "torus":
        geometry = new THREE.TorusGeometry(
          g.radius ?? 0.5,
          g.tube ?? 0.2,
          seg(g.radial_segments, 16, 2),
          seg(g.tubular_segments, 32, 3),
        );
        break;
      case "mesh": {
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(g.positions.flat(), 3));
        geometry.setIndex(g.indices);
        if (g.normals?.length === g.positions.length) {
          geometry.setAttribute("normal", new THREE.Float32BufferAttribute(g.normals.flat(), 3));
        } else {
          geometry.computeVertexNormals();
        }
        break;
      }
      default:
        geometry = new THREE.BufferGeometry();
    }
    geometry.computeBoundingSphere();
    this.geometries.set(key, geometry);
    return geometry;
  }

  private material(THREE: Three, key: string, m: Material3d): THREE_TYPE.Material {
    const cached = this.materials.get(key);
    if (cached) {
      this.bindMaterial(cached, m);
      return cached;
    }
    const baseAlpha = m.base.kind === "fixed" ? m.base.value.a / 255 : 1;
    const opaque = (m.opacity ?? 1) * baseAlpha >= 1;
    const common = {
      transparent: !opaque,
      depthWrite: opaque,
      side: m.double_sided ? THREE.DoubleSide : THREE.FrontSide,
    };
    const material = m.unlit
      ? new THREE.MeshBasicNodeMaterial(common)
      : new THREE.MeshStandardNodeMaterial({
          ...common,
          metalness: m.metallic ?? 0,
          roughness: Math.max(m.roughness ?? 0.5, 0.045),
        });
    this.materials.set(key, material);
    this.bindMaterial(material, m);
    return material;
  }

  private bindMaterial(material: THREE_TYPE.Material, m: Material3d) {
    const opacity = m.opacity ?? 1;
    const target = material as THREE_TYPE.MeshStandardMaterial;
    this.bindPaint(m.base, (color, alpha) => {
      target.color.copy(color);
      target.opacity = alpha * opacity;
    });
    if (m.emissive && !m.unlit) {
      const intensity = m.emissive_intensity ?? 1;
      this.bindPaint(m.emissive, (color) => {
        target.emissive.copy(color);
        target.emissiveIntensity = intensity;
      });
    }
  }

  private bindPaint(
    paint: Paint | null,
    apply: (color: THREE_TYPE.Color, alpha: number) => void,
    clearWhenNull = false,
  ) {
    if (!paint) {
      if (clearWhenNull) apply(new this.THREE.Color(0, 0, 0), 0);
      return;
    }
    this.paintBindings.push({ paint, apply });
  }

  /** Resolve every bound paint against the current M3 tokens. */
  private resolvePaints() {
    const THREE = this.THREE;
    if (!THREE || !this.theme) return;
    for (const { paint, apply } of this.paintBindings) {
      if (paint.kind === "role") {
        apply(new THREE.Color(this.theme.resolve(paint.value)), 1);
      } else {
        const { r, g, b, a } = paint.value;
        apply(new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace), a / 255);
      }
    }
  }

  private evictUnused(used: Set<string>) {
    for (const [key, geometry] of this.geometries) {
      if (!used.has(`g:${key}`)) {
        geometry.dispose();
        this.geometries.delete(key);
      }
    }
    for (const [key, material] of this.materials) {
      if (!used.has(`m:${key}`)) {
        material.dispose();
        this.materials.delete(key);
      }
    }
  }

  override disconnectedCallback() {
    this.fetchAbort?.abort();
    super.disconnectedCallback();
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const material of this.materials.values()) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    if (this.root) disposeObject(this.root);
  }
}

function toMatrix(THREE: Three, t: Transform3d | undefined): THREE_TYPE.Matrix4 {
  const deg = THREE.MathUtils.DEG2RAD;
  const [rx, ry, rz] = t?.rotation_deg ?? [0, 0, 0];
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(t?.translation ?? [0, 0, 0]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx * deg, ry * deg, rz * deg, "XYZ")),
    new THREE.Vector3().fromArray(t?.scale ?? [1, 1, 1]),
  );
}

/**
 * Rounded box with the exact topology of the native `mesh3d::rounded_box_mesh`:
 * per face, a tan-spaced grid over each rounded edge projected onto the inner
 * box plus `radius` along the corner normal.
 */
function roundedBox(
  THREE: Three,
  sx: number,
  sy: number,
  sz: number,
  radius: number,
  segments: number,
): THREE_TYPE.BufferGeometry {
  const h = [sx / 2, sy / 2, sz / 2];
  const inner = h.map((v) => v - radius);
  const coords = (innerExtent: number) => {
    const out: number[] = [];
    for (let i = segments; i >= 0; i--) out.push(-innerExtent - radius * Math.tan((Math.PI / 4) * (i / segments)));
    for (let i = 0; i <= segments; i++) out.push(innerExtent + radius * Math.tan((Math.PI / 4) * (i / segments)));
    return out;
  };
  const faces: Array<[number[], number[]]> = [
    [[1, 0, 0], [0, 0, -1]],
    [[-1, 0, 0], [0, 0, 1]],
    [[0, 1, 0], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 0]],
    [[0, 0, -1], [-1, 0, 0]],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const axis = (d: number[]) => d.findIndex((c) => Math.abs(c) > 0.5);
  for (const [n, u] of faces) {
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const us = coords(inner[axis(u)]);
    const vs = coords(inner[axis(v)]);
    const base = positions.length / 3;
    for (const tv of vs) {
      for (const tu of us) {
        const p = [0, 1, 2].map((k) => n[k] * h[k] + u[k] * tu + v[k] * tv);
        const q = p.map((c, k) => Math.min(Math.max(c, -inner[k]), inner[k]));
        const d = p.map((c, k) => c - q[k]);
        const len = Math.hypot(d[0], d[1], d[2]);
        const normal = len > 1e-12 ? d.map((c) => c / len) : n;
        positions.push(...q.map((c, k) => c + normal[k] * radius));
        normals.push(...normal);
      }
    }
    const cols = us.length;
    for (let j = 0; j < vs.length - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = base + j * cols + i;
        indices.push(a, a + 1, a + cols + 1, a, a + cols + 1, a + cols);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

declare global {
  interface HTMLElementTagNameMap {
    "md-3d-scene": M3Scene3D;
  }
}
