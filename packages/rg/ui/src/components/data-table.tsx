"use client";

import {
	type ColumnDef,
	columnVisibilityFeature,
	type RowData,
	rowSelectionFeature,
	tableFeatures,
	useTable,
} from "@tanstack/react-table";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

// v9: the feature set is explicit. Selection and visibility back the
// `getIsSelected()` / `getVisibleCells()` calls below; no sorting/filtering/paging.
// Kept at module scope so the reference is stable.
const features = tableFeatures({ columnVisibilityFeature, rowSelectionFeature });
type DataTableFeatures = typeof features;

interface DataTableProps<TData extends RowData, TValue> {
	columns: ColumnDef<DataTableFeatures, TData, TValue>[];
	data: TData[];
}

export function DataTable<TData extends RowData, TValue>({
	columns,
	data,
}: DataTableProps<TData, TValue>) {
	const table = useTable({
		features,
		data,
		// useTable types columns with `unknown` cell values; the public
		// `TValue` generic is preserved for callers.
		// biome-ignore lint/suspicious/noExplicitAny: variance of TValue
		columns: columns as ColumnDef<DataTableFeatures, TData, any>[],
	});

	return (
		<div className="rounded-md border">
			<Table>
				<TableHeader>
					{table.getHeaderGroups().map((headerGroup) => (
						<TableRow key={headerGroup.id}>
							{headerGroup.headers.map((header) => {
								return (
									<TableHead key={header.id}>
										{header.isPlaceholder
											? null
											
												: <table.FlexRender header={header} />}
									</TableHead>
								);
							})}
						</TableRow>
					))}
				</TableHeader>
				<TableBody>
					{table.getRowModel().rows?.length ? (
						table.getRowModel().rows.map((row) => (
							<TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
								{row.getVisibleCells().map((cell) => (
									<TableCell key={cell.id}>
										<table.FlexRender cell={cell} />
									</TableCell>
								))}
							</TableRow>
						))
					) : (
						<TableRow>
							<TableCell colSpan={columns.length} className="h-24 text-center">
								Aucun résultat.
							</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>
		</div>
	);
}
