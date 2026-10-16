// SPDX-License-Identifier: Apache-2.0
import Link from "next/link";

export default function About() {
  return (
    <main className="flex flex-col items-start gap-4">
      <h1 className="text-headline-medium">About</h1>
      <Link
        href="/"
        className="state-layer rounded-full px-4 py-2 text-label-large text-primary"
      >
        Back
      </Link>
    </main>
  );
}
