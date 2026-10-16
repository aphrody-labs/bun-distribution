"use client";

import Link from "next/link";
import type { ClanMemberDTO } from "@rosegriffon/achillea-types";
import { ClanMemberRole, ClanMemberDistinction } from "@rosegriffon/achillea-types/enums/clanMemberRole";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import { Badge, Card, CardContent } from "@rosegriffon/ui";
import { Crown, Shield, Users, Award } from "lucide-react";

interface ClanOrgchartProps {
	members: ClanMemberDTO[];
}

function distinctionLabel(d: string): string {
	switch (d) {
		case ClanMemberDistinction.Player:
		case "Player":
		case "Joueur":
			return "Joueur";
		case ClanMemberDistinction.Staff:
		case "Staff":
			return "Staff";
		case ClanMemberDistinction.Artist:
		case "Artist":
		case "Artiste":
			return "Artiste";
		case ClanMemberDistinction.ContentCreator:
		case "ContentCreator":
		case "Créateur de contenu":
			return "Créateur de contenu";
		default:
			return d;
	}
}

export function ClanOrgchart({ members }: ClanOrgchartProps) {
	// Group members by role in hierarchy
	const president = members.find((m) => m.clanRole === ClanMemberRole.Captain);
	const viceCaptains = members.filter((m) => m.clanRole === ClanMemberRole.SubCaptain);
	const staffMembers = members.filter(
		(m) =>
			(m.distinctions?.includes(ClanMemberDistinction.Staff) || m.distinctions?.includes("Staff")) &&
			m.clanRole !== ClanMemberRole.Captain &&
			m.clanRole !== ClanMemberRole.SubCaptain
	);
	const players = members.filter(
		(m) =>
			m.clanRole !== ClanMemberRole.Captain &&
			m.clanRole !== ClanMemberRole.SubCaptain &&
			!m.distinctions?.includes(ClanMemberDistinction.Staff) &&
			!m.distinctions?.includes("Staff")
	);

	return (
		<div className="space-y-10 py-6">
			{/* Level 1: CEO / President */}
			<div className="flex flex-col items-center">
				<div className="text-center mb-3">
					<span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center justify-center gap-1.5">
						<Crown className="size-3.5" />
						Direction générale
					</span>
				</div>

				{president ? (
					<Card className="w-full max-w-sm border-amber-500/40 bg-surface/90 backdrop-blur-sm shadow-xl hover:border-amber-400 transition-colors">
						<CardContent className="p-4 flex items-center gap-4">
							<UserAvatar
								userId={president.user?.id}
								avatar={president.user?.avatar}
								name={president.user?.username}
								size="lg"
							/>
							<div className="min-w-0 flex-1">
								<div className="flex items-center justify-between gap-2">
									<Link
										href={`/achillea/users/${president.user?.id}`}
										className="font-extrabold text-base text-on-surface hover:text-primary transition-colors truncate"
									>
										{president.user?.username ?? "Président"}
									</Link>
									<Badge variant="destructive" className="text-xs font-bold shrink-0">
										Président
									</Badge>
								</div>
								<p className="text-xs text-on-surface-variant mt-0.5">
									Capitaine & Fondateur
								</p>
								{president.distinctions && president.distinctions.length > 0 && (
									<div className="flex flex-wrap gap-1 mt-2">
										{president.distinctions.map((d) => (
											<span
												key={d}
												className="px-1.5 py-0.5 rounded text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium"
											>
												{distinctionLabel(d)}
											</span>
										))}
									</div>
								)}
							</div>
						</CardContent>
					</Card>
				) : (
					<div className="p-4 rounded-xl border border-dashed border-outline/30 text-xs text-on-surface-variant">
						Aucun président désigné
					</div>
				)}
			</div>

			{/* Level 2: Vice-Presidents / Sub-Captains */}
			{viceCaptains.length > 0 && (
				<div className="space-y-4">
					<div className="text-center">
						<span className="text-xs font-bold uppercase tracking-wider text-primary flex items-center justify-center gap-1.5">
							<Shield className="size-3.5" />
							Vice-Présidence ({viceCaptains.length})
						</span>
					</div>

					<div className="flex flex-wrap justify-center gap-4">
						{viceCaptains.map((vp) => (
							<Card
								key={vp.user?.id}
								className="w-full sm:w-72 border-primary/30 bg-surface/80 hover:border-primary/60 transition-colors shadow-md"
							>
								<CardContent className="p-3.5 flex items-center gap-3">
									<UserAvatar
										userId={vp.user?.id}
										avatar={vp.user?.avatar}
										name={vp.user?.username}
										size="md"
									/>
									<div className="min-w-0 flex-1">
										<div className="flex items-center justify-between gap-1">
											<Link
												href={`/achillea/users/${vp.user?.id}`}
												className="font-bold text-sm text-on-surface hover:text-primary transition-colors truncate"
											>
												{vp.user?.username}
											</Link>
											<Badge variant="default" className="text-xs shrink-0">
												Vice-Président
											</Badge>
										</div>
										<p className="text-xs text-on-surface-variant mt-0.5">
											Sous-capitaine
										</p>
										{vp.distinctions && vp.distinctions.length > 0 && (
											<div className="flex flex-wrap gap-1 mt-1.5">
												{vp.distinctions.map((d) => (
													<span
														key={d}
														className="px-1.5 py-0.5 rounded text-xs bg-primary/10 text-primary border border-primary/20"
													>
														{distinctionLabel(d)}
													</span>
												))}
											</div>
										)}
									</div>
								</CardContent>
							</Card>
						))}
					</div>
				</div>
			)}

			{/* Level 3: Staff & Encadrement */}
			{staffMembers.length > 0 && (
				<div className="space-y-4">
					<div className="text-center">
						<span className="text-xs font-bold uppercase tracking-wider text-sky-400 flex items-center justify-center gap-1.5">
							<Award className="size-3.5" />
							Staff & Encadrement ({staffMembers.length})
						</span>
					</div>

					<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
						{staffMembers.map((st) => (
							<div
								key={st.user?.id}
								className="flex items-center gap-3 p-3 rounded-xl border border-sky-500/20 bg-surface/60 hover:border-sky-500/40 transition-colors"
							>
								<UserAvatar
									userId={st.user?.id}
									avatar={st.user?.avatar}
									name={st.user?.username}
									size="md"
								/>
								<div className="min-w-0 flex-1">
									<Link
										href={`/achillea/users/${st.user?.id}`}
										className="font-semibold text-sm text-on-surface hover:text-primary transition-colors truncate block"
									>
										{st.user?.username}
									</Link>
									<div className="flex flex-wrap gap-1 mt-1">
										<Badge variant="outline" className="text-xs border-sky-500/30 text-sky-400">
											Staff
										</Badge>
										{st.distinctions?.map((d) => (
											<span
												key={d}
												className="px-1.5 py-0.5 rounded text-xs bg-surface-variant text-on-surface-variant"
											>
												{distinctionLabel(d)}
											</span>
										))}
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Level 4: Joueurs & Membres */}
			<div className="space-y-4">
				<div className="text-center">
					<span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant flex items-center justify-center gap-1.5">
						<Users className="size-3.5" />
						Effectif Joueurs ({players.length})
					</span>
				</div>

				<div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
					{players.map((pl) => (
						<div
							key={pl.user?.id}
							className="flex items-center justify-between p-3 rounded-xl border border-outline/20 bg-surface/50 hover:border-outline/40 transition-colors"
						>
							<div className="flex items-center gap-2.5 min-w-0">
								<UserAvatar
									userId={pl.user?.id}
									avatar={pl.user?.avatar}
									name={pl.user?.username}
									size="sm"
								/>
								<div className="min-w-0">
									<Link
										href={`/achillea/users/${pl.user?.id}`}
										className="font-medium text-sm text-on-surface hover:text-primary transition-colors truncate block"
									>
										{pl.user?.username}
									</Link>
									<span className="text-xs text-on-surface-variant">
										{pl.clanRole === ClanMemberRole.Trial ? "À l'essai" : "Membre actif"}
									</span>
								</div>
							</div>

							<div className="flex flex-col items-end gap-1 shrink-0">
								{pl.distinctions?.slice(0, 1).map((d) => (
									<Badge key={d} variant="secondary" className="text-xs font-normal">
										{distinctionLabel(d)}
									</Badge>
								))}
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
