import "reflect-metadata";
import { eq } from "drizzle-orm";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { dbCharacters } from "~/db/schema";

/**
 * Enrichit les personnages importés de Xenoverse 2 avec leur RACE (et genre)
 * canonique, dans le vocabulaire déjà utilisé par db_characters
 * (Saiyan/Human/Namekian/Frieza Race/Android/Majin/God/Angel/Evil/Unknown).
 *
 * Données canoniques Dragon Ball (curées) : les races ambiguës / espèces non
 * nommées restent "Unknown". Idempotent (UPDATE par nom). À lancer après
 * seed-xv2-characters. `bun db:seed-xv2-char-meta`.
 */
const RACE: Record<string, string> = {
	"Son Goten": "Saiyan",
	"Trunks du Futur": "Saiyan",
	Nappa: "Saiyan",
	Cabba: "Saiyan",
	Thalès: "Saiyan",
	Pan: "Saiyan",
	"Son Goku Black": "Saiyan",
	"Super Baby 2": "Saiyan",
	Videl: "Human",
	Majuub: "Majin",
	"Buu enfant": "Majin",
	"Super Buu": "Majin",
	"Piccolo Orange": "Namekian",
	Slugh: "Namekian",
	Frost: "Frieza Race",
	"Golden Freezer": "Frieza Race",
	"Metal Cooler": "Frieza Race",
	"Cell Junior": "Android",
	"Cell Max": "Android",
	"Super C-17": "Android",
	"C-21": "Android",
	"Gamma 1": "Android",
	"Gamma 2": "Android",
	Mira: "Android",
	"Champa, dieu de la destruction": "God",
	"Kaïo Shin du temps": "God",
	"Vieux Kaïo Shin": "God",
	Zamasu: "God",
	"Zamasu fusionné": "God",
	Vados: "Angel",
	Dabra: "Evil",
	"Dieu démon Demigra": "Evil",
	Towa: "Evil",
	Hit: "Unknown",
	Jaco: "Unknown",
	Jeice: "Unknown",
	Burter: "Unknown",
	Recoome: "Unknown",
	Guldo: "Unknown",
	Raspberry: "Unknown",
	Nabana: "Unknown",
	Kaiwareman: "Unknown",
	Bojack: "Unknown",
	Tapion: "Unknown",
	Paikuhan: "Unknown",
	Fu: "Unknown",
	Ribrianne: "Unknown",
	"Eis Shenron": "Unknown",
	"Li Shenron": "Unknown",
	"Suu Shenron": "Unknown",
};
// genres connus (le reste : non renseigné)
const FEMALE = new Set([
	"Pan",
	"Videl",
	"Vados",
	"Towa",
	"Kaïo Shin du temps",
	"C-21",
	"Ribrianne",
]);

const dbs = container.resolve(DatabaseService);
const db = dbs.db;

let n = 0;
for (const [name, race] of Object.entries(RACE)) {
	const res = await db
		.update(dbCharacters)
		.set({ race, gender: FEMALE.has(name) ? "Female" : "Male" })
		.where(eq(dbCharacters.name, name));
	void res;
	n++;
}
console.log(`✓ race/genre enrichis sur ${n} persos XV2`);
dbs.close();
