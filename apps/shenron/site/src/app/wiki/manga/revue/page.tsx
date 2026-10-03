/**
 * /wiki/manga/revue — file de relecture des traductions de planches (staff).
 *
 * Liste les candidats non relus du bot (`GET /api/manga/candidates?status=unreviewed`),
 * affiche source et traduction côte à côte, et approuve/rejette par action
 * serveur (`POST /api/manga/candidates/:id/approve|reject`, jeton admin côté
 * serveur uniquement).
 */
import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { botAdmin, BotAdminError } from "@/lib/bot-admin";
import { requireAdmin } from "@/lib/session";
import { PageShell } from "@/components/kit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
	title: "Relecture des traductions du manga",
	robots: { index: false, follow: false },
};

type Paire = {
	regionId: string;
	readingOrder: number | null;
	sourceText: string | null;
	translatedText: string;
};

/** Vue `mangaCandidateView` du bot : une proposition = une planche et ses bulles. */
type Candidat = {
	id: number;
	pageId: string;
	status: string;
	createdAt: number;
	pairs: Paire[];
};

const CHEMIN = "/wiki/manga/revue";

async function decider(formData: FormData) {
	"use server";
	await requireAdmin();
	const id = String(formData.get("id") ?? "");
	const decision = formData.get("decision");
	if (!/^[\w-]+$/.test(id) || (decision !== "approve" && decision !== "reject")) return;
	await botAdmin.fetch(`/api/manga/candidates/${encodeURIComponent(id)}/${decision}`, {
		method: "POST",
		body: JSON.stringify({}),
		cache: "no-store",
	});
	revalidatePath(CHEMIN);
}

async function chargerCandidats(): Promise<{ candidats: Candidat[]; erreur: string | null }> {
	try {
		const body = await botAdmin.fetch<{ data?: Candidat[] }>(
			"/api/manga/candidates?status=unreviewed",
			{ revalidate: 0, cache: "no-store" }
		);
		const candidats = body.data ?? [];
		return { candidats, erreur: null };
	} catch (e) {
		const erreur =
			e instanceof BotAdminError ? `Bot indisponible (${e.status}).` : "Bot injoignable.";
		return { candidats: [], erreur };
	}
}

export default async function RevueTraductionsPage() {
	await requireAdmin();
	const { candidats, erreur } = await chargerCandidats();

	return (
		<PageShell as="main">
			<h1 className="text-2xl font-semibold">Relecture des traductions</h1>
			<p className="mt-1 text-sm opacity-70">
				{candidats.length} proposition{candidats.length > 1 ? "s" : ""} en attente.
			</p>
			{erreur ? (
				<p role="alert" className="mt-4 rounded border border-red-500/40 p-3 text-sm">
					{erreur}
				</p>
			) : null}
			{!erreur && candidats.length === 0 ? (
				<p className="mt-6 text-sm opacity-70">Rien à relire pour le moment.</p>
			) : null}
			<ul className="mt-6 space-y-4">
				{candidats.map((c) => (
					<li key={String(c.id)} className="rounded-lg border border-white/10 p-4">
						<div className="mb-2 text-xs opacity-60">
							Proposition {String(c.id)}
							{` · page ${c.pageId} · ${c.pairs.length} bulle${c.pairs.length > 1 ? "s" : ""}`}
						</div>
						<ol className="space-y-2">
							{c.pairs.map((paire) => (
								<li key={paire.regionId} className="grid gap-3 md:grid-cols-2">
									<p className="whitespace-pre-wrap" lang="ja">
										{paire.sourceText ?? "—"}
									</p>
									<p className="whitespace-pre-wrap" lang="fr">
										{paire.translatedText}
									</p>
								</li>
							))}
						</ol>
						<form action={decider} className="mt-3 flex gap-2">
							<input type="hidden" name="id" value={String(c.id)} />
							<button
								type="submit"
								name="decision"
								value="approve"
								className="rounded bg-green-600 px-3 py-1 text-sm text-white"
							>
								Approuver
							</button>
							<button
								type="submit"
								name="decision"
								value="reject"
								className="rounded bg-red-600 px-3 py-1 text-sm text-white"
							>
								Rejeter
							</button>
						</form>
					</li>
				))}
			</ul>
		</PageShell>
	);
}
