"use client";

import { rankImagePath } from "@rosegriffon/achillea-core";
import type { PlayerCircuitProfile } from "@rosegriffon/achillea-types/domain/tournament";
import type { EnrichedUserDTO } from "@rosegriffon/achillea-types/domain/user";
import { ClanMemberRole } from "@rosegriffon/achillea-types/enums/clanMemberRole";
import {
	Badge,
	Button,
	Card,
	CardContent,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Skeleton,
} from "@rosegriffon/ui";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	Crown,
	ExternalLink,
	Loader2,
	Pencil,
	ShieldAlert,
	Star,
	Trophy,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { FaTwitch, FaYoutube } from "react-icons/fa6";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import { createAchilleaClient, useAchilleaAuth } from "@/lib/achillea";

function winrate(wins?: number, losses?: number): string {
	const total = (wins ?? 0) + (losses ?? 0);
	if (total === 0) return "—";
	return `${Math.round(((wins ?? 0) / total) * 100)}%`;
}

function formatGoalAverage(value?: number): string {
	if (value === undefined || value === null) return "—";
	if (value >= 999) return "∞";
	return value.toFixed(2);
}

function getRankImg(key?: string | null): string {
	const p = rankImagePath(key ?? "Fer");
	return p.startsWith("/") ? p : `/${p}`;
}

export default function UserProfilePage({ id }: { id: string }) {
	const { user: currentUser, isAuthenticated } = useAchilleaAuth();

	const [profile, setProfile] = useState<EnrichedUserDTO | null>(null);
	const [circuit, setCircuit] = useState<PlayerCircuitProfile | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Edit profile dialog
	const [editOpen, setEditOpen] = useState(false);
	const [bioInput, setBioInput] = useState("");
	const [twitchInput, setTwitchInput] = useState("");
	const [saving, setSaving] = useState(false);
	const [saveSuccess, setSaveSuccess] = useState(false);

	const isOwnProfile = isAuthenticated && currentUser?.id === id;
	const rgProfileUsername = profile?.rgProfileUsername;

	useEffect(() => {
		let isMounted = true;
		async function fetchUser() {
			setLoading(true);
			setError(null);
			const client = createAchilleaClient({ credentials: "include" });

			try {
				const [userRes, circuitRes] = await Promise.all([
					client.users.get(id),
					client.tournaments.circuitPlayer(id),
				]);

				if (!isMounted) return;

				if (userRes.ok && userRes.value) {
					setProfile(userRes.value);
					setBioInput(userRes.value.bio ?? "");
					setTwitchInput(userRes.value.twitchUrl ?? "");
				} else {
					setError("Utilisateur introuvable ou profil inaccessible");
				}

				if (circuitRes.ok && circuitRes.value) {
					setCircuit(circuitRes.value);
				}
			} catch {
				if (isMounted) {
					setError("Erreur lors de la récupération du profil");
				}
			} finally {
				if (isMounted) setLoading(false);
			}
		}

		fetchUser();
		return () => {
			isMounted = false;
		};
	}, [id]);

	const handleSaveProfile = async () => {
		if (!isOwnProfile) return;
		setSaving(true);
		setSaveSuccess(false);
		const client = createAchilleaClient({ credentials: "include" });

		try {
			const res = await client.users.updateMyProfile({
				bio: bioInput.trim() || null,
				twitchUrl: twitchInput.trim() || null,
			});

			if (res.ok) {
				setProfile((prev) =>
					prev
						? {
								...prev,
								bio: bioInput.trim() || null,
								twitchUrl: twitchInput.trim() || null,
							}
						: null,
				);
				setSaveSuccess(true);
				setTimeout(() => {
					setEditOpen(false);
					setSaveSuccess(false);
				}, 600);
			}
		} catch {
			// silent fallback
		} finally {
			setSaving(false);
		}
	};

	if (loading) {
		return (
			<div className="max-w-6xl mx-auto px-4 py-8 space-y-8">
				<div className="flex items-center gap-4">
					<Skeleton className="size-20 rounded-full" />
					<div className="space-y-2">
						<Skeleton className="h-8 w-48" />
						<Skeleton className="h-4 w-32" />
					</div>
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					<Skeleton className="h-40 rounded-xl" />
					<Skeleton className="h-40 rounded-xl" />
				</div>
			</div>
		);
	}

	if (error || !profile) {
		return (
			<div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
				<div className="size-14 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
					<ShieldAlert className="size-7" />
				</div>
				<h1 className="text-2xl font-bold">Profil introuvable</h1>
				<p className="text-muted-foreground text-sm">
					{error ?? "Ce joueur n'existe pas ou son compte a été désactivé."}
				</p>
				<Link href="/achillea/ranked/leaderboard">
					<Button variant="outline" className="gap-2 mt-4">
						<ArrowLeft className="size-4" />
						Voir le classement
					</Button>
				</Link>
			</div>
		);
	}

	return (
		<div className="max-w-6xl mx-auto px-4 py-8 space-y-10">
			{/* En-tête profil */}
			<div className="bg-card border border-border/60 rounded-2xl p-6 md:p-8 shadow-sm">
				<div className="flex flex-col md:flex-row items-center md:items-start gap-6">
					<UserAvatar
						userId={profile.id}
						avatar={profile.avatar}
						name={profile.username}
						size="xl"
						className="size-24 text-3xl shrink-0"
					/>

					<div className="flex-1 text-center md:text-left space-y-3">
						<div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
							<h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
								{profile.clan?.shortenedName && (
									<span className="text-primary font-mono mr-2">
										[{profile.clan.shortenedName}]
									</span>
								)}
								{profile.username}
							</h1>
							{rgProfileUsername && (
								<Link
									href={`/profil/${encodeURIComponent(rgProfileUsername)}`}
									className="text-sm font-medium text-primary hover:underline"
								>
									Voir le profil public Rose Griffon
								</Link>
							)}

							{profile.clan && (
								<Link
									href={`/achillea/clans/${profile.clan.id}`}
									className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-muted hover:bg-muted/80 transition"
								>
									{profile.clan.avatarUrl && (
										<Image
											src={profile.clan.avatarUrl}
											alt={profile.clan.name}
											width={16}
											height={16}
											className="rounded-full"
										/>
									)}
									<span>{profile.clan.name}</span>
									{profile.clan.role === ClanMemberRole.Captain && (
										<Crown className="size-3.5 text-amber-500" />
									)}
								</Link>
							)}
						</div>

						{/* Niveau, XP, Badges */}
						<div className="flex flex-wrap items-center justify-center md:justify-start gap-3 text-sm text-muted-foreground">
							<span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-medium">
								<Star className="size-3.5 fill-amber-500" />
								Niveau {profile.currentLevel ?? 1} · {profile.totalXp ?? 0} XP
							</span>

							{profile.hasYoutube && (
								<span
									className="inline-flex items-center gap-1 text-red-500"
									title="YouTube lié"
								>
									<FaYoutube className="size-4" />
								</span>
							)}

							{profile.twitchUrl && (
								<a
									href={profile.twitchUrl}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex items-center gap-1.5 text-purple-400 hover:underline"
								>
									<FaTwitch className="size-4" />
									Twitch
									<ExternalLink className="size-3" />
								</a>
							)}
						</div>

						{profile.bio && (
							<p className="text-sm text-foreground/80 max-w-2xl whitespace-pre-line">
								{profile.bio}
							</p>
						)}

						{isOwnProfile && (
							<div className="flex flex-wrap gap-2 pt-2">
								<Button
									asChild
									variant="outline"
									size="sm"
									className="gap-2 text-xs"
								>
									<Link href="/settings">
										<Pencil className="size-3.5" />
										Modifier mon compte
									</Link>
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setEditOpen(true)}
									className="gap-2 text-xs"
								>
									<Pencil className="size-3.5" />
									Modifier mes infos e-sport
								</Button>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Section Ranked SOLO / DUO */}
			<div className="space-y-4">
				<div className="flex items-center gap-3">
					<span className="h-px bg-border flex-1" />
					<h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
						Ranked
					</h2>
					<span className="h-px bg-border flex-1" />
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					{/* SOLO */}
					<Card className="bg-card/50 backdrop-blur-sm border-border/60">
						<CardContent className="p-6 space-y-4">
							<div className="flex items-center justify-between border-b border-border/40 pb-3">
								<h3 className="text-lg font-bold">Solo</h3>
								<Badge variant="outline" className="font-mono text-xs">
									{profile.soloRank?.elo ?? 1000} AP
								</Badge>
							</div>
							<div className="flex items-center gap-5">
								<div className="relative size-16 shrink-0">
									<Image
										src={getRankImg(profile.soloRank?.key)}
										alt={profile.soloRank?.key ?? "Fer"}
										fill
										className="object-contain"
									/>
								</div>
								<div className="space-y-1">
									<div className="text-xl font-bold">
										{profile.soloRank?.key ?? "Non classé"}
									</div>
									<div className="text-sm text-muted-foreground">
										Victoires: {profile.ranked?.solo?.wins ?? 0} · Défaites:{" "}
										{profile.ranked?.solo?.losses ?? 0} (
										{winrate(
											profile.ranked?.solo?.wins,
											profile.ranked?.solo?.losses,
										)}
										)
									</div>
									<div className="text-xs text-muted-foreground">
										Nuls: {profile.ranked?.solo?.draws ?? 0}
									</div>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* DUO */}
					<Card className="bg-card/50 backdrop-blur-sm border-border/60">
						<CardContent className="p-6 space-y-4">
							<div className="flex items-center justify-between border-b border-border/40 pb-3">
								<h3 className="text-lg font-bold">Duo</h3>
								<Badge variant="outline" className="font-mono text-xs">
									{profile.duoRank?.elo ?? 1000} AP
								</Badge>
							</div>
							<div className="flex items-center gap-5">
								<div className="relative size-16 shrink-0">
									<Image
										src={getRankImg(profile.duoRank?.key)}
										alt={profile.duoRank?.key ?? "Fer"}
										fill
										className="object-contain"
									/>
								</div>
								<div className="space-y-1">
									<div className="text-xl font-bold">
										{profile.duoRank?.key ?? "Non classé"}
									</div>
									<div className="text-sm text-muted-foreground">
										Victoires: {profile.ranked?.duo?.wins ?? 0} · Défaites:{" "}
										{profile.ranked?.duo?.losses ?? 0} (
										{winrate(
											profile.ranked?.duo?.wins,
											profile.ranked?.duo?.losses,
										)}
										)
									</div>
									<div className="text-xs text-muted-foreground">
										Nuls: {profile.ranked?.duo?.draws ?? 0}
									</div>
								</div>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>

			{/* Circuit Tournois (All-Time) */}
			{circuit && circuit.tournamentsPlayed > 0 && (
				<div className="space-y-4">
					<div className="flex items-center gap-3">
						<span className="h-px bg-border flex-1" />
						<h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
							Circuit Tournois
						</h2>
						<span className="h-px bg-border flex-1" />
					</div>

					<Card className="bg-card/50 border-border/60">
						<CardContent className="p-6 space-y-6">
							<div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-border/40 pb-6">
								<div className="flex items-center gap-4">
									<div className="relative size-14 shrink-0">
										<Image
											src={getRankImg(circuit.tier)}
											alt={circuit.tier}
											fill
											className="object-contain"
										/>
									</div>
									<div>
										<div className="text-2xl font-black">
											{circuit.points} pts{" "}
											<span className="text-sm font-normal text-muted-foreground">
												· {circuit.tier}
											</span>
										</div>
										<div className="text-xs text-muted-foreground">
											Meilleur résultat : {circuit.bestRankLabel}
										</div>
									</div>
								</div>

								<Link
									href="/achillea/tournaments/circuit/ranking"
									className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
								>
									Voir le classement circuit complet
									<ArrowRight className="size-3.5" />
								</Link>
							</div>

							{/* Grille stats circuit */}
							<div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
								<div className="p-3 rounded-lg bg-muted/30">
									<div className="text-xl font-bold">
										{circuit.tournamentsPlayed}
									</div>
									<div className="text-xs text-muted-foreground">
										Tournois joués
									</div>
								</div>
								<div className="p-3 rounded-lg bg-muted/30">
									<div className="text-xl font-bold text-amber-500">
										{circuit.wins}
									</div>
									<div className="text-xs text-muted-foreground">Titres</div>
								</div>
								<div className="p-3 rounded-lg bg-muted/30">
									<div className="text-xl font-bold text-emerald-500">
										{circuit.podiums}
									</div>
									<div className="text-xs text-muted-foreground">Podiums</div>
								</div>
								<div className="p-3 rounded-lg bg-muted/30">
									<div className="text-xl font-bold">{circuit.top8}</div>
									<div className="text-xs text-muted-foreground">Tops 8</div>
								</div>
								<div className="p-3 rounded-lg bg-muted/30">
									<div className="text-xl font-bold font-mono">
										{circuit.goalsScored}-{circuit.goalsConceded}
									</div>
									<div className="text-xs text-muted-foreground">
										Buts M - E
									</div>
								</div>
								<div className="p-3 rounded-lg bg-muted/30">
									<div className="text-xl font-bold font-mono">
										{formatGoalAverage(circuit.goalAverage)}
									</div>
									<div className="text-xs text-muted-foreground">
										Moyenne de buts
									</div>
								</div>
								<div className="p-3 rounded-lg bg-muted/30">
									<div className="text-xl font-bold font-mono">
										{circuit.bestStreak || "—"}
									</div>
									<div className="text-xs text-muted-foreground">
										Meilleure série
									</div>
								</div>
								<div className="p-3 rounded-lg bg-muted/30">
									<div className="text-xl font-bold">
										{circuit.bestRankLabel}
									</div>
									<div className="text-xs text-muted-foreground">
										Record rang
									</div>
								</div>
							</div>

							{/* Historique tournois */}
							{circuit.history && circuit.history.length > 0 && (
								<div className="space-y-3 pt-2">
									<h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
										Historique récent des tournois
									</h4>
									<div className="overflow-x-auto">
										<table className="w-full text-sm text-left">
											<thead className="text-xs text-muted-foreground uppercase bg-muted/40">
												<tr>
													<th className="px-4 py-2.5">Tournoi</th>
													<th className="px-4 py-2.5">Date</th>
													<th className="px-4 py-2.5 text-right">Résultat</th>
													<th className="px-4 py-2.5 text-right">Points</th>
													<th className="px-4 py-2.5 text-right">Buts</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-border/40">
												{circuit.history.map((h) => (
													<tr
														key={h.tournamentId}
														className="hover:bg-muted/20"
													>
														<td className="px-4 py-3 font-medium">
															<Link
																href={`/achillea/tournaments/${h.tournamentId}`}
																className="hover:text-primary transition"
															>
																{h.tournamentName}
															</Link>
														</td>
														<td className="px-4 py-3 text-muted-foreground text-xs">
															{h.grandFinalAt
																? new Date(h.grandFinalAt).toLocaleDateString(
																		"fr-FR",
																		{
																			day: "numeric",
																			month: "short",
																			year: "numeric",
																		},
																	)
																: "—"}
														</td>
														<td className="px-4 py-3 text-right font-semibold">
															{h.rankLabel}
														</td>
														<td className="px-4 py-3 text-right font-mono text-primary font-bold">
															{h.points || "—"}
														</td>
														<td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
															{h.goalsScored}-{h.goalsConceded}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			)}

			{/* Section Statistiques Tournois & Interclans */}
			<div className="space-y-4">
				<div className="flex items-center gap-3">
					<span className="h-px bg-border flex-1" />
					<h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
						Bilan Global
					</h2>
					<span className="h-px bg-border flex-1" />
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					{/* Tournois globaux */}
					<Card className="bg-card/50 border-border/60">
						<CardContent className="p-6 space-y-4">
							<div className="flex items-center justify-between border-b border-border/40 pb-3">
								<div className="flex items-center gap-2">
									<Trophy className="size-5 text-amber-500" />
									<h3 className="font-bold">Tournois</h3>
								</div>
								<Badge variant="outline">
									{profile.tournaments?.total ?? 0} tournoi(s)
								</Badge>
							</div>

							<div className="grid grid-cols-3 gap-3 text-center">
								<div className="p-2.5 rounded-lg bg-muted/20">
									<div className="text-lg font-bold">
										{profile.tournaments?.personalTotal ?? 0}
									</div>
									<div className="text-xs text-muted-foreground">Matchs</div>
								</div>
								<div className="p-2.5 rounded-lg bg-muted/20">
									<div className="text-lg font-bold text-emerald-500">
										{profile.tournaments?.personalWins ?? 0}
									</div>
									<div className="text-xs text-muted-foreground">Victoires</div>
								</div>
								<div className="p-2.5 rounded-lg bg-muted/20">
									<div className="text-lg font-bold text-rose-500">
										{profile.tournaments?.personalLosses ?? 0}
									</div>
									<div className="text-xs text-muted-foreground">Défaites</div>
								</div>
							</div>

							<div className="text-xs text-muted-foreground flex justify-between pt-2">
								<span>
									Winrate :{" "}
									{winrate(
										profile.tournaments?.personalWins,
										profile.tournaments?.personalLosses,
									)}
								</span>
								<span>
									Moy. buts :{" "}
									{profile.tournaments?.goalsScoredAvg?.toFixed(1) ?? 0} M /{" "}
									{profile.tournaments?.goalsReceivedAvg?.toFixed(1) ?? 0} E
								</span>
							</div>
						</CardContent>
					</Card>

					{/* Interclans */}
					<Card className="bg-card/50 border-border/60">
						<CardContent className="p-6 space-y-4">
							<div className="flex items-center justify-between border-b border-border/40 pb-3">
								<div className="flex items-center gap-2">
									<Star className="size-5 text-cyan-500" />
									<h3 className="font-bold">Interclans</h3>
								</div>
								<Badge variant="outline">
									{profile.interclans?.total ?? 0} match(s)
								</Badge>
							</div>

							<div className="grid grid-cols-3 gap-3 text-center">
								<div className="p-2.5 rounded-lg bg-muted/20">
									<div className="text-lg font-bold">
										{profile.interclans?.wins ?? 0}
									</div>
									<div className="text-xs text-muted-foreground">
										Victoires clan
									</div>
								</div>
								<div className="p-2.5 rounded-lg bg-muted/20">
									<div className="text-lg font-bold text-emerald-500">
										{profile.interclans?.personalWins ?? 0}
									</div>
									<div className="text-xs text-muted-foreground">Perso V</div>
								</div>
								<div className="p-2.5 rounded-lg bg-muted/20">
									<div className="text-lg font-bold text-rose-500">
										{profile.interclans?.personalLosses ?? 0}
									</div>
									<div className="text-xs text-muted-foreground">Perso D</div>
								</div>
							</div>

							<div className="text-xs text-muted-foreground flex justify-between pt-2">
								<span>
									Winrate :{" "}
									{winrate(
										profile.interclans?.personalWins,
										profile.interclans?.personalLosses,
									)}
								</span>
								<span>
									Moy. buts :{" "}
									{profile.interclans?.goalsScoredAvg?.toFixed(1) ?? 0} M /{" "}
									{profile.interclans?.goalsReceivedAvg?.toFixed(1) ?? 0} E
								</span>
							</div>
						</CardContent>
					</Card>
				</div>
			</div>

			{/* Modale d'édition de profil (RSC/Client) */}
			<Dialog open={editOpen} onOpenChange={setEditOpen}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Modifier mon profil</DialogTitle>
						<DialogDescription>
							Personnalise ta biographie et renseigne ta chaîne Twitch pour tes
							matchs castés.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4 py-2">
						<div className="space-y-1.5">
							<label htmlFor="bio" className="text-sm font-medium">
								Bio
							</label>
							<textarea
								id="bio"
								rows={4}
								maxLength={500}
								value={bioInput}
								onChange={(e) => setBioInput(e.target.value)}
								placeholder="Quelques mots sur ton parcours, ton style de jeu..."
								className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							/>
							<div className="text-xs text-muted-foreground text-right">
								{bioInput.length}/500
							</div>
						</div>

						<div className="space-y-1.5">
							<label htmlFor="twitch" className="text-sm font-medium">
								Lien Twitch
							</label>
							<input
								id="twitch"
								type="url"
								value={twitchInput}
								onChange={(e) => setTwitchInput(e.target.value)}
								placeholder="https://twitch.tv/monpseudo"
								className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							/>
						</div>
					</div>

					<DialogFooter className="flex gap-2 sm:justify-end">
						<Button
							variant="outline"
							onClick={() => setEditOpen(false)}
							disabled={saving}
						>
							Annuler
						</Button>
						<Button
							onClick={handleSaveProfile}
							disabled={saving}
							className="gap-2"
						>
							{saving && <Loader2 className="size-4 animate-spin" />}
							{saveSuccess && <Check className="size-4 text-emerald-400" />}
							{saving
								? "Enregistrement..."
								: saveSuccess
									? "Enregistré !"
									: "Enregistrer"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
