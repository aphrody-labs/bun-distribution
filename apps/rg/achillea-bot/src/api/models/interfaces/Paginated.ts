// src/interfaces/Paginated.ts
import { BadRequest } from "@tsed/exceptions";

export type Paginated<T> = {
	data: T[];
	meta: {
		page: number;
		limit: number;
		total: number;
		pageCount: number;
	};
};

export function paginate(items: any[], total: number, pagination: number, page: number) {
	if (total === 0) {
		return {
			data: [],
			meta: {
				limit: pagination,
				page,
				total: 0,
				pageCount: 0,
			},
		};
	}

	if (page >= 1 && (page - 1) * pagination >= total) {
		throw new BadRequest(`Page ${page} is out of range`);
	}

	return {
		data: items,
		meta: {
			page,
			limit: pagination,
			total,
			pageCount: Math.ceil(total / pagination),
		},
	};
}
