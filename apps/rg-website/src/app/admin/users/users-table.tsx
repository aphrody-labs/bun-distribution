"use client";

import type { Database } from "@rosegriffon/db";
import { Badge, Button, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@rosegriffon/ui";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import {
  columnVisibilityFeature,
  createSortedRowModel,
  rowSortingFeature,
  sortFns,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { useState } from "react";
import { useTableBroadcast } from "@/hooks";
import { ArrowUpDown, Search } from "@/lib/icons-config";

import { UserEditDialog } from "./user-edit-dialog";

type User = Database["public"]["Tables"]["profiles"]["Row"];

// v9: explicit feature set, kept at module scope for a stable reference.
const features = tableFeatures({
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns,
});
type UsersFeatures = typeof features;

const columns: ColumnDef<UsersFeatures, User>[] = [
  {
    accessorKey: "email",
    cell: ({ row }) => row.getValue("email") || <span className="text-muted-foreground">N/A</span>,
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Email
        <ArrowUpDown className="ml-2 size-4" />
      </Button>
    ),
  },
  {
    accessorKey: "full_name",
    cell: ({ row }) => row.getValue("full_name") || <span className="text-muted-foreground">N/A</span>,
    header: "Nom Complet",
  },
  {
    accessorKey: "role",
    cell: ({ row }) => {
      const role = row.getValue("role") as string;
      return <Badge variant={role === "admin" ? "default" : "secondary"}>{role || "user"}</Badge>;
    },
    header: "Rôle",
  },
  {
    accessorKey: "created_at",
    cell: ({ row }) => {
      const dateStr = row.getValue("created_at") as string | null;
      if (!dateStr) return <span className="text-muted-foreground">N/A</span>;
      const date = new Date(dateStr);
      return date.toLocaleDateString("fr-FR", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    },
    header: ({ column }) => (
      <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Date
        <ArrowUpDown className="ml-2 size-4" />
      </Button>
    ),
  },
  {
    cell: ({ row }) => <UserEditDialog user={row.original} />,
    id: "actions",
  },
];

interface UsersTableProps {
  users: User[];
}

export function UsersTable({ users: initialUsers }: UsersTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const searchParams = useSearchParams();
  const router = useRouter();

  useTableBroadcast({
    onDelete: () => router.refresh(),
    onInsert: () => router.refresh(),
    onUpdate: () => router.refresh(),
    table: "profiles",
  });

  const table = useTable({
    columns,
    data: initialUsers,
    features,
    onSortingChange: setSorting,
    state: {
      sorting,
    },
  });

  const handleSearch = (term: string) => {
    const params = new URLSearchParams(searchParams || "");
    if (term) {
      params.set("query", term);
    } else {
      params.delete("query");
    }
    params.set("page", "1");
    router.replace(`/admin/users?${params.toString()}`);
  };

  const searchTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Rechercher par email..."
            defaultValue={searchParams?.get("query")?.toString()}
            onChange={e => {
              // La fonction de nettoyage retournée par un `onChange` n'est
              // jamais appelée (ce n'est pas un `useEffect`) : aucun timer
              // n'était annulé, et taper « martin » déclenchait six
              // navigations successives. On garde le timer dans une ref.
              const { value } = e.target;
              if (searchTimer.current) clearTimeout(searchTimer.current);
              searchTimer.current = setTimeout(() => handleSearch(value), 300);
            }}
            className="pl-10"
          />
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map(header => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map(row => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  Aucun utilisateur trouvé.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
