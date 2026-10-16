import { useCallback, useState } from "react";
import { toast } from "sonner";

import { addWatermarkAndDownload, createCollageCanvas } from "@/lib/nostalgie-utils";
import { absoluteUrl } from "@/lib/site-url";

export const useNostalgieCollage = () => {
	const [finalImage, setFinalImage] = useState<string | null>(null);
	const [showFinalCropDialog, setShowFinalCropDialog] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [watermarkEnabled, setWatermarkEnabled] = useState(true);
	const [watermarkPosition, setWatermarkPosition] = useState<
		"bottom-right" | "bottom-left" | "top-right" | "top-left"
	>("bottom-right");
	const [exportFormat, setExportFormat] = useState<"jpg" | "png" | "webp">("jpg");
	const [exportQuality, setExportQuality] = useState(0.95);

	const createCollage = useCallback(async (ogImage: string, vrImage: string) => {
		setIsProcessing(true);
		const loadingToast = toast.loading("Création du montage en cours...");

		try {
			const collageDataUrl = await createCollageCanvas({
				ogImageSrc: ogImage,
				templateSrc: "/nostalgie.webp",
				vrImageSrc: vrImage,
			});

			setFinalImage(collageDataUrl);
			setShowFinalCropDialog(true);
			toast.success("Montage créé avec succès!", { id: loadingToast });
		} catch (error) {
			toast.error("Erreur lors de la création du montage", {
				id: loadingToast,
			});
			console.error(error);
		} finally {
			setIsProcessing(false);
		}
	}, []);

	const handleFinalCropComplete = useCallback(
		async (croppedImage: string) => {
			setShowFinalCropDialog(false);
			const downloadToast = toast.loading(
				watermarkEnabled ? "Ajout du filigrane et téléchargement..." : "Téléchargement en cours..."
			);

			try {
				await addWatermarkAndDownload({
					exportFormat,
					exportQuality,
					fileName: "nostalgie-rg",
					imageSrc: croppedImage,
					logoSrc: "/RG_Logo_V2.5.webp",
					watermarkEnabled,
					watermarkPosition,
				});
				toast.success("Montage téléchargé avec succès!", { id: downloadToast });
			} catch (error) {
				toast.error("Erreur lors du téléchargement", { id: downloadToast });
				console.error(error);
			}
		},
		[watermarkEnabled, watermarkPosition, exportFormat, exportQuality]
	);

	const handleCancelFinalCrop = useCallback(() => {
		setShowFinalCropDialog(false);
		setFinalImage(null);
		toast.info("Montage annulé");
	}, []);

	const handleShareTwitter = useCallback(() => {
		const pageUrl = encodeURIComponent(absoluteUrl("/projets/nostalgie"));
		const text = encodeURIComponent("J'ai créé mon montage Nostalgie ! 🎨⚽");

		window.open(
			`https://twitter.com/intent/tweet?text=${text}&url=${pageUrl}&via=rose_griffon&related=rose_griffon&in_reply_to=1986795842473517110`,
			"_blank",
			"width=550,height=420"
		);

		toast.success("Ouverture de X pour citer le tweet...");
	}, []);

	const handleShareInstagram = useCallback(() => {
		toast.info("Téléchargez votre montage puis uploadez-le sur Instagram !", {
			description: "Instagram ne permet pas le partage direct depuis le web.",
			duration: 5000,
		});
	}, []);

	const handleShareDiscord = useCallback(() => {
		const discordUrl = "https://discord.gg/Demj8h7Ba";
		window.open(discordUrl, "_blank", "width=550,height=420");
		toast.success("Ouverture du serveur Discord Rose Griffon !", {
			description: "Partagez votre création dans le salon #médias !",
			duration: 5000,
		});
	}, []);

	const handleCopyLink = useCallback(() => {
		const pageUrl = absoluteUrl("/projets/nostalgie");
		navigator.clipboard.writeText(pageUrl);
		toast.success("Lien copié dans le presse-papiers !");
	}, []);

	const reset = useCallback(() => {
		setFinalImage(null);
		setShowFinalCropDialog(false);
		setIsProcessing(false);
	}, []);

	return {
		createCollage,
		exportFormat,
		exportQuality,
		finalImage,
		handleCancelFinalCrop,
		handleCopyLink,
		handleFinalCropComplete,
		handleShareDiscord,
		handleShareInstagram,
		handleShareTwitter,
		isProcessing,
		reset,
		setExportFormat,
		setExportQuality,
		setWatermarkEnabled,
		setWatermarkPosition,
		showFinalCropDialog,
		watermarkEnabled,
		watermarkPosition,
	};
};
