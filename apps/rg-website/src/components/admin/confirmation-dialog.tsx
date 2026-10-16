"use client";

import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rosegriffon/ui";
import { useState } from "react";

import { AlertTriangle } from "@/lib/icons-config";

interface ConfirmationDialogProps {
	open: boolean;
	title: string;
	description?: string;
	message: string;
	danger?: boolean;
	confirmText?: string;
	cancelText?: string;
	onConfirm: () => Promise<void> | void;
	onCancel: () => void;
	isLoading?: boolean;
}

export function ConfirmationDialog({
	open,
	title,
	description,
	message,
	danger = false,
	confirmText = "Confirmer",
	cancelText = "Annuler",
	onConfirm,
	onCancel,
	isLoading = false,
}: ConfirmationDialogProps) {
	const [loading, setLoading] = useState(false);

	const handleConfirm = async () => {
		setLoading(true);
		try {
			await onConfirm();
		} finally {
			setLoading(false);
		}
	};

	const dangerColor = danger ? "destructive" : "default";

	return (
		<Dialog open={open} onOpenChange={(newOpen) => !newOpen && onCancel()}>
			<DialogContent>
				<DialogHeader>
					<div className="flex items-center gap-2">
						{danger && <AlertTriangle className="size-5 text-red-500" />}
						<DialogTitle>{title}</DialogTitle>
					</div>
					{description && <DialogDescription>{description}</DialogDescription>}
				</DialogHeader>

				<p className="text-muted-foreground py-4">{message}</p>

				<DialogFooter className="gap-3">
					<Button variant="outline" onClick={onCancel} disabled={loading || isLoading}>
						{cancelText}
					</Button>
					<Button
						variant={dangerColor}
						onClick={handleConfirm}
						disabled={loading || isLoading}
						className={dangerColor === "destructive" ? "bg-red-600 hover:bg-red-700" : ""}
					>
						{loading || isLoading ? "Chargement..." : confirmText}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
