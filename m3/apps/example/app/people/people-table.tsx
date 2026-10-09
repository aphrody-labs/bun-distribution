"use client";
// SPDX-License-Identifier: Apache-2.0
import { DataTable, dataColumns } from "@aphrody/m3-react/data";
import { useRouter } from "next/navigation";
import type { Person } from "../../lib/people";

const col = dataColumns<Person>();
const columns = [
  col.accessor("name", { header: "Name" }),
  col.accessor("role", { header: "Role" }),
  col.accessor("city", { header: "City" }),
  col.accessor("joined", { header: "Joined" }),
];

export function PeopleTable({ people }: { people: Person[] }) {
  const router = useRouter();
  return (
    <DataTable
      caption={`${people.length} people`}
      data={people}
      columns={columns}
      getRowId={p => p.id}
      searchable
      pageSize={20}
      onRowClick={p => router.push(`/people/${p.id}`)}
    />
  );
}
