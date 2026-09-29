import Link from "next/link";
import {
	DEFAULT_POWER_SCALING_CONFIG,
} from "@/lib/canon-engine";
import { T } from "@/components/T";

interface CharacterPowerScalingProps {
	characterName: string;
	characterId?: number;
	config?: typeof DEFAULT_POWER_SCALING_CONFIG;
}

export function CharacterPowerScaling({
	characterName,
	characterId,
	config = DEFAULT_POWER_SCALING_CONFIG,
}: CharacterPowerScalingProps) {
	// Filtrer les BP officiels correspondant au personnage
	const nomNorm = characterName.toLowerCase();
	const bpsOfficiels = config.officialBps.filter((bp) => {
		if (characterId && bp.characterId === characterId) return true;
		const bpNorm = bp.character.toLowerCase();
		return bpNorm.includes(nomNorm) || nomNorm.includes(bpNorm);
	});

	// Si le personnage est un Saiyan (Goku, Vegeta, Gohan, etc.), afficher les multiplicateurs
	const estSaiyan =
		nomNorm.includes("goku") ||
		nomNorm.includes("vegeta") ||
		nomNorm.includes("gohan") ||
		nomNorm.includes("trunks") ||
		nomNorm.includes("goten") ||
		nomNorm.includes("broly") ||
		nomNorm.includes("vegetto") ||
		nomNorm.includes("gogeta");

	return (
		<div className="space-y-8 text-white/80">
			{/* En-tête doctrine */}
			<div className="rounded-xl border border-dbz-orange/30 bg-black/40 p-5 backdrop-blur">
				<div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
					<div className="flex items-center gap-2">
						<span className="font-scouter text-xs uppercase tracking-widest text-dbz-orange">
							<T k="wikiPower.doctrine" />
						</span>
						<span className="rounded bg-dbz-orange/20 px-2 py-0.5 font-saiyan text-[10px] text-dbz-yellow">
							<T k="wikiPower.badge" />
						</span>
					</div>
					<Link
						href="/wiki/guide-officiel-power-scaling-sentoryoku-kiri"
						className="text-[11px] text-dbz-orange hover:underline"
					>
						<T k="wikiPower.dossier" />
					</Link>
				</div>
				<p className="mt-3 text-xs leading-relaxed text-white/65">
					Les niveaux de combat chiffrés (<em>Sentōryoku</em>) proviennent exclusivement des relevés de détecteurs
					(<em>scouters</em>) du manga original d&apos;Akira Toriyama et des fiches exhaustives du{" "}
					<strong>Daizenshuu 7</strong> (1996). Conformément à la doctrine de l&apos;auteur, les chiffres
					s&apos;arrêtent officiellement après l&apos;arc Freezer, remplacés dans l&apos;arc Majin Boo par
					l&apos;unité magique <strong>Kiri</strong>.
				</p>
			</div>

			{/* Relevés chronologiques du personnage */}
			{bpsOfficiels.length > 0 ? (
				<div className="space-y-4">
					<h3 className="font-saiyan text-sm uppercase tracking-wider text-dbz-yellow">
						<T k="wikiPower.readings" values={{ name: characterName }} />
					</h3>
					<div className="overflow-x-auto rounded-xl border border-white/10 bg-black/20">
						<table className="w-full text-left text-xs">
							<thead>
								<tr className="border-b border-white/10 bg-white/[0.02] text-[10px] uppercase tracking-wider text-white/40">
								<th className="py-2.5 px-4"><T k="wikiPower.saga" /></th>
								<th className="py-2.5 px-4"><T k="wikiPower.state" /></th>
									<th className="py-2.5 px-4 font-mono">Battle Power (BP)</th>
								<th className="py-2.5 px-4"><T k="wikiPower.sensor" /></th>
								<th className="py-2.5 px-4"><T k="wikiPower.canonSource" /></th>
								</tr>
							</thead>
							<tbody className="divide-y divide-white/5">
								{bpsOfficiels.map((bp, i) => (
									<tr key={i} className="hover:bg-white/[0.02] transition-colors">
										<td className="py-2.5 px-4 font-medium text-white/90">{bp.saga}</td>
										<td className="py-2.5 px-4 text-white/70">{bp.state}</td>
										<td className="py-2.5 px-4 font-mono font-bold text-dbz-orange text-sm">
											{bp.bp.toLocaleString("fr-FR")}
										</td>
										<td className="py-2.5 px-4">
											{bp.scouter ? (
												<span className="inline-flex items-center rounded border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400">
													Scouter manga
												</span>
											) : (
												<span className="inline-flex items-center rounded border border-yellow-500/30 bg-yellow-500/10 px-2 py-0.5 text-[10px] text-yellow-400">
													Daizenshuu 7
												</span>
											)}
										</td>
										<td className="py-2.5 px-4 text-[11px] text-white/50">{bp.source}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			) : (
				<div className="rounded-xl border border-white/10 bg-black/20 p-5 text-center text-xs text-white/50">
					<p>
						Aucun relevé numérique officiel sous scouter n&apos;est enregistré pour ce personnage dans le manga
						ni dans le Daizenshuu 7.
					</p>
					<p className="mt-1 text-white/35">
						Les puissances non mesurées par l&apos;auteur sont classées par échelons narratifs et comparatifs.
					</p>
				</div>
			)}

			{/* Multiplicateurs de transformation (si Saiyan) */}
			{estSaiyan && (
				<div className="space-y-4">
					<h3 className="font-saiyan text-sm uppercase tracking-wider text-dbz-yellow">
						<T k="wikiPower.multipliers" />
					</h3>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{config.multipliers
							.filter((m) => m.multiplier > 0)
							.map((m, i) => (
								<div
									key={i}
									className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-2 hover:border-dbz-orange/40 transition-colors"
								>
									<div className="flex items-center justify-between">
										<span className="font-bold text-white text-xs">{m.form}</span>
										<span className="font-mono font-bold text-dbz-orange text-sm">
											x{m.multiplier}
										</span>
									</div>
									<p className="text-[11px] text-white/50">
										Base : <span className="text-white/70">{m.baseForm}</span>
									</p>
									{m.notes && <p className="text-[10px] leading-relaxed text-white/40">{m.notes}</p>}
									<div className="border-t border-white/5 pt-2 text-[10px] text-white/35">
										Source : {m.source}
									</div>
								</div>
							))}
					</div>
				</div>
			)}

			{/* Échelle magique Kiri (Arc Buu) */}
			<div className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-3">
				<h3 className="font-saiyan text-sm uppercase tracking-wider text-dbz-yellow">
					<T k="wikiPower.kiriTitle" />
				</h3>
				<p className="text-xs leading-relaxed text-white/60">
					Dans l&apos;arc Majin Buu, Babidi mesure la force des guerriers à l&apos;aide d&apos;un dispositif
					occulte en unités <strong>Kiri</strong> :
				</p>
				<div className="grid gap-3 sm:grid-cols-3 pt-1">
					<div className="rounded-lg border border-white/10 bg-black/30 p-3">
						<span className="text-[10px] uppercase text-white/40">Yakon</span>
						<p className="font-mono text-lg font-bold text-dbz-orange">800 Kiri</p>
						<p className="text-[10px] text-white/50 mt-1"><T k="wikiPower.yakonNote" /></p>
					</div>
					<div className="rounded-lg border border-white/10 bg-black/30 p-3">
						<span className="text-[10px] uppercase text-white/40">Goku Super Saiyan 2</span>
						<p className="font-mono text-lg font-bold text-dbz-orange">3 000 Kiri</p>
						<p className="text-[10px] text-white/50 mt-1">Sature le capteur magique</p>
					</div>
					<div className="rounded-lg border border-white/10 bg-black/30 p-3">
						<span className="text-[10px] uppercase text-white/40">Seuil Destruction Planétaire</span>
						<p className="font-mono text-lg font-bold text-dbz-yellow">200 - 300 Kiri</p>
						<p className="text-[10px] text-white/50 mt-1">
							Énergie nécessaire pour anéantir une planète standard
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
