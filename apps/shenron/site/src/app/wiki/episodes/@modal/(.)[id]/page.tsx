/**
 * Route d'INTERCEPTION `@modal/(.)[id]` — aperçu rapide d'un épisode en modale
 * quand on navigue depuis la landing/vue-série (statiques). Accès direct/refresh
 * de `/wiki/episodes/[id]` = fiche pleine page. Cf. `wiki/films/@modal/(.)[slug]`.
 */
import { dbUniverse } from "@/lib/db-universe";
import { bannerForSeries } from "@/lib/banner-config";
import { Modal } from "@/components/stream/Modal";
import { QuickLook } from "@/components/stream/QuickLook";
import { SERIES_LABELS, hasLang, stripSourceTags } from "../../_shared";
import { idDeFiche } from "../../../_id-fiche";

export const dynamic = "force-dynamic";

export default async function EpisodeModal({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const numero = idDeFiche(id);
	const ep = numero === null ? null : await dbUniverse.episode(numero);
	// null = surtout une erreur DB transitoire (les cartes lient des ids réels) →
	// aperçu gracieux plutôt qu'un 404 racine par-dessus le catalogue.
	if (!ep) {
		return (
			<Modal>
				<div className="p-10 text-center">
					<p id="stream-modal-title" className="font-saiyan text-2xl uppercase text-white/50">
						Aperçu indisponible
					</p>
					<p className="mt-2 text-sm text-white/50">
						Impossible de charger cet aperçu pour le moment. Ouvre la fiche complète ou réessaie.
					</p>
				</div>
			</Modal>
		);
	}
	const year = ep.air_date ? new Date(ep.air_date * 1000).getFullYear() : null;

	return (
		<Modal>
			<QuickLook
				backdrop={await bannerForSeries(ep.series)}
				eyebrow={`${SERIES_LABELS[ep.series] ?? ep.series} · Épisode ${ep.number_in_series}`}
				title={ep.title}
				titleJa={ep.title_ja}
				meta={[year ? String(year) : null]}
				synopsis={stripSourceTags(ep.synopsis)}
				hasVf={hasLang(ep.players, "vf")}
				hasVostfr={hasLang(ep.players, "vostfr")}
				resources={[
					`${ep.players?.length ?? 0} lecteur${(ep.players?.length ?? 0) > 1 ? "s" : ""}`,
					...(ep.subtitles?.length
						? [
								`${ep.subtitles.length} piste${ep.subtitles.length > 1 ? "s" : ""} sous-titrée${ep.subtitles.length > 1 ? "s" : ""}`,
							]
						: []),
				]}
				watchHref={`/wiki/episodes/${ep.id}`}
				watchLabel="Regarder l'épisode"
			/>
		</Modal>
	);
}
