import {
  type ArticlePageProps,
  CHRONIQUES_DU_BOUQUET,
  generateArticleMetadata,
  renderArticlePage,
} from "@/app/news/[slug]/article-page";

export const dynamic = "force-dynamic";

export function generateMetadata(props: ArticlePageProps) {
  return generateArticleMetadata(props, CHRONIQUES_DU_BOUQUET);
}

export default function ChroniquePage(props: ArticlePageProps) {
  return renderArticlePage(props, CHRONIQUES_DU_BOUQUET);
}
