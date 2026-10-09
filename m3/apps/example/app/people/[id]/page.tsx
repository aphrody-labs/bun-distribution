// SPDX-License-Identifier: Apache-2.0
import Link from "next/link";
import { notFound } from "next/navigation";
import { findPerson, PEOPLE } from "../../../lib/people";

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return PEOPLE.slice(0, 10).map(p => ({ id: p.id }));
}

export async function generateMetadata({ params }: Props) {
  const person = findPerson((await params).id);
  return { title: person?.name ?? "Unknown" };
}

export default async function PersonPage({ params }: Props) {
  const person = findPerson((await params).id);
  if (!person) notFound();
  return (
    <article className="flex flex-col gap-2">
      <h1 className="text-3xl">{person.name}</h1>
      <p>
        {person.role} in {person.city}, since {person.joined}.
      </p>
      <Link href="/people" className="text-primary">
        All people
      </Link>
    </article>
  );
}
