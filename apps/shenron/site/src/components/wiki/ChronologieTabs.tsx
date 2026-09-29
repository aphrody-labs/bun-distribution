"use client";

import { useState } from "react";
import type { ResolvedTimelineItem } from "@/lib/chronology";
import type { TimelineEvent } from "@/lib/db-universe";
import { ChronologyTimeline } from "@/components/wiki/ChronologyTimeline";
import { AgeTimeline } from "@/components/wiki/AgeTimeline";

export function ChronologieTabs({
	mediaItems,
	ageEvents,
}: {
	mediaItems: ResolvedTimelineItem[];
	ageEvents: TimelineEvent[];
}) {
	const [activeTab, setActiveTab] = useState<"media" | "ages">("media");

	return (
		<div className="space-y-6">
			{/* Switcher de mode de chronologie */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
				<div className="flex rounded-xl bg-white/5 p-1 border border-white/10 max-w-fit">
					<button
						type="button"
						onClick={() => setActiveTab("media")}
						className={`rounded-lg px-4 py-2 text-xs font-bold transition-all ${
							activeTab === "media"
								? "bg-orange-600 text-white shadow-md shadow-orange-950/40"
								: "text-white/60 hover:text-white"
						}`}
					>
						📺 Ordre des Œuvres ({mediaItems.length} médias)
					</button>
					<button
						type="button"
						onClick={() => setActiveTab("ages")}
						className={`rounded-lg px-4 py-2 text-xs font-bold transition-all ${
							activeTab === "ages"
								? "bg-orange-600 text-white shadow-md shadow-orange-950/40"
								: "text-white/60 hover:text-white"
						}`}
					>
						⏳ Chronologie des Âges ({ageEvents.length} repères Daizenshuu)
					</button>
				</div>

				<div className="text-xs text-white/50">
					{activeTab === "media"
						? "Ordre de visionnage et de lecture recommandé."
						: "Calendrier diégétique officiel en Âges (エイジ)."}
				</div>
			</div>

			{activeTab === "media" ? (
				<ChronologyTimeline items={mediaItems} />
			) : (
				<AgeTimeline events={ageEvents} />
			)}
		</div>
	);
}
