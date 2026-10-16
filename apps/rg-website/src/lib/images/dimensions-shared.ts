/**
 * LECTURE DES DIMENSIONS DANS UN EN-TÊTE D'IMAGE — analyse d'octets PURE.
 *
 * Séparé de `dimensions.ts` (qui, lui, va chercher le fichier sur le réseau et
 * porte `import "server-only"`) pour UNE raison : `server-only` n'est fourni
 * qu'au moment du bundle par Next. Un test qui importe le module serveur échoue
 * donc sur « Cannot find package 'server-only' » — et la partie qui mérite le
 * plus d'être testée est justement celle-ci. Un format mal lu ne lève pas : il
 * rend une taille plausible mais fausse, et la page réserve un cadre de travers.
 *
 * Aucun accès réseau, aucun accès disque : ce module est importable de partout.
 */

export interface DimensionsImage {
	largeur: number;
	hauteur: number;
}

/** Lit les dimensions d'un PNG (IHDR, toujours le premier chunk). */
function dimensionsPng(vue: DataView): DimensionsImage | null {
	// Signature `\x89PNG\r\n\x1a\n` puis longueur (4) + type `IHDR` (4).
	if (vue.byteLength < 24) return null;
	if (vue.getUint32(0) !== 0x89504e47) return null;
	if (vue.getUint32(12) !== 0x49484452) return null;
	return { hauteur: vue.getUint32(20), largeur: vue.getUint32(16) };
}

/**
 * Lit les dimensions d'un JPEG en parcourant ses marqueurs.
 *
 * La taille n'est PAS à un décalage fixe : elle vit dans le segment SOFn, qui
 * arrive après un nombre variable de segments de métadonnées (EXIF, ICC…).
 */
function dimensionsJpeg(vue: DataView): DimensionsImage | null {
	if (vue.byteLength < 4 || vue.getUint16(0) !== 0xffd8) return null;
	let position = 2;
	while (position + 9 < vue.byteLength) {
		if (vue.getUint8(position) !== 0xff) {
			position++;
			continue;
		}
		const marqueur = vue.getUint8(position + 1);
		// SOF0..SOF15, sauf DHT (c4), DAC (c8) et RSTn (d0-d7) qui partagent la plage.
		if (marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8) {
			return { hauteur: vue.getUint16(position + 5), largeur: vue.getUint16(position + 7) };
		}
		const longueur = vue.getUint16(position + 2);
		if (longueur < 2) return null;
		position += 2 + longueur;
	}
	return null;
}

/**
 * Lit les dimensions d'un WebP — les trois variantes du format.
 *
 * `VP8 ` (avec perte), `VP8L` (sans perte) et `VP8X` (étendu) encodent la taille
 * différemment, et nos visuels sont convertis en WebP : ne gérer qu'une variante
 * reviendrait à ne rien gérer.
 */
function dimensionsWebp(vue: DataView, octets: Uint8Array): DimensionsImage | null {
	if (vue.byteLength < 30) return null;
	if (vue.getUint32(0) !== 0x52494646) return null; // "RIFF"
	if (vue.getUint32(8) !== 0x57454250) return null; // "WEBP"

	const type = vue.getUint32(12);
	if (type === 0x56503820) {
		// "VP8 " : en-tête de trame clé, largeur et hauteur sur 14 bits.
		return {
			hauteur: vue.getUint16(28, true) & 0x3fff,
			largeur: vue.getUint16(26, true) & 0x3fff,
		};
	}
	if (type === 0x5650384c) {
		// "VP8L" : 14 bits de largeur puis 14 bits de hauteur, à cheval sur 4 octets.
		const b = octets.subarray(21, 25);
		if (b.length < 4) return null;
		const bits = b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24);
		return { hauteur: (((bits >> 14) & 0x3fff) >>> 0) + 1, largeur: ((bits & 0x3fff) >>> 0) + 1 };
	}
	if (type === 0x56503858) {
		// "VP8X" : tailles sur 24 bits, moins un.
		const lire24 = (decalage: number) =>
			octets[decalage]! | (octets[decalage + 1]! << 8) | (octets[decalage + 2]! << 16);
		return { hauteur: lire24(27) + 1, largeur: lire24(24) + 1 };
	}
	return null;
}

/** Lit les dimensions d'un GIF (en-tête à décalage fixe). */
function dimensionsGif(vue: DataView): DimensionsImage | null {
	if (vue.byteLength < 10) return null;
	if (vue.getUint32(0) !== 0x47494638) return null; // "GIF8"
	return { hauteur: vue.getUint16(8, true), largeur: vue.getUint16(6, true) };
}

/**
 * Dimensions lues dans un en-tête d'image, quel qu'en soit le format.
 *
 * PURE et exportée pour être testée sans réseau : c'est de l'analyse d'octets,
 * là où un format mal lu donne une image à l'envers ou de travers plutôt qu'une
 * erreur visible.
 */
export function lireDimensions(octets: Uint8Array): DimensionsImage | null {
	if (octets.byteLength < 10) return null;
	const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength);
	const mesure =
		dimensionsPng(vue) ??
		dimensionsGif(vue) ??
		dimensionsWebp(vue, octets) ??
		dimensionsJpeg(vue);
	// Une largeur ou une hauteur nulle est un en-tête mal lu, pas une image :
	// la propager donnerait une division par zéro dans le calcul de proportions.
	if (!mesure || mesure.largeur <= 0 || mesure.hauteur <= 0) return null;
	return mesure;
}
