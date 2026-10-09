// SPDX-License-Identifier: Apache-2.0
import Link from "next/link";

export default function NotFound() {
  return (
    <section>
      <h1 className="text-2xl">Not found</h1>
      <Link href="/" className="text-primary">
        Back home
      </Link>
    </section>
  );
}
