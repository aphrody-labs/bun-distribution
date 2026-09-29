import "./setup";
import { describe, it, expect, beforeAll } from "bun:test";
import { container } from "tsyringe";
import { WikiService } from "../src/services/WikiService";
import { DatabaseService } from "../src/db/index";
import { dbCharacters, dbPlanets, dbTransformations } from "../src/db/schema";

describe("WikiService", () => {
	let wiki: WikiService;
	let dbs: DatabaseService;

	beforeAll(async () => {
		wiki = container.resolve(WikiService);
		dbs = container.resolve(DatabaseService);

		// Clean up before seeding
		await dbs.db.delete(dbTransformations);
		await dbs.db.delete(dbCharacters);
		await dbs.db.delete(dbPlanets);

		// Seed some data for testing
		await dbs.db.insert(dbPlanets).values([
			{
				id: 1,
				name: "Earth",
				image: "earth.png",
				description: "Home of humans",
			},
			{
				id: 2,
				name: "Vegeta",
				image: "vegeta.png",
				description: "Home of Saiyans",
			},
		]);

		await dbs.db.insert(dbCharacters).values([
			{
				id: 1,
				name: "Goku",
				image: "goku.png",
				race: "Saiyan",
				originPlanetId: 2,
			},
			{
				id: 2,
				name: "Vegeta",
				image: "vegeta.png",
				race: "Saiyan",
				originPlanetId: 2,
			},
			{
				id: 3,
				name: "Krillin",
				image: "krillin.png",
				race: "Human",
				originPlanetId: 1,
			},
		]);

		await dbs.db.insert(dbTransformations).values([
			{ id: 1, name: "Super Saiyan", image: "ssj.png", characterId: 1 },
			{ id: 2, name: "Super Saiyan 2", image: "ssj2.png", characterId: 1 },
		]);
	});

	it("should list all characters", async () => {
		const chars = await wiki.listAll();
		expect(chars.length).toBe(3);
	});

	it("should search characters", async () => {
		const results = await wiki.search("Gok");
		expect(results.length).toBe(1);
		expect(results[0].name).toBe("Goku");
	});

	it("should get character with relations", async () => {
		const goku = await wiki.getCharacter(1);
		expect(goku).not.toBeNull();
		expect(goku?.name).toBe("Goku");
		expect(goku?.transformations.length).toBe(2);
		expect(goku?.originPlanet?.name).toBe("Vegeta");
	});

	it("should list planets", async () => {
		const planets = await wiki.listPlanets();
		expect(planets.length).toBe(2);
	});

	it("should count entries", async () => {
		const counts = await wiki.count();
		expect(counts.characters).toBe(3);
		expect(counts.planets).toBe(2);
		expect(counts.transformations).toBe(2);
	});

	it("should check if seeded", async () => {
		const seeded = await wiki.isSeeded();
		expect(seeded).toBe(true);
	});
});
