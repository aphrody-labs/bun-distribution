"use client";

import { Button } from "@rosegriffon/ui";
import Image from "next/image";
import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Loader2, Upload, X } from "@/lib/icons-config";
import { getBrowserStorage } from "@/lib/storage/browser";

interface MediaUploaderProps {
	onUploadComplete: () => void;
}

export function MediaUploader({ onUploadComplete }: MediaUploaderProps) {
	const [uploading, setUploading] = useState(false);
	const [files, setFiles] = useState<File[]>([]);

	const onDrop = useCallback((acceptedFiles: File[]) => {
		setFiles((prev) => [...prev, ...acceptedFiles]);
	}, []);

	const { getRootProps, getInputProps, isDragActive } = useDropzone({
		accept: {
			"image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"],
		},
		maxSize: 5 * 1024 * 1024, // 5MB
		onDrop,
	});

	const removeFile = (index: number) => {
		setFiles((prev) => prev.filter((_, i) => i !== index));
	};

	const handleUpload = async () => {
		if (files.length === 0) {
			return;
		}

		setUploading(true);
		const storage = getBrowserStorage();

		try {
			// Vérifier que l'utilisateur est bien authentifié (via cookie de session)

			const uploadPromises = files.map(async (file) => {
				const fileExt = file.name.split(".").pop()?.toLowerCase();
				const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
				const filePath = `chronicles/${fileName}`;

				const { error } = await storage.from("assets").upload(filePath, file, {
					cacheControl: "3600",
					upsert: false,
				});

				if (error) {
					console.error("Upload error details:", error);
					if (error.message?.includes("policy") || error.message?.includes("permission")) {
						throw new Error("Permission refusée. Vérifiez que vous êtes admin.");
					}
					throw error;
				}
			});

			await Promise.all(uploadPromises);
			toast.success("Images téléchargées avec succès");
			setFiles([]);
			onUploadComplete();
		} catch (error) {
			console.error("Upload error:", error);
			const errorMessage = error instanceof Error ? error.message : "Erreur lors du téléchargement";
			toast.error(errorMessage);
		} finally {
			setUploading(false);
		}
	};

	return (
		<div className="space-y-4">
			<div
				{...getRootProps()}
				className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
					isDragActive
						? "border-primary bg-primary/10"
						: "border-muted-foreground/25 hover:border-primary/50"
				}`}
			>
				<input {...getInputProps()} />
				<Upload className="size-10 mx-auto mb-4 text-muted-foreground" />
				{isDragActive ? (
					<p>Déposez les fichiers ici...</p>
				) : (
					<p>
						Glissez-déposez des images ici, ou cliquez pour sélectionner
						<br />
						<span className="text-xs text-muted-foreground">(Max 5MB par fichier)</span>
					</p>
				)}
			</div>

			{files.length > 0 && (
				<div className="space-y-4">
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
						{files.map((file, index) => (
							<div key={index} className="relative group border rounded-md p-2 bg-background">
								<div className="aspect-square relative mb-2 bg-muted rounded overflow-hidden">
									<Image
										src={URL.createObjectURL(file)}
										alt={file.name}
										fill
										className="object-cover"
									/>
								</div>
								<p className="text-xs truncate px-1">{file.name}</p>
								<button
									onClick={() => removeFile(index)}
									className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
								>
									<X className="size-3" />
								</button>
							</div>
						))}
					</div>
					<div className="flex justify-end">
						<Button onClick={handleUpload} disabled={uploading}>
							{uploading && <Loader2 className="mr-2 size-4 animate-spin" />}
							{uploading ? "Téléchargement..." : "Envoyer vers le serveur"}
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
