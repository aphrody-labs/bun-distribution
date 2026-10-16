import { describe, expect, test } from "bun:test";
import { mergeMediaEntries, queryMedia } from "./catalog";
import { neighboringEntries } from "./navigation";
import { sourcePlayerUrl } from "./player";
import { mediaEntryPath } from "./url";
import type { MediaEntry } from "./work";

const episode: MediaEntry = {
  id: "episode:inazuma_eleven_1_1",
  kind: "episode",
  work: { id: "inazuma_eleven", kind: "anime", title: "Inazuma Eleven", series: "inazuma_eleven" },
  title: "Episode 1",
  season: 1,
  episode: 1,
  sources: [
    { platform: "youtube", id: "abc12345678", url: "https://youtu.be/abc12345678", official: true },
  ],
};

describe("canonical media catalogue", () => {
  test("merges sources without duplicating the entry", () => {
    const merged = mergeMediaEntries(
      [episode],
      [{ ...episode, sources: [{ ...episode.sources[0]!, id: "other1234567" }] }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]!.sources).toHaveLength(2);
  });

  test("queries canonically and builds stable routes", () => {
    expect(queryMedia([episode], { series: "inazuma_eleven" })[0]!.id).toBe(episode.id);
    expect(mediaEntryPath(episode)).toBe("/episodes/episode%3Ainazuma_eleven_1_1");
  });

  test("keeps player URL policy in one owner", () => {
    expect(sourcePlayerUrl(episode.sources[0]!, 12)).toContain("start=12");
    expect(neighboringEntries([episode], episode.id).next).toBeNull();
  });
});
