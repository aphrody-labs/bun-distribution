import { useEffect, useState } from "react";

export interface InazumaCharacterData {
	name: string;
	hash: string;
	assets: {
		portrait: string[];
		fullbody: string[];
	};
	sourceUrl: string;
}

export function useInazumaCharacter(url?: string) {
	const [data, setData] = useState<InazumaCharacterData | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!url) {
			return;
		}

		const fetchData = async () => {
			setLoading(true);
			setError(null);
			try {
				const res = await fetch(`/api/inazuma/character?url=${encodeURIComponent(url)}`);
				if (!res.ok) {
					throw new Error("Failed to fetch character data");
				}
				const json = await res.json();
				setData(json);
			} catch (error) {
				setError(error instanceof Error ? error.message : "An error occurred");
			} finally {
				setLoading(false);
			}
		};

		fetchData();
	}, [url]);

	return { data, error, loading };
}
