import { Card } from "@rosegriffon/ui";
import Image from "next/image";
import Link from "next/link";
import { getTweet } from "react-tweet/api";

import { Heart, MessageCircle } from "@/lib/icons-config"; // Assurez-vous que Repeat2 (Retweet) est dispo, sinon une autre icone
import { formatDate, formatNumber } from "@/lib/tweet-utils";

const TwitterLogo = () => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className="size-5 fill-current text-[#1DA1F2] dark:text-white"
  >
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

export async function FrenchTweet({ id }: { id: string }) {
  let tweet: Awaited<ReturnType<typeof getTweet>>;
  try {
    tweet = await getTweet(id);
  } catch (error) {
    console.error("Error loading tweet", id, error);
    return null;
  }

  if (!tweet) {
    return <div className="p-4 text-center text-muted-foreground">Tweet introuvable</div>;
  }

  // Gestion des médias (Photos)
  const photos = tweet.photos || [];
  const hasPhotos = photos.length > 0;

  // Formatage du texte (simplifié pour l'exemple, idéalement il faudrait parser les entités)
  // Pour faire simple et sécurisé, on affiche le texte brut ou on utilise une lib de parsing si besoin.
  // Ici on va juste afficher le texte.

  // Remplacement basique des liens t.co
  let textContent = tweet.text;
  const urls = tweet.entities?.urls ?? [];
  urls.forEach((url: { url: string }) => {
    textContent = textContent.replace(url.url, "");
  });

  const userUrl = `https://twitter.com/${tweet.user.screen_name}`;
  const tweetUrl = `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`;

  return (
    <Card className="overflow-hidden border bg-white dark:bg-black dark:border-zinc-800 hover:border-[#1DA1F2]/50 transition-colors duration-300 h-full flex flex-col">
      {/* Header */}
      <div className="p-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={userUrl}
            target="_blank"
            className="relative size-10 rounded-full overflow-hidden"
          >
            <Image
              src={tweet.user.profile_image_url_https}
              alt={tweet.user.name}
              fill
              sizes="40px"
              className="object-cover"
            />
          </Link>
          <div>
            <Link
              href={userUrl}
              target="_blank"
              className="block font-bold text-sm hover:underline"
            >
              {tweet.user.name}
            </Link>
            <Link href={userUrl} target="_blank" className="block text-sm text-muted-foreground">
              @{tweet.user.screen_name}
            </Link>
          </div>
        </div>
        <Link href={tweetUrl} target="_blank">
          <TwitterLogo />
        </Link>
      </div>

      {/* Body */}
      <div className="px-4 pb-2 text-[15px] whitespace-pre-wrap leading-relaxed grow">
        {textContent}
      </div>

      {/* Media */}
      {hasPhotos && (
        <div
          className={`px-4 pb-2 grid gap-1 ${photos.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
        >
          {photos.map((photo: { url: string }) => (
            <div
              key={photo.url}
              className="relative aspect-[1.7] rounded-xl overflow-hidden border dark:border-zinc-800"
            >
              <Image
                src={photo.url}
                alt="Tweet media"
                fill
                sizes="(max-width: 768px) 100vw, 600px"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      )}

      {/* Footer (Date & Metrics) */}
      <div className="p-4 mt-auto border-t dark:border-zinc-800">
        <div className="text-xs text-muted-foreground mb-3">
          {formatDate(new Date(tweet.created_at))}
        </div>
        <div className="flex items-center justify-between text-muted-foreground text-sm">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-1.5 group cursor-pointer hover:text-pink-600">
              <Heart className="size-4 group-hover:scale-110 transition-transform" />
              <span>{formatNumber(tweet.favorite_count)}</span>
            </div>
            <div className="flex items-center gap-1.5 group cursor-pointer hover:text-blue-500">
              <MessageCircle className="size-4 group-hover:scale-110 transition-transform" />
              <span>{formatNumber(tweet.conversation_count)}</span>
            </div>
            {/* Retweet count isn't always accurate in basic object, assuming conversation_count is replies */}
          </div>
        </div>
      </div>
    </Card>
  );
}
