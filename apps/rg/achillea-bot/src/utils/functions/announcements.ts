export async function batchSend<T>(
	items: T[],
	batchSize: number,
	worker: (item: T) => Promise<any>
): Promise<void> {
	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		await Promise.all(batch.map(worker));
	}
}

export async function batchCreateChannels<T>(
	items: T[],
	batchSize: number,
	worker: (item: T, index: number) => Promise<any>
): Promise<void> {
	for (let i = 0; i < items.length; i += batchSize) {
		const batch = items.slice(i, i + batchSize);
		await Promise.all(batch.map((item, j) => worker(item, i + j)));
	}
}

export function paginate<T>(items: T[], pageSize: number): T[][] {
	const pages: T[][] = [];
	for (let i = 0; i < items.length; i += pageSize) {
		pages.push(items.slice(i, i + pageSize));
	}

	return pages;
}
