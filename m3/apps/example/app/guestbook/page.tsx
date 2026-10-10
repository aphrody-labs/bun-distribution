// SPDX-License-Identifier: Apache-2.0
import { connection } from "next/server";
import { listEntries } from "../../lib/guestbook";
import { SignForm } from "./sign-form";

export const metadata = { title: "Guestbook" };

export default async function Guestbook() {
  await connection();
  const entries = listEntries();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-3xl">Guestbook</h1>
      <SignForm />
      <ul id="entries" className="flex flex-col gap-2">
        {entries.map(entry => (
          <li key={entry.at + entry.name} className="rounded-xl p-4 bg-surface-container">
            <strong>{entry.name}</strong>: {entry.message}
          </li>
        ))}
      </ul>
    </section>
  );
}
