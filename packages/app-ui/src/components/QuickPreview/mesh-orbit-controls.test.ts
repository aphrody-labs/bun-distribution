// SPDX-License-Identifier: Apache-2.0
// oxlint-disable-next-line no-unassigned-import -- register the existing DOM owner for real Three input events
import "../../../../../scripts/aphrody/test-dom";
import { afterEach, expect, test } from "bun:test";
import { PerspectiveCamera } from "three";
import { bindMeshOrbitControls } from "./mesh-orbit-controls";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function setup() {
  const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(0, 0, 5);
  const element = document.createElement("canvas");
  element.style.touchAction = "pan-y";
  document.body.append(element);
  let redraws = 0;
  const owner = bindMeshOrbitControls(camera, element, () => {
    redraws += 1;
  });
  cleanups.push(() => {
    owner.dispose();
    element.remove();
  });
  return { camera, element, owner, redraws: () => redraws };
}

function wheel(element: HTMLElement, deltaY: number) {
  element.dispatchEvent(new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }));
}

test("official Three wheel input zooms the camera, requests redraw and preserves mesh distance bounds", () => {
  const { camera, element, owner, redraws } = setup();
  expect(owner.controls.enableDamping).toBe(true);
  expect(owner.controls.dampingFactor).toBe(0.05);
  wheel(element, -120);
  expect(camera.position.length()).toBeLessThan(5);
  expect(redraws()).toBeGreaterThan(0);
  for (let i = 0; i < 160; i += 1) wheel(element, -120);
  expect(camera.position.length()).toBeCloseTo(0.5, 8);
  for (let i = 0; i < 240; i += 1) wheel(element, 120);
  expect(camera.position.length()).toBeCloseTo(100, 8);
});

test("disposing the native control owner removes input and redraw listeners and restores touch behavior", () => {
  const { camera, element, owner, redraws } = setup();
  expect(element.style.touchAction).toBe("none");
  wheel(element, -120);
  const position = camera.position.clone();
  const before = redraws();
  owner.dispose();
  owner.dispose();
  wheel(element, -120);
  owner.controls.dispatchEvent({ type: "change" });
  expect(camera.position.equals(position)).toBe(true);
  expect(redraws()).toBe(before);
  expect(element.style.touchAction).toBe("pan-y");
});

test("a replacement preview has one live native control owner after the previous preview closes", () => {
  const { camera, element, owner } = setup();
  owner.dispose();
  const previousPosition = camera.position.clone();
  const replacementCamera = new PerspectiveCamera(50, 1, 0.1, 1000);
  replacementCamera.position.set(0, 0, 5);
  let redraws = 0;
  const replacement = bindMeshOrbitControls(replacementCamera, element, () => {
    redraws += 1;
  });
  cleanups.push(replacement.dispose);
  wheel(element, -120);
  expect(camera.position.equals(previousPosition)).toBe(true);
  expect(replacementCamera.position.length()).toBeLessThan(5);
  expect(redraws).toBe(1);
});
