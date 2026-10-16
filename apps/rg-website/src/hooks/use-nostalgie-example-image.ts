import { useEffect, useState } from "react";

interface ImageUrlResponse {
	success: boolean;
	url?: string;
	type?: "public" | "signed";
	bucket?: string;
	file?: string;
	expiresIn?: number;
	error?: string;
}

/**
 * Hook pour récupérer l'URL de l'image d'exemple ogVR.jpg depuis Supabase Storage
 * Utilise l'API route /api/nostalgie/get-example-image
 *
 * @returns { url: string | null, loading: boolean, error: Error | null }
 */
export function useNostalgieExampleImage() {
	const [url, setUrl] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<Error | null>(null);

	useEffect(() => {
		const fetchImageUrl = async () => {
			try {
				setLoading(true);
				const response = await fetch("/api/nostalgie/get-example-image");

				if (!response.ok) {
					throw new Error(`API returned ${response.status}`);
				}

				const data: ImageUrlResponse = await response.json();

				if (!data.success || !data.url) {
					throw new Error(data.error || "Failed to fetch image URL");
				}

				setUrl(data.url);
				// Console.log("✅ Nostalgie example image loaded:", {
				//   Type: data.type,
				//   Bucket: data.bucket,
				//   File: data.file,
				//   ExpiresIn: data.expiresIn,
				// });
			} catch (error) {
				const normalizedError = error instanceof Error ? error : new Error(String(error));
				setError(normalizedError);
				console.error("❌ Error loading nostalgie example image:", error);
			} finally {
				setLoading(false);
			}
		};

		fetchImageUrl();
	}, []);

	return { error, loading, url };
}
