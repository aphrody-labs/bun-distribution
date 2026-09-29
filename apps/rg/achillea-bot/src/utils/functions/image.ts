import { bmvbhash } from "blockhash-core";
import sharp from "sharp";

import { Image } from "@/entities";
import { Database } from "@/services";
import { resolveDependency } from "@/utils/functions";

/**
 * Abstraction level for the image repository that will find an image by its name (with or without extension).
 * @param imageName
 * @returns image url
 */
export async function getImage(imageName: string): Promise<string | null> {
	const db = await resolveDependency(Database);
	const imageRepo = db.get(Image);

	const image = await imageRepo.findOne({
		$or: [
			{ fileName: imageName },
			{ fileName: `${imageName}.png` },
			{ fileName: `${imageName}.jpg` },
			{ fileName: `${imageName}.jpeg` },
			{ fileName: `${imageName}.gif` },
		],
	});

	return image?.url || null;
}

export async function imageHasher(
	imagePath: string,
	bits = 16 // like before
): Promise<string> {
	// Lecture Bun-native (plus rapide que node:fs) ; sharp accepte un Uint8Array.
	const buffer = await Bun.file(imagePath).bytes();
	const image = sharp(buffer);
	const { data, info } = await image
		.ensureAlpha()
		.raw()
		.resize(256, 256, { fit: "cover" })
		.toBuffer({ resolveWithObject: true });

	// blockhash-core expects data as Uint8Array and info.width/height
	return bmvbhash(
		{
			data, // Uint8Array
			width: info.width,
			height: info.height,
		},
		bits
	);
}
