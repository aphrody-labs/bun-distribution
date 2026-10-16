"use client";

import {
	Badge,
	Button,
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@rosegriffon/ui";
import { Check, Edit, EyeOff, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";

import type { TeamMember } from "./actions";
import { AvatarMembre } from "./AvatarMembre";
import { SOURCE_DISCORD } from "./staff-schema";

interface StaffMemberCardProps {
	member: TeamMember;
	teamLabel: string;
	onEdit: (member: TeamMember) => void;
	onDelete: (member: TeamMember) => void;
	/** Bascule l'activation ; `actif` est l'état visé. */
	onToggleActive: (member: TeamMember, actif: boolean) => void;
	/** Verrouille les commandes pendant qu'une action serveur est en cours. */
	disabled?: boolean;
}

/** Rôle générique posé par la synchronisation Discord, à préciser à la main. */
const ROLE_PROVISOIRE = "Staff";

export function StaffMemberCard({
	member,
	teamLabel,
	onEdit,
	onDelete,
	onToggleActive,
	disabled = false,
}: StaffMemberCardProps) {
	const estInactif = member.is_active === false;
	const estImportDiscord = member.source === SOURCE_DISCORD;
	const estEnAttente = estInactif && estImportDiscord;
	const roleProvisoire = member.role === ROLE_PROVISOIRE;

	const libelleValidation = estEnAttente ? "Valider" : "Réactiver";

	return (
		<Card
			className={
				estInactif
					? "overflow-hidden border-alerte/40 bg-alerte/5 transition-shadow hover:shadow-md"
					: "overflow-hidden transition-shadow hover:shadow-md"
			}
		>
			<CardHeader className="p-0">
				<div className="relative h-24 bg-linear-to-r from-surface-container to-surface-container-high">
					<div className="absolute -bottom-10 left-1/2 -translate-x-1/2">
						<AvatarMembre
							src={member.image_url}
							alt={`Photo de ${member.name}`}
							taille={80}
							attenue={estInactif}
							className={estInactif ? "border-4 border-alerte/40" : "border-4 border-background"}
						/>
					</div>
					<div className="absolute right-2 top-2">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									size="icon"
									className="size-8 text-on-surface-variant hover:bg-surface-container-highest hover:text-foreground"
									aria-label={`Actions pour ${member.name}`}
									disabled={disabled}
								>
									<MoreHorizontal className="size-4" aria-hidden="true" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuLabel>Actions</DropdownMenuLabel>
								{estInactif ? (
									<DropdownMenuItem onClick={() => onToggleActive(member, true)}>
										{estEnAttente ? (
											<Check className="mr-2 size-4" aria-hidden="true" />
										) : (
											<RotateCcw className="mr-2 size-4" aria-hidden="true" />
										)}
										{libelleValidation}
									</DropdownMenuItem>
								) : (
									<DropdownMenuItem onClick={() => onToggleActive(member, false)}>
										<EyeOff className="mr-2 size-4" aria-hidden="true" />
										Désactiver
									</DropdownMenuItem>
								)}
								<DropdownMenuItem onClick={() => onEdit(member)}>
									<Edit className="mr-2 size-4" aria-hidden="true" />
									Modifier
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									onClick={() => onDelete(member)}
									className="text-destructive focus:text-destructive"
								>
									<Trash2 className="mr-2 size-4" aria-hidden="true" />
									Supprimer
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</CardHeader>

			<CardContent className="mt-12 p-4 pb-2 pt-10 text-center">
				<h3 className="text-lg font-semibold leading-tight wrap-break-word">{member.name}</h3>
				<p
					className={
						roleProvisoire
							? "text-sm font-medium italic text-alerte"
							: "text-sm font-medium text-on-surface-variant"
					}
					title={roleProvisoire ? "Rôle générique à préciser" : undefined}
				>
					{member.role}
				</p>
				<p className="mt-1 text-xs text-on-surface-variant/70">{teamLabel}</p>

				<div className="mt-3 flex flex-wrap justify-center gap-1">
					{member.discord_user_id && (
						<a
							href={`https://discord.com/users/${member.discord_user_id}`}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center rounded-full bg-discord/10 px-2 py-0.5 text-xs font-medium text-discord hover:bg-discord/20"
						>
							Lié à Discord
							<span className="sr-only"> — ouvrir le profil {member.discord_user_id}</span>
						</a>
					)}
					{estImportDiscord && (
						<Badge variant="outline" className="border-alerte/40 text-alerte">
							Import Discord
						</Badge>
					)}
					{estInactif && !estEnAttente && <Badge variant="secondary">Désactivé</Badge>}
				</div>
			</CardContent>

			<CardFooter className="flex flex-col gap-2 p-4 pb-6 pt-2">
				{estInactif ? (
					<Button
						size="sm"
						className="w-full"
						disabled={disabled}
						onClick={() => onToggleActive(member, true)}
					>
						{estEnAttente ? (
							<Check className="mr-2 size-4" aria-hidden="true" />
						) : (
							<RotateCcw className="mr-2 size-4" aria-hidden="true" />
						)}
						{libelleValidation}
					</Button>
				) : (
					<div className="text-xs text-on-surface-variant">
						Ordre&nbsp;: {member.display_index ?? "—"}
					</div>
				)}
			</CardFooter>
		</Card>
	);
}
