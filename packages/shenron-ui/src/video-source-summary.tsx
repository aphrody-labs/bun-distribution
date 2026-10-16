import type { ReactElement } from "react";

/** Minimal playback-source contract. Providers and playback remain host concerns. */
export type VideoSource = {
  provider: string;
  lang?: "vf" | "vostfr" | string;
};

export function VideoSourceSummary({
  players,
  subtitles = 0,
  frames = 0,
  labels = {},
}: {
  players: readonly VideoSource[];
  subtitles?: number;
  frames?: number;
  /** Lets a host localize this presentation without changing its data contract. */
  labels?: Partial<
    Record<
      | "aria"
      | "players"
      | "providers"
      | "versions"
      | "subtitles"
      | "frames"
      | "none"
      | "external",
      string
    >
  >;
}): ReactElement {
  const text = {
    aria: "Available resources",
    players: "Players",
    providers: "Providers",
    versions: "Versions",
    subtitles: "Subtitles",
    frames: "Indexed scenes",
    none: "No source",
    external: "External",
    ...labels,
  };
  const languages = [
    ...new Set(players.map((player) => player.lang).filter(Boolean)),
  ];
  const versions = languages.map((language) =>
    language === "vf" ? "VF" : language === "vostfr" ? "VOSTFR" : language,
  );
  const providers = [
    ...new Set(players.map((player) => player.provider).filter(Boolean)),
  ];
  const items = [
    [text.players, players.length ? String(players.length) : "—"],
    [text.providers, providers.length ? providers.join(" · ") : "—"],
    [
      text.versions,
      versions.length
        ? versions.join(" · ")
        : players.length
          ? text.external
          : text.none,
    ],
    [text.subtitles, subtitles ? String(subtitles) : "—"],
    [text.frames, frames ? String(frames) : "—"],
  ] as const;

  return (
    <dl
      className="grid grid-cols-2 gap-2 sm:grid-cols-5"
      aria-label={text.aria}
    >
      {items.map(([label, value]) => (
        <div
          key={label}
          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2"
        >
          <dt className="text-[10px] uppercase tracking-wide text-white/45">
            {label}
          </dt>
          <dd
            className="mt-0.5 truncate text-sm font-bold text-white"
            title={value}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
