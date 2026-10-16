import { FrenchTweet } from "./tweet/FrenchTweet";

const TWEET_IDS = [
  "1991196264646541729", // Rose Griffon
  "1991478842184110372", // Azalée
  "1987214374646296696", // Achilléa
];

export function FeaturedTweets() {
  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 justify-items-center items-stretch">
        {TWEET_IDS.map(id => (
          <div key={id} className="w-full max-w-[500px] h-full">
            <FrenchTweet id={id} />
          </div>
        ))}
      </div>
    </div>
  );
}
