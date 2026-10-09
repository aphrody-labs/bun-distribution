<!-- SPDX-License-Identifier: Apache-2.0 -->
# m3 example app

The App Router of `@aphrody/m3` on Bun only: React Server Components, server actions, streaming SSR,
static generation, the M3 theme, Tailwind v4 and the M3 `DataTable`.

```sh
bun run dev        # m3 dev: rebuild and RSC refresh on change
bun run build      # m3 build: dist/ (rsc, ssr, client layers, prerendered pages)
bun run start      # m3 start: serves dist/
```

| Route | Shows |
| --- | --- |
| `/` | Server Component page, client counter, metadata |
| `/people` | Server data in the M3 `DataTable` (TanStack Table), search, sorting, pages |
| `/people/[id]` | `generateStaticParams`, `generateMetadata`, `notFound()` |
| `/guestbook` | Server action with `useActionState`, `revalidatePath`, form without JavaScript |
| `/api/health` | Route handler |
