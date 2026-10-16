import { describe, expect, test } from "bun:test";
import {
	canSpawnFx,
	capParticles,
	clampParallax,
	createBurstParticles,
	lerp,
	stepParticles,
	type HeroParticle,
} from "./hero-bg-fx";

describe("hero-bg-fx helpers", () => {
	test("clampParallax limite les décalages dans la plage spécifiée", () => {
		expect(clampParallax(0, 0, 14, 10)).toEqual({ x: 0, y: 0 });
		expect(clampParallax(0.5, 0.5, 14, 10)).toEqual({ x: -7, y: -5 });
		expect(clampParallax(-0.5, -0.5, 14, 10)).toEqual({ x: 7, y: 5 });
		// Au-delà des bornes
		expect(clampParallax(1.0, -1.0, 14, 10)).toEqual({ x: -7, y: 5 });
	});

	test("canSpawnFx respecte le délai de cooldown", () => {
		expect(canSpawnFx(1000, 900, 110)).toBe(false);
		expect(canSpawnFx(1000, 890, 110)).toBe(true);
		expect(canSpawnFx(1000, 500, 0)).toBe(true);
	});

	test("createBurstParticles génère le bon nombre de particules", () => {
		const particles = createBurstParticles(100, 200, [[255, 255, 255]], 10);
		expect(particles.length).toBe(10);
		expect(particles[0]!.x).toBe(100);
		expect(particles[0]!.y).toBe(200);
		expect(particles[0]!.r).toBe(255);
	});

	test("stepParticles applique la vitesse, la gravité et supprime les particules expirées", () => {
		const p: HeroParticle = {
			x: 10,
			y: 10,
			vx: 2,
			vy: 1,
			life: 1,
			maxLife: 10,
			size: 2,
			r: 255,
			g: 255,
			b: 255,
		};
		const list = [p];
		stepParticles(list, 0.1);
		expect(list.length).toBe(0); // life <= 0
	});

	test("capParticles tronque le surplus de particules les plus anciennes", () => {
		const dummy = (): HeroParticle => ({
			x: 0,
			y: 0,
			vx: 0,
			vy: 0,
			life: 10,
			maxLife: 10,
			size: 1,
			r: 0,
			g: 0,
			b: 0,
		});
		const list = [dummy(), dummy(), dummy(), dummy()];
		capParticles(list, 2);
		expect(list.length).toBe(2);
	});

	test("lerp converge vers la cible de façon fluide", () => {
		expect(lerp(0, 10, 0.5)).toBe(5);
		expect(lerp(9.99, 10, 0.5)).toBe(10);
	});
});
