import { getPgPoolOrNull } from "@/lib/db/pg";
import { absoluteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

interface SettingRow {
	key: string;
	value: unknown;
}

export async function GET() {
	// Récupérer tous les settings Achilléa en une fois
	let settings: SettingRow[] | undefined;
	try {
		const pool = getPgPoolOrNull();
		if (pool) {
			const { rows } = await pool.query<SettingRow>(
				"SELECT key, value FROM settings WHERE key ILIKE $1",
				["home_achillea_%"]
			);
			settings = rows;
		}
	} catch {
		settings = undefined;
	}

	// Valeurs par défaut (copiées depuis src/app/page.tsx)
	const defaults = {
		home_achillea_description:
			"Le carrefour de l'esport Inazuma Eleven ! Gestion de clans, tournois, matchs classés, ranking communautaire et bot officiel.",
		home_achillea_discord:
			"https://discord.gg/achillea-competitif-inazuma-eleven-fr-1055585286320554055",
		home_achillea_image: absoluteUrl("/achillea/banniere.webp"),
		home_achillea_link: absoluteUrl("/achillea"),
	};

	const getVal = (key: string) =>
		settings?.find((s) => s.key === key)?.value || defaults[key as keyof typeof defaults];

	const info = {
		banner_url: getVal("home_achillea_image"),
		description: getVal("home_achillea_description"),
		discord_url: getVal("home_achillea_discord"),
		website_url: getVal("home_achillea_link"),
	};

	return Response.json(info);
}
