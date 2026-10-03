// SPDX-License-Identifier: Apache-2.0
/** Candidat `shenron.manga.review-candidate/v1` minimal et valide pour les tests. */
const prov = { producer: "koharu", model: null, confidence: null };

export function mangaCandidate(overrides: { pageId?: string; translated?: string | null } = {}) {
	const pageId = overrides.pageId ?? "DB:vol1:12";
	const translated = overrides.translated === undefined ? "Kamé Hamé Ha !" : overrides.translated;
	return {
		schema: "shenron.manga.review-candidate/v1",
		pageId,
		image: "manga/DB/vol1/012.webp",
		source: {
			kind: "manga",
			pageId,
			sourceSha256: "a".repeat(64),
			imageSha256: "b".repeat(64),
			mime: "image/webp",
			width: 800,
			height: 1200,
		},
		regions: [
			{
				id: "r2",
				kind: "bubble",
				label: null,
				readingOrder: 2,
				detectionLabels: [{ kind: "bubble", confidence: 0.9 }],
				bounds: { x: 10, y: 10, width: 100, height: 100 },
				polygon: [
					{ x: 10, y: 10 },
					{ x: 110, y: 10 },
					{ x: 110, y: 110 },
				],
				detectionConfidence: 0.9,
				sourceText: "かめはめ波！",
				translatedText: translated,
				texts: [],
				provenance: { detection: prov, ocr: prov, translation: prov },
			},
			{
				id: "r1",
				kind: "bubble",
				label: null,
				readingOrder: 1,
				detectionLabels: [],
				bounds: { x: 200, y: 200, width: 100, height: 100 },
				polygon: [
					{ x: 200, y: 200 },
					{ x: 300, y: 200 },
					{ x: 300, y: 300 },
				],
				detectionConfidence: null,
				sourceText: "悟空",
				translatedText: null,
				texts: [
					{
						id: "t1",
						readingOrder: 1,
						sourceText: "悟空",
						sourceLanguage: "ja",
						ocrConfidence: 0.8,
						ocrProvenance: prov,
						translatedText: translated === null ? null : "Goku",
						targetLanguage: "fr",
						translationProvenance: prov,
					},
				],
				provenance: { detection: null, ocr: null, translation: null },
			},
		],
		artifacts: { cleanupOverlaySha256: null },
		pipeline: { name: "koharu", version: "0.1.0" },
		decision: "unreviewed",
	};
}
