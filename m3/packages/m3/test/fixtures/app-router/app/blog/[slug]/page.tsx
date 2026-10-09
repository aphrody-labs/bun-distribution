import { notFound } from "next/navigation";

const POSTS: Record<string, string> = { first: "First post body", second: "Second post body" };

export function generateStaticParams() {
  return Object.keys(POSTS).map(slug => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  return { title: `Post ${(await params).slug}` };
}

export default async function Post({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = POSTS[slug];
  if (!body) notFound();
  return <article id="post">{body}</article>;
}
