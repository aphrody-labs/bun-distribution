// SPDX-License-Identifier: Apache-2.0
import Link from "next/link";
import { PEOPLE } from "../lib/people";
import { Counter } from "./counter";

export const metadata = { title: "Home" };

export default function Home() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-4xl">Full Bun, Next conventions</h1>
      <p className="text-on-surface-variant">
        This page is a React Server Component, rendered at build time. {PEOPLE.length} people are loaded on the server;
        only the counter below ships JavaScript.
      </p>
      <Counter />
      <p>
        <Link href="/people" className="text-primary">
          Browse the people table
        </Link>
      </p>
    </section>
  );
}
