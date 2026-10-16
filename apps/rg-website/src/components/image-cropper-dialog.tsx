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
import { Cropper } from "@origin-space/image-cropper";
import * as React from "react";

import { Loader2 } from "@/lib/icons-config";

interface ImageCropperDialogProps {
	image: string;
	open: boolean;
	onClose: () => void;
	onCropComplete: (croppedImageUrl: string) => void;
	title?: string;
	suggestedAspectRatio?: number;
	outputWidth?: number;
	quality?: number;
	validateButtonText?: React.ReactNode;
	freeAspect?: boolean;
	additionalButtons?: React.ReactNode;
}

export function ImageCropperDialog({
	image,
	open,
	onClose,
	onCropComplete,
	title = "Recadrer l'image",
	suggestedAspectRatio = 1,
	outputWidth = 800,
	quality = 0.9,
	validateButtonText = "Valider",
	freeAspect = false,
	additionalButtons,
}: ImageCropperDialogProps) {
	const [cropArea, setCropArea] = React.useState<{
		x: number;
		y: number;
		width: number;
		height: number;
	} | null>(null);
	const [zoom, setZoom] = React.useState(1);
	const [isProcessing, setIsProcessing] = React.useState(false);
	const canvasRef = React.useRef<HTMLCanvasElement>(null);

	// Reset state when dialog closes
	React.useEffect(() => {
		if (!open) {
			// Reset after animation completes (300ms dialog animation)
			const timer = setTimeout(() => {
				setCropArea(null);
				setZoom(1);
			}, 300);
			return () => clearTimeout(timer);
		}
	}, [open]);

	const handleCropChange = React.useCallback(
		(pixels: { x: number; y: number; width: number; height: number } | null) => {
			setCropArea(pixels);
		},
		[]
	);

	const handleZoomChange = React.useCallback((newZoom: number) => {
		setZoom(newZoom);
	}, []);

	const handleCancel = React.useCallback(() => {
		if (isProcessing) {
			return;
		}
		setCropArea(null);
		setZoom(1);
		onClose();
	}, [isProcessing, onClose]);

	const handleCrop = React.useCallback(async () => {
		if (!cropArea || !canvasRef.current || isProcessing || !image) {
			return;
		}

		setIsProcessing(true);

		try {
			const img = new Image();
			img.crossOrigin = "anonymous";

			await new Promise<void>((resolve, reject) => {
				img.onload = () => resolve();
				img.onerror = () => reject(new Error("Failed to load image"));
				img.src = image;
			});

			const canvas = canvasRef.current;
			const aspectRatio = cropArea.width / cropArea.height;
			canvas.width = outputWidth;
			canvas.height = Math.round(outputWidth / aspectRatio);

			const ctx = canvas.getContext("2d");
			if (!ctx) {
				throw new Error("Failed to get canvas context");
			}

			ctx.drawImage(
				img,
				Math.round(cropArea.x),
				Math.round(cropArea.y),
				Math.round(cropArea.width),
				Math.round(cropArea.height),
				0,
				0,
				canvas.width,
				canvas.height
			);

			canvas.toBlob(
				(blob) => {
					if (!blob) {
						throw new Error("Failed to create blob from canvas");
					}

					const url = URL.createObjectURL(blob);
					onCropComplete(url);

					// Cleanup
					setTimeout(() => {
						setIsProcessing(false);
						setCropArea(null);
						setZoom(1);
						handleCancel();
					}, 100);
				},
				"image/jpeg",
				quality
			);
		} catch (error) {
			console.error("Error processing crop:", error);
			setIsProcessing(false);
		}
	}, [cropArea, image, outputWidth, quality, onCropComplete, handleCancel, isProcessing]);

	// Early return if no image
	if (!image) {
		return (
			<Dialog open={open} onOpenChange={onClose}>
				<DialogContent className="max-w-md w-[95vw] sm:w-full">
					<DialogHeader>
						<DialogTitle>Erreur</DialogTitle>
					</DialogHeader>
					<p className="text-sm text-muted-foreground">Aucune image à traiter</p>
					<DialogFooter>
						<Button onClick={onClose} variant="outline" className="w-full sm:w-auto">
							Fermer
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	}

	return (
		<>
			<canvas ref={canvasRef} className="hidden" />
			<Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleCancel()}>
				<DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full p-4 sm:p-6 [&_img]:max-w-full [&_img]:w-full [&_img]:h-auto">
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>
							Ajustez le cadrage de votre image avant de continuer
						</DialogDescription>
					</DialogHeader>

					<div className="w-full h-[300px] sm:h-[400px] md:h-[500px] flex items-center justify-center bg-muted rounded-lg overflow-hidden relative">
						{image && (
							<div className="w-full h-full absolute inset-0">
								<Cropper.Root
									image={image}
									aspectRatio={freeAspect ? undefined : suggestedAspectRatio}
									zoom={zoom}
									onCropChange={handleCropChange}
									onZoomChange={handleZoomChange}
									className="w-full h-full [&_img]:max-w-full [&_img]:w-full [&_img]:h-auto [&_div]:w-full [&_div]:h-full"
								>
									<Cropper.Image />
									<Cropper.CropArea />
								</Cropper.Root>
							</div>
						)}
					</div>

					<DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
						{additionalButtons}
						<Button
							variant="outline"
							onClick={handleCancel}
							disabled={isProcessing}
							className="w-full sm:w-auto"
						>
							Annuler
						</Button>
						<Button
							onClick={handleCrop}
							disabled={!cropArea || isProcessing}
							className="w-full sm:w-auto bg-[#a14b3f] hover:bg-[#8a3f35]"
						>
							{isProcessing ? (
								<>
									<Loader2 className="mr-2 size-4 animate-spin" />
									Traitement...
								</>
							) : (
								validateButtonText
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
