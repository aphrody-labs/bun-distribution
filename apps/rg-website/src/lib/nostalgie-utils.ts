import imageCompression from "browser-image-compression";
import pica from "pica";

export const loadImage = (src: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const img = new window.Image();
		img.onload = () => resolve(img);
		img.onerror = (err) => reject(err);
		img.src = src;
	});

export const compressImage = async (file: File): Promise<File> => {
	const options = {
		fileType: "image/jpeg",
		maxSizeMB: 2,
		maxWidthOrHeight: 2048,
		useWebWorker: true,
	};

	try {
		return await imageCompression(file, options);
	} catch {
		return file;
	}
};

export const fileToDataURL = (file: File): Promise<string> =>
	new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = (e) => resolve(e.target?.result as string);
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});

interface CreateCollageOptions {
	ogImageSrc: string;
	vrImageSrc: string;
	templateSrc: string;
}

export const createCollageCanvas = async ({
	ogImageSrc,
	vrImageSrc,
	templateSrc,
}: CreateCollageOptions): Promise<string> => {
	const [template, ogImg, vrImg] = await Promise.all([
		loadImage(templateSrc),
		loadImage(ogImageSrc),
		loadImage(vrImageSrc),
	]);

	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Canvas context unavailable");
	}

	canvas.width = template.width;
	canvas.height = template.height;
	ctx.drawImage(template, 0, 0);

	const rightSpaceX = template.width * 0.5;
	const rightSpaceWidth = template.width - rightSpaceX;
	const halfHeight = template.height / 2;

	const picaInstance = pica();
	const resizeAndDraw = async (
		img: HTMLImageElement,
		x: number,
		y: number,
		w: number,
		h: number
	) => {
		const offscreenCanvas = document.createElement("canvas");
		offscreenCanvas.width = w;
		offscreenCanvas.height = h;
		const resizedCanvas = await picaInstance.resize(img, offscreenCanvas, {});
		ctx.drawImage(resizedCanvas, x, y, w, h);
	};

	await Promise.all([
		resizeAndDraw(ogImg, rightSpaceX, 0, rightSpaceWidth, halfHeight),
		resizeAndDraw(vrImg, rightSpaceX, halfHeight, rightSpaceWidth, halfHeight),
	]);

	return canvas.toDataURL("image/png");
};

interface AddWatermarkOptions {
	imageSrc: string;
	logoSrc: string;
	fileName: string;
	watermarkEnabled?: boolean;
	watermarkPosition?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
	exportFormat?: "jpg" | "png" | "webp";
	exportQuality?: number;
}

export const addWatermarkAndDownload = async ({
	imageSrc,
	logoSrc,
	fileName,
	watermarkEnabled = true,
	watermarkPosition = "bottom-right",
	exportFormat = "jpg",
	exportQuality = 0.95,
}: AddWatermarkOptions) => {
	const mainImage = await loadImage(imageSrc);

	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Canvas context unavailable");
	}

	canvas.width = mainImage.width;
	canvas.height = mainImage.height;
	ctx.drawImage(mainImage, 0, 0);

	if (watermarkEnabled) {
		const logoImage = await loadImage(logoSrc);

		const watermarkWidth = canvas.width * 0.1;
		const watermarkHeight = (logoImage.height / logoImage.width) * watermarkWidth;
		const margin = canvas.width * 0.02;

		let x: number, y: number;

		switch (watermarkPosition) {
			case "bottom-right": {
				x = canvas.width - watermarkWidth - margin;
				y = canvas.height - watermarkHeight - margin;
				break;
			}
			case "bottom-left": {
				x = margin;
				y = canvas.height - watermarkHeight - margin;
				break;
			}
			case "top-right": {
				x = canvas.width - watermarkWidth - margin;
				y = margin;
				break;
			}
			case "top-left": {
				x = margin;
				y = margin;
				break;
			}
		}

		ctx.globalAlpha = 0.8;
		ctx.drawImage(logoImage, x, y, watermarkWidth, watermarkHeight);
		ctx.globalAlpha = 1;
	}

	const mimeType =
		exportFormat === "jpg" ? "image/jpeg" : exportFormat === "png" ? "image/png" : "image/webp";
	const extension = exportFormat;
	const watermarkedImage = canvas.toDataURL(mimeType, exportQuality);

	const link = document.createElement("a");
	link.href = watermarkedImage;
	link.download = `${fileName}-${Date.now()}.${extension}`;
	link.click();
};
