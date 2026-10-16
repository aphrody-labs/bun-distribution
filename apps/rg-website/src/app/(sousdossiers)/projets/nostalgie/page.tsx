"use client";

export const dynamic = "force-dynamic";

import {
	Badge,
	Button,
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
	Tabs,
	TabsList,
	TabsTrigger,
	Label,
	Separator,
	Slider,
	StorageImage,
	Switch,
} from "@rosegriffon/ui";
import {
	CheckCircle2,
	CloudUpload,
	Download,
	ImageIcon,
	Link2,
	Loader2,
	MessageCircle,
	RefreshCw,
	Scissors,
	Settings,
	Share2,
	Trash2,
	X,
} from "lucide-react";
import nextDynamic from "next/dynamic";
import NextImage from "next/image";
import type React from "react";
import { useState } from "react";
import { SiDiscord } from "react-icons/si";
import { Toaster, toast } from "sonner";
import { BreadcrumbSchema } from "@/components/shared/StructuredData";

import { useNostalgieCollage } from "@/hooks/use-nostalgie-collage";
import { useNostalgieExampleImage } from "@/hooks/use-nostalgie-example-image";
import { useNostalgieUpload } from "@/hooks/use-nostalgie-upload";
import { cn } from "@/lib/utils";
import { InstagramIcon as Instagram } from "@/shared/icons/instagram";

const IE1Image = "/IE1_EN.webp";
const VRImage = "/vr.webp";

const ImageCropperDialog = nextDynamic(
	() =>
		import("@/components/image-cropper-dialog").then((mod) => ({
			default: mod.ImageCropperDialog,
		})),
	{
		loading: () => (
			<div className="flex items-center justify-center p-4">
				<Loader2 className="size-6 animate-spin" />
			</div>
		),
		ssr: false,
	}
);

// --- UI Components ---

interface UploadPlaceholderProps {
	title: string;
	year: string;
	colorClass: string;
	onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
	inputRef: React.RefObject<HTMLInputElement>;
	showPreviewImage?: boolean | "vr";
}

const UploadPlaceholder = ({
	title,
	year,
	colorClass,
	onFileInput,
	inputRef,
	showPreviewImage = false,
}: UploadPlaceholderProps) => (
	<div className="relative flex flex-col items-center justify-center gap-4 p-6 min-h-[300px] sm:min-h-[350px]">
		{/* Image de fond (IE1 ou VR selon le titre) */}
		{showPreviewImage && (
			<div className="absolute inset-0 rounded-lg overflow-hidden">
				<NextImage
					src={showPreviewImage === "vr" ? VRImage : IE1Image}
					alt={showPreviewImage === "vr" ? "Victory Road Preview" : "Inazuma Eleven Preview"}
					fill
					className="object-cover opacity-10 blur-sm"
					priority
				/>
			</div>
		)}

		<div className="relative z-10 flex flex-col items-center gap-4">
			<div className="relative">
				<div className={cn("absolute inset-0 blur-xl opacity-30", colorClass)} />
				<ImageIcon className={cn("size-16 sm:h-20 sm:w-20 relative", colorClass)} />
			</div>

			<div className="text-center space-y-2">
				<h3 className={cn("text-xl sm:text-2xl font-bold", colorClass)}>{title}</h3>
				<Badge variant="outline" className={cn("text-xs sm:text-sm", colorClass)}>
					{year}
				</Badge>
			</div>

			<div className="text-center space-y-1">
				<p className="text-sm sm:text-base text-muted-foreground font-medium">
					Glissez-déposez votre image ici
				</p>
				<p className="text-xs text-muted-foreground">ou</p>
			</div>

			<Button asChild variant="default" size="lg" className="w-full max-w-60">
				<label className="cursor-pointer">
					<CloudUpload className="mr-2 size-4" />
					Choisir une image
					<input
						ref={inputRef}
						type="file"
						accept="image/*"
						onChange={onFileInput}
						className="sr-only"
					/>
				</label>
			</Button>

			<p className="text-xs text-muted-foreground/70">JPG, PNG • Max 10MB</p>
		</div>
	</div>
);

interface ImagePreviewProps {
	image: string;
	title: string;
	year: string;
	colorClass: string;
	onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
	onRemoveImage: () => void;
	inputRef: React.RefObject<HTMLInputElement>;
}

const ImagePreview = ({
	image,
	title,
	year,
	colorClass,
	onFileInput,
	onRemoveImage,
	inputRef,
}: ImagePreviewProps) => (
	<div className="flex flex-col gap-4 p-4">
		<div className="flex items-center justify-between mb-2">
			<div>
				<h4 className={cn("text-base sm:text-lg font-semibold", colorClass)}>{title}</h4>
				<Badge variant="secondary" className="text-xs mt-1">
					{year}
				</Badge>
			</div>
			<CheckCircle2 className="size-5 text-green-500" />
		</div>

		<div className="relative w-full aspect-4/3 rounded-lg overflow-hidden border-2 border-border bg-muted group">
			<StorageImage
				src={image}
				alt={`${title} Image`}
				fill
				sizes="(max-width: 768px) 100vw, 50vw"
				style={{ objectFit: "contain" }}
				className="object-contain transition-transform group-hover:scale-105 duration-300"
			/>
		</div>

		<div className="flex gap-2">
			<Button asChild variant="outline" size="sm" className="flex-1">
				<label className="cursor-pointer">
					<RefreshCw className="mr-2 size-4" />
					Changer
					<input
						ref={inputRef}
						type="file"
						accept="image/*"
						onChange={onFileInput}
						className="sr-only"
					/>
				</label>
			</Button>
			<Button onClick={onRemoveImage} variant="destructive" size="sm" className="flex-1">
				<Trash2 className="mr-2 size-4" />
				Supprimer
			</Button>
		</div>
	</div>
);

interface UploadAreaProps {
	isDragging: boolean;
	image: string | null;
	title: string;
	year: string;
	colorClass: string;
	dragHandlers: {
		onDrop: (e: React.DragEvent) => void;
		onDragEnter: (e: React.DragEvent) => void;
		onDragLeave: (e: React.DragEvent) => void;
		onDragOver: (e: React.DragEvent) => void;
	};
	fileHandlers: {
		onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
		onRemoveImage: () => void;
	};
	inputRef: React.RefObject<HTMLInputElement | null>;
	showPreviewImage?: boolean | "vr";
}

const UploadArea = ({
	isDragging,
	image,
	title,
	year,
	colorClass,
	dragHandlers,
	fileHandlers,
	inputRef,
	showPreviewImage = false,
}: UploadAreaProps) => (
	<Card
		{...dragHandlers}
		data-dragging={isDragging}
		className={cn(
			"h-full transition-all duration-300 ease-in-out",
			"border-2 border-dashed",
			"data-[dragging=true]:border-primary data-[dragging=true]:bg-primary/5",
			"data-[dragging=true]:scale-[1.02]",
			image && "border-solid border-primary/20 bg-primary/2"
		)}
	>
		<CardContent className="p-0">
			{image ? (
				<ImagePreview
					image={image}
					title={title}
					year={year}
					colorClass={colorClass}
					onFileInput={fileHandlers.onFileInput}
					onRemoveImage={fileHandlers.onRemoveImage}
					inputRef={inputRef as React.RefObject<HTMLInputElement>}
				/>
			) : (
				<UploadPlaceholder
					title={title}
					year={year}
					colorClass={colorClass}
					onFileInput={fileHandlers.onFileInput}
					inputRef={inputRef as React.RefObject<HTMLInputElement>}
					showPreviewImage={showPreviewImage}
				/>
			)}
		</CardContent>
	</Card>
);

// --- Main Page Component ---

export default function NostalgieVR() {
	const ogUpload = useNostalgieUpload();
	const vrUpload = useNostalgieUpload();
	const { url: exampleImageUrl, loading: loadingExampleImage } = useNostalgieExampleImage();
	const {
		finalImage,
		showFinalCropDialog,
		isProcessing,
		watermarkEnabled,
		watermarkPosition,
		exportFormat,
		exportQuality,
		setWatermarkEnabled,
		setWatermarkPosition,
		setExportFormat,
		setExportQuality,
		createCollage,
		handleFinalCropComplete,
		handleCancelFinalCrop,
		handleShareTwitter,
		handleShareInstagram,
		handleShareDiscord,
		handleCopyLink,
	} = useNostalgieCollage();

	const [ogImageDimensions, setOgImageDimensions] = useState<{
		width: number;
		height: number;
	} | null>(null);

	const handleOgCropComplete = (croppedImage: string) => {
		ogUpload.handleCropComplete(croppedImage);
		const img = new window.Image();
		img.onload = () => setOgImageDimensions({ height: img.height, width: img.width });
		img.src = croppedImage;
	};

	const handleResetAll = () => {
		ogUpload.reset();
		vrUpload.reset();
		setOgImageDimensions(null);
		toast.info("Toutes les images ont été réinitialisées.");
	};

	const canCreateCollage = ogUpload.image && vrUpload.image && !isProcessing;

	return (
		<div className="flex flex-col min-h-screen bg-linear-to-b from-background via-background to-muted/20">
			<BreadcrumbSchema
				items={[
					{ item: "/", name: "Accueil" },
					{ item: "/projets", name: "Projets" },
					{ item: "/projets/nostalgie", name: "Nostalgie" },
				]}
			/>
			<Toaster richColors position="top-center" />

			<header className="container mx-auto flex max-w-7xl items-center gap-3 border-b border-border px-4 py-4 min-[600px]:px-6">
				<div className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
					<Scissors className="size-5" aria-hidden />
				</div>
				<div>
					<h1 className="text-2xl font-bold tracking-tight min-[840px]:text-3xl">
						Projet Nostalgie
					</h1>
					<p className="text-xs text-muted-foreground">Importer · Recadrer · Télécharger</p>
				</div>
			</header>

			{/* Main Content */}
			<section className="relative flex-1 py-4 min-[600px]:py-6">
				<div className="container mx-auto max-w-7xl px-4 min-[600px]:px-6">
					{/* Upload Areas */}
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
						<UploadArea
							isDragging={ogUpload.isDragging}
							image={ogUpload.image}
							title="Inazuma Eleven"
							year="2011"
							colorClass="text-orange-600 dark:text-orange-400"
							dragHandlers={{
								onDragEnter: ogUpload.handleDragEnter,
								onDragLeave: ogUpload.handleDragLeave,
								onDragOver: ogUpload.handleDragOver,
								onDrop: ogUpload.handleDrop,
							}}
							fileHandlers={{
								onFileInput: ogUpload.handleFileInput,
								onRemoveImage: ogUpload.handleRemoveImage,
							}}
							inputRef={ogUpload.inputRef}
							showPreviewImage
						/>

						<UploadArea
							isDragging={vrUpload.isDragging}
							image={vrUpload.image}
							title="Victory Road"
							year="2025"
							colorClass="text-cyan-600 dark:text-cyan-400"
							dragHandlers={{
								onDragEnter: vrUpload.handleDragEnter,
								onDragLeave: vrUpload.handleDragLeave,
								onDragOver: vrUpload.handleDragOver,
								onDrop: vrUpload.handleDrop,
							}}
							fileHandlers={{
								onFileInput: vrUpload.handleFileInput,
								onRemoveImage: vrUpload.handleRemoveImage,
							}}
							inputRef={vrUpload.inputRef}
							showPreviewImage="vr"
						/>
					</div>

					{/* Action Buttons */}
					<div className="flex flex-col sm:flex-row justify-center items-stretch sm:items-center gap-3 mb-12">
						<Button
							onClick={() => canCreateCollage && createCollage(ogUpload.image!, vrUpload.image!)}
							disabled={!canCreateCollage}
							size="lg"
							className="min-w-[200px] bg-[#a14b3f] hover:bg-[#8a3f35] text-white shadow-lg hover:shadow-xl transition-all"
						>
							{isProcessing ? (
								<>
									<Loader2 className="mr-2 size-5 animate-spin" />
									Création en cours...
								</>
							) : (
								<>
									<Scissors className="mr-2 size-5" />
									Créer le montage
								</>
							)}
						</Button>

						<Button
							onClick={handleResetAll}
							variant="outline"
							size="lg"
							className="min-w-40"
							disabled={!ogUpload.image && !vrUpload.image && !finalImage}
						>
							<X className="mr-2 size-5" />
							Réinitialiser
						</Button>
					</div>

					<Separator className="my-8" />

					{/* Advanced Settings & Social Share Section */}
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-12 mb-12">
						{/* Paramètres Avancés */}
						<Card>
							<CardHeader>
								<div className="flex items-center gap-2">
									<Settings className="size-5 text-primary" />
									<CardTitle>Paramètres Avancés</CardTitle>
								</div>
								<CardDescription>Personnalisez votre export</CardDescription>
							</CardHeader>
							<CardContent className="space-y-6">
								{/* Filigrane Toggle */}
								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<Label htmlFor="watermark-toggle" className="text-base">
											Filigrane Rose Griffon
										</Label>
										<p className="text-sm text-muted-foreground">
											Ajouter le logo en surimpression
										</p>
									</div>
									<Switch
										id="watermark-toggle"
										checked={watermarkEnabled}
										onCheckedChange={setWatermarkEnabled}
									/>
								</div>

								{/* Position Filigrane */}
								{watermarkEnabled && (
									<div className="space-y-2">
										<Label>Position du filigrane</Label>
										<div className="grid grid-cols-2 gap-2">
											{[
												{ label: "Haut gauche", value: "top-left" },
												{ label: "Haut droite", value: "top-right" },
												{ label: "Bas gauche", value: "bottom-left" },
												{ label: "Bas droite", value: "bottom-right" },
											].map((pos) => (
												<Button
													key={pos.value}
													variant={watermarkPosition === pos.value ? "default" : "outline"}
													size="sm"
													onClick={() =>
														setWatermarkPosition(pos.value as typeof watermarkPosition)
													}
												>
													{pos.label}
												</Button>
											))}
										</div>
									</div>
								)}

								<Separator />

								{/* Format Export */}
								<div className="space-y-2">
									<Label>Format d&apos;export</Label>
									<Tabs
										value={exportFormat}
										onValueChange={(value) => setExportFormat(value as typeof exportFormat)}
									>
										<TabsList className="grid w-full grid-cols-3">
											<TabsTrigger value="jpg">JPG</TabsTrigger>
											<TabsTrigger value="png">PNG</TabsTrigger>
											<TabsTrigger value="webp">WebP</TabsTrigger>
										</TabsList>
									</Tabs>
								</div>

								{/* Qualité Export */}
								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<Label>Qualité d&apos;export</Label>
										<span className="text-sm text-muted-foreground">
											{Math.round(exportQuality * 100)}%
										</span>
									</div>
									<Slider
										value={[exportQuality]}
										onValueChange={(value) => {
											const val = value[0];
											if (val !== undefined) {
												setExportQuality(val);
											}
										}}
										min={0.5}
										max={1}
										step={0.05}
										className="w-full"
									/>
									<p className="text-xs text-muted-foreground">
										Plus élevée = meilleure qualité mais fichier plus lourd
									</p>
								</div>
							</CardContent>
						</Card>

						{/* Partage Social */}
						<Card>
							<CardHeader>
								<div className="flex items-center gap-2">
									<Share2 className="size-5 text-primary" />
									<CardTitle>Partager</CardTitle>
								</div>
								<CardDescription>Partagez votre création sur les réseaux</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								<Button
									onClick={handleShareTwitter}
									variant="outline"
									className="w-full justify-start"
									size="lg"
								>
									<MessageCircle className="mr-2 size-5" />
									Citer le tweet d&apos;origine
								</Button>

								<Button
									onClick={handleShareDiscord}
									variant="outline"
									className="w-full justify-start"
									size="lg"
								>
									<SiDiscord className="mr-2 size-5" />
									Partager sur Discord
								</Button>

								<Button
									onClick={handleShareInstagram}
									variant="outline"
									className="w-full justify-start"
									size="lg"
								>
									<Instagram className="mr-2 size-5" />
									Partager sur Instagram
								</Button>

								<Separator />

								<Button
									onClick={handleCopyLink}
									variant="outline"
									className="w-full justify-start"
									size="lg"
								>
									<Link2 className="mr-2 size-5" />
									Copier le lien
								</Button>

								<div className="mt-4 p-3 rounded-lg bg-muted/50">
									<p className="text-xs text-muted-foreground text-center">
										💡 Téléchargez votre montage puis partagez-le sur vos réseaux favoris !
									</p>
								</div>
							</CardContent>
						</Card>
					</div>

					<Separator className="my-8" />

					{/* Example Section */}
					<div className="space-y-6 mt-12">
						<div className="text-center space-y-2">
							<h2 className="text-2xl sm:text-3xl md:text-4xl font-bold">Exemple de Résultat</h2>
							<p className="text-sm sm:text-base text-muted-foreground">
								Aperçu d&apos;un montage généré avec cet outil
							</p>
						</div>

						<Card className="overflow-hidden border-2 hover:border-[#a14b3f]/30 transition-all hover:shadow-2xl max-w-3xl mx-auto">
							<CardContent className="p-0">
								{loadingExampleImage ? (
									<div className="w-full aspect-video bg-muted flex items-center justify-center">
										<div className="flex flex-col items-center gap-2">
											<Loader2 className="size-8 animate-spin text-muted-foreground" />
											<p className="text-sm text-muted-foreground">
												Chargement de l&apos;exemple...
											</p>
										</div>
									</div>
								) : exampleImageUrl ? (
									<div className="relative w-full h-auto">
										{/* eslint-disable-next-line @next/next/no-img-element */}
										<img
											src={exampleImageUrl}
											alt="Exemple de montage Nostalgie - Comparaison 2011 vs 2025"
											className="w-full h-auto"
											crossOrigin="anonymous"
										/>
									</div>
								) : (
									<div className="w-full aspect-video bg-muted flex items-center justify-center">
										<p className="text-sm text-muted-foreground">
											Impossible de charger l&apos;image d&apos;exemple
										</p>
									</div>
								)}
							</CardContent>
						</Card>
					</div>
				</div>
			</section>

			{/* Crop Dialogs - ALWAYS RENDERED (never conditionally destroyed) */}
			<ImageCropperDialog
				image={ogUpload.tempImage || ""}
				open={ogUpload.showCropDialog}
				onClose={ogUpload.handleCloseDialog}
				onCropComplete={handleOgCropComplete}
				title="Recadrer l'image Inazuma Eleven (2011)"
				freeAspect
				outputWidth={800}
				quality={0.95}
			/>

			<ImageCropperDialog
				image={vrUpload.tempImage || ""}
				open={vrUpload.showCropDialog}
				onClose={vrUpload.handleCloseDialog}
				onCropComplete={vrUpload.handleCropComplete}
				title="Recadrer l'image Victory Road (2025)"
				suggestedAspectRatio={
					ogImageDimensions ? ogImageDimensions.width / ogImageDimensions.height : undefined
				}
				freeAspect={!ogImageDimensions}
				outputWidth={800}
				quality={0.95}
			/>

			<ImageCropperDialog
				image={finalImage || ""}
				open={showFinalCropDialog}
				onClose={handleCancelFinalCrop}
				onCropComplete={handleFinalCropComplete}
				title="Ajuster et télécharger le montage final"
				suggestedAspectRatio={1}
				outputWidth={1000}
				quality={1}
				validateButtonText={
					<>
						<Download className="mr-2 size-4" />
						Télécharger le montage
					</>
				}
				additionalButtons={
					<Button
						onClick={handleShareTwitter}
						variant="default"
						className="w-full sm:w-auto bg-black hover:bg-black/90 text-white"
					>
						<MessageCircle className="mr-2 size-4" />
						Citer le tweet
					</Button>
				}
			/>
		</div>
	);
}
