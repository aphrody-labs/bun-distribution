import { generateTweetMetadata, POSTS_X_ROSE_GRIFFON, renderTweetPage } from "@/app/news/tweet/[id]/tweet-page";

export const dynamic = "force-static";
export const revalidate = 86400;

type Props = { params: Promise<{ id: string }> };

export function generateMetadata(props: Props) {
  return generateTweetMetadata(props, POSTS_X_ROSE_GRIFFON);
}

export default function PostXPage(props: Props) {
  return renderTweetPage(props, POSTS_X_ROSE_GRIFFON);
}
