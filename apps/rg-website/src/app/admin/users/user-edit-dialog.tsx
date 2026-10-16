"use client";

import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
	Input,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
	Form,
	FormControl,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@rosegriffon/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Edit } from "@/lib/icons-config";
import type { Database } from "@rosegriffon/db";

import { updateUserProfile } from "./actions";

const userEditSchema = z.object({
	full_name: z.string().optional(),
	role: z.enum(["user", "admin", "moderator", "staff"]),
});

type UserEditFormValues = z.infer<typeof userEditSchema>;

interface UserEditDialogProps {
	user: Database["public"]["Tables"]["profiles"]["Row"];
}

export function UserEditDialog({ user }: UserEditDialogProps) {
	const [open, setOpen] = useState(false);
	const router = useRouter();

	const form = useForm<UserEditFormValues>({
		defaultValues: {
			full_name: user.full_name || "",
			role: (user.role || "user") as "user" | "admin" | "moderator" | "staff",
		},
		resolver: zodResolver(userEditSchema),
	});

	const onSubmit = async (values: UserEditFormValues) => {
		const toastId = toast.loading("Mise à jour...");

		try {
			const result = await updateUserProfile(user.id, values);

			if (result.error) {
				toast.error("Erreur", {
					description: result.error,
					id: toastId,
				});
			} else {
				toast.success("Utilisateur mis à jour", {
					description: `Le profil de ${user.email || "l'utilisateur"} a été mis à jour.`,
					id: toastId,
				});
				setOpen(false);
				router.refresh();
			}
		} catch {
			toast.error("Erreur", {
				description: "Une erreur est survenue.",
				id: toastId,
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="ghost" size="sm">
					<Edit className="size-4" />
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Modifier l'utilisateur</DialogTitle>
					<DialogDescription>Modifier les informations de {user.email}</DialogDescription>
				</DialogHeader>

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						<FormField
							control={form.control}
							name="full_name"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Nom complet</FormLabel>
									<FormControl>
										<Input placeholder="Nom complet" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>

						<FormField
							control={form.control}
							name="role"
							render={({ field }) => (
								<FormItem>
									<FormLabel>Rôle</FormLabel>
									<Select onValueChange={field.onChange} defaultValue={field.value}>
										<FormControl>
											<SelectTrigger>
												<SelectValue placeholder="Sélectionner un rôle" />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="user">Utilisateur</SelectItem>
											<SelectItem value="staff">Staff</SelectItem>
											<SelectItem value="moderator">Modérateur</SelectItem>
											<SelectItem value="admin">Administrateur</SelectItem>
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div className="flex justify-end gap-2">
							<Button type="button" variant="outline" onClick={() => setOpen(false)}>
								Annuler
							</Button>
							<Button type="submit" disabled={form.formState.isSubmitting}>
								{form.formState.isSubmitting ? "Sauvegarde..." : "Sauvegarder"}
							</Button>
						</div>
					</form>
				</Form>
			</DialogContent>
		</Dialog>
	);
}
