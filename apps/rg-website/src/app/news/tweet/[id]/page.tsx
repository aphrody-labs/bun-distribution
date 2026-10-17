import { generateTweetMetadata, POSTS_X_AZALEE, renderTweetPage } from "./tweet-page";

export const dynamic = "force-static";
export const revalidate = 86400;

type Props = { params: Promise<{ id: string }> };

export function generateMetadata(props: Props) {
  return generateTweetMetadata(props, POSTS_X_AZALEE);
}

export default function TweetPage(props: Props) {
  return renderTweetPage(props, POSTS_X_AZALEE);
}
