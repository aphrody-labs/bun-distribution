"use client";

import {
	Button,
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
	Input,
	Textarea,
	Label,
} from "@rosegriffon/ui";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { toast } from "sonner";

import { createEvent, deleteEvent, updateEvent } from "@/app/admin/events/actions";
import { ConfirmationDialog } from "@/components/admin/confirmation-dialog";

import { Loader2, Trash2 } from "@/lib/icons-config";
import type { Tables } from "@rosegriffon/db";

interface EventFormProps {
	event?: Tables<"events">;
	isEditing?: boolean;
}

const initialState: { message: string; errors?: Record<string, string[]> } = {
	errors: {},
	message: "",
};

export function EventForm({ event, isEditing = false }: EventFormProps) {
	const action = isEditing && event?.id ? updateEvent.bind(null, event.id) : createEvent;
	const [state, formAction, isPending] = useActionState(action, initialState);

	// Helper to format date for datetime-local input
	const formatDate = (dateString?: string) => {
		if (!dateString) {
			return "";
		}
		const date = new Date(dateString);
		return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
	};

	const router = useRouter();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	const handleDelete = async () => {
		if (!event?.id) {
			return;
		}

		setIsDeleting(true);
		try {
			const result = await deleteEvent(event.id);
			if (result.success) {
				toast.success("Événement supprimé");
				router.push("/admin/events");
			} else {
				toast.error(result.message || "Erreur lors de la suppression");
			}
		} catch {
			toast.error("Une erreur est survenue");
		} finally {
			setIsDeleting(false);
			setDeleteDialogOpen(false);
		}
	};

	return (
		<>
			<Card className="w-full max-w-2xl mx-auto">
				<CardHeader>
					<CardTitle>{isEditing ? "Modifier l'événement" : "Créer un événement"}</CardTitle>
				</CardHeader>
				<form action={formAction}>
					<CardContent className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="title">Titre</Label>
							<Input
								id="title"
								name="title"
								defaultValue={event?.title}
								placeholder="Titre de l'événement"
								required
							/>
							{state?.errors?.title && <p className="text-sm text-red-500">{state.errors.title}</p>}
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">Description</Label>
							<Textarea
								id="description"
								name="description"
								defaultValue={event?.description || undefined}
								placeholder="Description détaillée..."
								rows={5}
							/>
							{state?.errors?.description && (
								<p className="text-sm text-red-500">{state.errors.description}</p>
							)}
						</div>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div className="space-y-2">
								<Label htmlFor="start_time">Date de début</Label>
								<Input
									id="start_time"
									name="start_time"
									type="datetime-local"
									defaultValue={formatDate(event?.start_time)}
									required
								/>
								{state?.errors?.start_time && (
									<p className="text-sm text-red-500">{state.errors.start_time}</p>
								)}
							</div>

							<div className="space-y-2">
								<Label htmlFor="end_time">Date de fin (optionnel)</Label>
								<Input
									id="end_time"
									name="end_time"
									type="datetime-local"
									defaultValue={formatDate(event?.end_time)}
								/>
								{state?.errors?.end_time && (
									<p className="text-sm text-red-500">{state.errors.end_time}</p>
								)}
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="location">Lieu (optionnel)</Label>
							<Input
								id="location"
								name="location"
								defaultValue={event?.location || undefined}
								placeholder="Ex: Discord, Twitch, Paris..."
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="image_url">URL de l'image (optionnel)</Label>
							<Input
								id="image_url"
								name="image_url"
								defaultValue={event?.image_url || undefined}
								placeholder="https://..."
							/>
						</div>

						{state?.message && (
							<div className="p-3 bg-red-100 border border-red-200 text-red-700 rounded-md text-sm">
								{state.message}
							</div>
						)}
					</CardContent>
					<CardFooter className="flex justify-between space-x-2">
						{isEditing && (
							<Button
								type="button"
								variant="destructive"
								onClick={() => setDeleteDialogOpen(true)}
								disabled={isPending || isDeleting}
							>
								<Trash2 className="mr-2 size-4" />
								Supprimer
							</Button>
						)}
						<div className="flex-1 flex justify-end">
							<Button type="submit" disabled={isPending || isDeleting}>
								{isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
								{isEditing ? "Mettre à jour" : "Créer l'événement"}
							</Button>
						</div>
					</CardFooter>
				</form>
			</Card>

			<ConfirmationDialog
				open={deleteDialogOpen}
				title="Supprimer l'événement"
				message="Êtes-vous sûr de vouloir supprimer cet événement ? Cette action est irréversible."
				confirmText="Supprimer"
				danger
				onConfirm={handleDelete}
				onCancel={() => setDeleteDialogOpen(false)}
				isLoading={isDeleting}
			/>
		</>
	);
}
