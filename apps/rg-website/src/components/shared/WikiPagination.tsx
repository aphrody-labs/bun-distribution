"use client";

import { usePathname, useSearchParams } from "next/navigation";

import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@rosegriffon/ui";

interface WikiPaginationProps {
	totalItems: number;
	itemsPerPage: number;
	currentPage: number;
}

export function WikiPagination({ totalItems, itemsPerPage, currentPage }: WikiPaginationProps) {
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const totalPages = Math.ceil(totalItems / itemsPerPage);

	if (totalPages <= 1) {
		return null;
	}

	const createPageUrl = (pageNumber: number) => {
		const params = new URLSearchParams(searchParams.toString());
		params.set("page", pageNumber.toString());
		return `${pathname}?${params.toString()}`;
	};

	const getVisiblePages = (): (number | "ellipsis")[] => {
		const pages: (number | "ellipsis")[] = [];

		if (totalPages <= 7) {
			return Array.from({ length: totalPages }, (_, i) => i + 1);
		}

		pages.push(1);
		if (currentPage > 3) {
			pages.push("ellipsis");
		}

		const start = Math.max(2, currentPage - 1);
		const end = Math.min(totalPages - 1, currentPage + 1);
		for (let i = start; i <= end; i++) {
			pages.push(i);
		}

		if (currentPage < totalPages - 2) {
			pages.push("ellipsis");
		}
		if (totalPages > 1) {
			pages.push(totalPages);
		}

		return pages;
	};

	return (
		<div className="flex items-center justify-center pt-8">
			<Pagination>
				<PaginationContent>
					<PaginationItem>
						<PaginationPrevious
							href={currentPage > 1 ? createPageUrl(currentPage - 1) : "#"}
							aria-disabled={currentPage <= 1}
							className={currentPage <= 1 ? "pointer-events-none opacity-50" : ""}
						/>
					</PaginationItem>

					{getVisiblePages().map((page, index) => (
						<PaginationItem key={`page-${index}`}>
							{page === "ellipsis" ? (
								<PaginationEllipsis />
							) : (
								<PaginationLink href={createPageUrl(page)} isActive={page === currentPage}>
									{page}
								</PaginationLink>
							)}
						</PaginationItem>
					))}

					<PaginationItem>
						<PaginationNext
							href={currentPage < totalPages ? createPageUrl(currentPage + 1) : "#"}
							aria-disabled={currentPage >= totalPages}
							className={currentPage >= totalPages ? "pointer-events-none opacity-50" : ""}
						/>
					</PaginationItem>
				</PaginationContent>
			</Pagination>
		</div>
	);
}
