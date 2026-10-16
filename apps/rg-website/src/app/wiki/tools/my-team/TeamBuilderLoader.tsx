"use client";

import dynamic from "next/dynamic";
import type { PickerCharacter } from "@/components/tools/my-team/CharacterPicker";
import type { Formation } from "@rosegriffon/azalee/game/formations";

const TeamBuilder = dynamic(
	() => import("@/components/tools/my-team/TeamBuilder").then((m) => m.TeamBuilder),
	{
		loading: () => (
			<div className="flex flex-col gap-4 animate-pulse p-4">
				<div className="h-10 bg-surface-container rounded-xl w-64" />
				<div className="h-[500px] bg-surface-container rounded-3xl" />
			</div>
		),
		ssr: false,
	}
);

export function TeamBuilderLoader({
	characters,
	formations,
	isAuthenticated,
}: {
	characters: PickerCharacter[];
	formations: Formation[];
	isAuthenticated: boolean;
}) {
	return <TeamBuilder characters={characters} formations={formations} isAuthenticated={isAuthenticated} />;
}
