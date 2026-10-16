"use client";

import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@rosegriffon/ui";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { deleteChronicle, toggleChronicleStatus } from "@/app/admin/chroniques/actions";

import { Edit, Eye, EyeOff, MoreHorizontal, Trash } from "@/lib/icons-config";

interface ChronicleActionsProps {
	id: string;
	published: boolean;
}

export function ChronicleActions({ id, published }: ChronicleActionsProps) {
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [isPending, setIsPending] = useState(false);

	const handleToggleStatus = async () => {
		try {
			setIsPending(true);
			const result = await toggleChronicleStatus(id, published);

			if (!result.success) {
				toast.error(result.error || "Erreur lors de la modification");
				return;
			}

			toast.success(`Chronique ${published ? "dépubliée" : "publiée"} avec succès`);
		} catch (error) {
			console.error("Erreur toggleChronicleStatus:", error);
			toast.error("Erreur lors de la modification du statut");
		} finally {
			setIsPending(false);
		}
	};

	const handleDelete = async () => {
		try {
			setIsPending(true);
			const result = await deleteChronicle(id);

			if (!result.success) {
				toast.error(result.error || "Erreur lors de la suppression");
				return;
			}

			toast.success("Chronique supprimée avec succès");
			setShowDeleteDialog(false);
		} catch (error) {
			console.error("Erreur deleteChronicle:", error);
			toast.error("Erreur lors de la suppression");
		} finally {
			setIsPending(false);
		}
	};

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" className="size-8 p-0">
						<span className="sr-only">Ouvrir le menu</span>
						<MoreHorizontal className="size-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuLabel>Actions</DropdownMenuLabel>
					<DropdownMenuItem asChild>
						<Link href={`/admin/chroniques/${id}/edit`}>
							<Edit className="mr-2 size-4" />
							Éditer
						</Link>
					</DropdownMenuItem>
					<DropdownMenuItem onClick={handleToggleStatus} disabled={isPending}>
						{published ? (
							<>
								<EyeOff className="mr-2 size-4" />
								Dépublier
							</>
						) : (
							<>
								<Eye className="mr-2 size-4" />
								Publier
							</>
						)}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={() => setShowDeleteDialog(true)}
						className="text-destructive focus:text-destructive"
					>
						<Trash className="mr-2 size-4" />
						Supprimer
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>

			<AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Êtes-vous absolument sûr ?</AlertDialogTitle>
						<AlertDialogDescription>
							Cette action est irréversible. Cela supprimera définitivement la chronique de nos
							serveurs.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Annuler</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							Supprimer
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
