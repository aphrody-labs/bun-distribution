/**
 * Tests unitaires et d'intégration de la logique 3D de l'AvatarRenderer3d
 * et des décodeurs WASM associés (headless-safe).
 */

import { describe, expect, test } from "bun:test";
import { Mat4 } from "./avatar-renderer-3d";
import { g4md_parse_json, g4mg_extract_json } from "./wasm/nie_wasm.js";

describe("Mat4 3D Math Engine", () => {
  test("identity() creates a diagonal of 1s", () => {
    const m = Mat4.identity();
    expect(m).toHaveLength(16);
    expect(m[0]).toBe(1);
    expect(m[5]).toBe(1);
    expect(m[10]).toBe(1);
    expect(m[15]).toBe(1);
    expect(m[1]).toBe(0);
    expect(m[4]).toBe(0);
  });

  test("multiply() scales and translates correctly", () => {
    const a = Mat4.identity();
    a[0] = 2; // Scale X by 2
    a[12] = 5; // Translate X by 5

    const b = Mat4.identity();
    b[5] = 3; // Scale Y by 3
    b[13] = 10; // Translate Y by 10

    const result = Mat4.multiply(a, b);
    expect(result[0]).toBe(2);
    expect(result[5]).toBe(3);
    expect(result[12]).toBe(5);
    expect(result[13]).toBe(10);
  });

  test("perspective() output matrix values", () => {
    const aspect = 16 / 9;
    const fov = Math.PI / 4;
    const near = 0.1;
    const far = 100.0;

    const proj = Mat4.perspective(fov, aspect, near, far);
    expect(proj).toHaveLength(16);
    expect(proj[11]).toBe(-1); // W coordinate projection
    expect(proj[15]).toBe(0);
    expect(proj[5]).toBeCloseTo(1.0 / Math.tan(fov / 2.0));
  });

  test("lookAt() produces valid view coordinates", () => {
    const eye: [number, number, number] = [0, 0, 5];
    const target: [number, number, number] = [0, 0, 0];
    const up: [number, number, number] = [0, 1, 0];

    const view = Mat4.lookAt(eye, target, up);
    expect(view).toHaveLength(16);
    // With eye at (0,0,5) looking at origin, lookAt should translate Z by -5
    expect(view[14]).toBeCloseTo(-5);
    expect(view[15]).toBe(1);
  });
});

describe("nie-wasm G4MD/G4MG Parsers Integration", () => {
  test("g4md_parse_json on invalid bytes throws clear error", () => {
    const invalidBytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(() => {
      g4md_parse_json(invalidBytes);
    }).toThrow();
  });

  test("g4mg_extract_json with bad metadata/bytes throws error", () => {
    const invalidG4mg = new Uint8Array([9, 8, 7]);
    const dummyG4mdJson = JSON.stringify({
      meshes: [],
      vertexLayouts: [],
    });
    expect(() => {
      g4mg_extract_json(invalidG4mg, dummyG4mdJson);
    }).toThrow();
  });
});
