export const createImage = (url: string): Promise<HTMLImageElement> =>
	new Promise((resolve, reject) => {
		const image = new Image();
		image.addEventListener("load", () => resolve(image));
		image.addEventListener("error", (error) => reject(error));
		image.setAttribute("crossOrigin", "anonymous"); // Nécessaire pour éviter les problèmes de CORS
		image.src = url;
	});

export function getRadianAngle(degreeValue: number) {
	return (degreeValue * Math.PI) / 180;
}

/**
 * Retourne la nouvelle bounding box d'une image après rotation
 */
export function rotateSize(width: number, height: number, rotation: number) {
	const rotRad = getRadianAngle(rotation);

	return {
		height: Math.abs(Math.sin(rotRad) * width) + Math.abs(Math.cos(rotRad) * height),
		width: Math.abs(Math.cos(rotRad) * width) + Math.abs(Math.sin(rotRad) * height),
	};
}

/**
 * Cette fonction effectue le crop et la rotation via Canvas
 */
export default async function getCroppedImg(
	imageSrc: string,
	pixelCrop: { x: number; y: number; width: number; height: number },
	rotation = 0,
	flip = { horizontal: false, vertical: false }
): Promise<Blob | null> {
	const image = await createImage(imageSrc);
	const canvas = document.createElement("canvas");
	const ctx = canvas.getContext("2d");

	if (!ctx) {
		return null;
	}

	const rotRad = getRadianAngle(rotation);

	// Calculer la taille de la bounding box après rotation
	const { width: bBoxWidth, height: bBoxHeight } = rotateSize(image.width, image.height, rotation);

	// Définir la taille du canvas
	canvas.width = bBoxWidth;
	canvas.height = bBoxHeight;

	// Translater le contexte au centre pour la rotation
	ctx.translate(bBoxWidth / 2, bBoxHeight / 2);
	ctx.rotate(rotRad);
	ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);
	ctx.translate(-image.width / 2, -image.height / 2);

	// Dessiner l'image
	ctx.drawImage(image, 0, 0);

	// Extraire l'image croppée
	const data = ctx.getImageData(pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height);

	// Redimensionner le canvas à la taille finale souhaitée (le crop)
	canvas.width = pixelCrop.width;
	canvas.height = pixelCrop.height;

	// Coller les données extraites dans le nouveau canvas
	ctx.putImageData(data, 0, 0);

	// Retourner un Blob (plus performant que base64 pour l'upload)
	return new Promise((resolve) => {
		canvas.toBlob(
			(file) => {
				resolve(file);
			},
			"image/jpeg",
			0.95
		); // Qualité JPEG 95%
	});
}
