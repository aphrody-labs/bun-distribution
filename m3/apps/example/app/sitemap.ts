// SPDX-License-Identifier: Apache-2.0
import { PEOPLE } from "../lib/people";

const ORIGIN = Bun.env.PUBLIC_ORIGIN ?? "http://localhost:3000";

export default function sitemap() {
  return [
    { url: `${ORIGIN}/` },
    { url: `${ORIGIN}/people` },
    ...PEOPLE.slice(0, 10).map(p => ({ url: `${ORIGIN}/people/${p.id}` })),
  ];
}
