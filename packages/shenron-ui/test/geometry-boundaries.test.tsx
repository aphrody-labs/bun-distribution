import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RythmeSparkline } from "../src/admin/RythmeSparkline";
import { arcs as geometryArcs } from "../src/toriyama-svg/geometry";
import { arcs as cloudArcs, KINTO_UN_ILLUSTRATION, KINTO_UN_ICONE } from "../src/toriyama-svg/kinto-un";
import { bancNuage, BANC_NUAGE } from "../src/toriyama-svg/couverture";
import { requiredIndex } from "../src/toriyama-svg/required-index";
import { DragonBall } from "../src/toriyama/DragonBall";
import { DragonBallSphere } from "../src/toriyama/DragonBallSphere";
import { Etoile } from "../src/toriyama/MotifsCouverture";
import { ToriyamaEmblem } from "../src/toriyama/ToriyamaEmblem";

describe("checked SVG geometry inputs", () => {
  test("empty point sets produce empty paths", () => {
    expect(geometryArcs([], [])).toBe("");
    expect(cloudArcs([], [])).toBe("");
  });

  test("missing heights are rejected instead of emitting NaN coordinates", () => {
    expect(() =>
      geometryArcs(
        [
          [0, 0],
          [10, 0],
        ],
        [],
      ),
    ).toThrow(RangeError);
    expect(() =>
      cloudArcs(
        [
          [0, 0],
          [10, 0],
        ],
        [],
      ),
    ).toThrow(RangeError);
    expect(
      geometryArcs(
        [
          [0, 0],
          [10, 0],
        ],
        [5],
        false,
      ),
    ).toBe("M0 0 A5 5 0 0 1 10 0");
    expect(
      cloudArcs(
        [
          [0, 0],
          [10, 0],
        ],
        [5],
        false,
      ),
    ).toBe("M0 0A5 5 0 0 1 10 0");
  });

  test("invalid indices and sparse inputs fail explicitly", () => {
    const sparse: number[] = [];
    sparse.length = 2;
    expect(() => requiredIndex(sparse, 1)).toThrow(RangeError);
    expect(() => requiredIndex([1], Number.NaN)).toThrow(RangeError);
    expect(() => requiredIndex([1], -1)).toThrow(RangeError);
    expect(() => requiredIndex([1], 0.5)).toThrow(RangeError);
    expect(requiredIndex([0], 0)).toBe(0);
  });

  test("the committed cloud and cover geometries are unchanged", () => {
    // Derived from the committed implementations before the strict-index migration.
    const hash = (value: unknown) => new Bun.CryptoHasher("sha256").update(JSON.stringify(value)).digest("hex");
    expect(hash([KINTO_UN_ILLUSTRATION, KINTO_UN_ICONE])).toBe(
      "a838259514023381c1087b63273eeab02a518cc4ba4686afb5ccc2bbc7bb3879",
    );
    expect(hash(BANC_NUAGE)).toBe("bccf586dd3c8e1d1e95122dbf09b143b6159d40b6a3f2f95fa7117bd734f0251");
  });

  test("malformed cover lobes are rejected", () => {
    expect(() => bancNuage({ creuxX: [0] })).toThrow(RangeError);
    expect(() => bancNuage({ fleches: [] })).toThrow(RangeError);
    expect(() => bancNuage({ creuxX: [0, 10], fleches: [1, 2, 3] })).toThrow(RangeError);
    expect(JSON.stringify(bancNuage({ creuxX: [0, 10], fleches: [5] }))).not.toMatch(/NaN|undefined/);
  });
});

describe("indexed SVG component fallbacks", () => {
  test("a sparkline needs two real endpoints", () => {
    expect(renderToStaticMarkup(<RythmeSparkline points={[]} />)).toBe("");
    expect(renderToStaticMarkup(<RythmeSparkline points={[{ jour: "2026-10-16", revisions: 1 }]} />)).toBe("");
    const html = renderToStaticMarkup(
      <RythmeSparkline
        points={[
          { jour: "2026-10-15", revisions: 0 },
          { jour: "2026-10-16", revisions: 2 },
        ]}
      />,
    );
    expect(html).toContain("2 révisions");
    expect(html).not.toMatch(/NaN|undefined/);
  });

  test("star layouts, star dimensions and emblem fallback stay renderable", () => {
    const fallback = renderToStaticMarkup(<DragonBall stars={Number.NaN} />);
    expect(fallback.match(/<polygon/g)).toHaveLength(4);
    expect(renderToStaticMarkup(<DragonBallSphere stars={7} />).match(/<polygon/g)).toHaveLength(7);
    expect(renderToStaticMarkup(<Etoile />)).not.toMatch(/NaN|undefined/);
    expect(renderToStaticMarkup(<ToriyamaEmblem name="unknown" />)).toBe(
      renderToStaticMarkup(<ToriyamaEmblem name="kame" />),
    );
  });
});
