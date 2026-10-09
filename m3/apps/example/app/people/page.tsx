// SPDX-License-Identifier: Apache-2.0
import { PEOPLE } from "../../lib/people";
import { PeopleTable } from "./people-table";

export const metadata = { title: "People" };

export default function PeoplePage() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-3xl">People</h1>
      <PeopleTable people={[...PEOPLE]} />
    </section>
  );
}
