import Link from "next/link";

/** État explicite lorsqu'aucun flux de lecture n'est présent dans la fiche. */
export function VideoUnavailableCard({ title, kind }: { title: string; kind: "episode" | "film" }) {
	return (
		<section
			className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-6 sm:p-8"
			aria-label="Source vidéo indisponible"
		>
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/40">
						Lecture non disponible
					</p>
					<h2 className="mt-1 text-lg font-bold text-white">Aucune source pour « {title} »</h2>
					<p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">
						La fiche et ses métadonnées restent consultables. Une source vidéo vérifiée sera
						affichée dès qu’elle sera importée et contrôlée.
					</p>
				</div>
				<Link
					href={`/wiki/contribuer?type=${kind}`}
					className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-dbz-orange/40 bg-dbz-orange/10 px-4 text-xs font-bold text-dbz-orange transition hover:bg-dbz-orange hover:text-black"
				>
					Proposer une source
				</Link>
			</div>
		</section>
	);
}
