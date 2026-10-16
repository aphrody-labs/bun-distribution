// SPDX-License-Identifier: Apache-2.0
const catalogSeries = new Set(["DB", "DBS"]);

export function buildLoreCatalogRequest(series) {
  const normalizedSeries = typeof series === "string" ? series.trim() : "";
  if (!catalogSeries.has(normalizedSeries))
    return {
      error: "Choisis Dragon Ball ou Dragon Ball Super dans le catalogue.",
    };
  return { series: normalizedSeries };
}

export function normalizeLoreCatalogPayload(payload, series) {
  if (!catalogSeries.has(series) || !Array.isArray(payload?.volumes))
    throw new TypeError("Réponse du catalogue invalide.");
  const expected = series === "DB" ? /^vol(\d+)$/ : /^ch(\d+)$/;
  const records = payload.volumes
    .map((entry) => {
      const id = typeof entry?.tome === "string" ? entry.tome : entry?.volume;
      const match = typeof id === "string" ? expected.exec(id) : null;
      if (!match) return null;
      const number = Number(match[1]);
      if (series === "DB" && (number < 1 || number > 42)) return null;
      const pages = Number(entry.pages ?? entry.planches);
      const pagesWithJa = Number(entry.pagesWithJa ?? entry.planchesWithJa);
      if (
        !Number.isSafeInteger(pages) ||
        pages <= 0 ||
        !Number.isSafeInteger(pagesWithJa) ||
        pagesWithJa < 0 ||
        pagesWithJa > pages
      )
        return null;
      return {
        id,
        number,
        pages,
        pagesWithJa,
      };
    })
    .filter(Boolean)
    .toSorted((a, b) => a.number - b.number);
  const observedNumbers = [...new Set(records.map(({ number }) => number))];
  const firstNumber = observedNumbers[0] ?? null;
  const lastNumber = observedNumbers.at(-1) ?? null;
  const expectedNumbers =
    series === "DB"
      ? Array.from({ length: 42 }, (_, index) => index + 1)
      : firstNumber === null
        ? []
        : Array.from(
            { length: lastNumber - firstNumber + 1 },
            (_, index) => firstNumber + index,
          );
  const missingNumbers = expectedNumbers.filter(
    (number) => !observedNumbers.includes(number),
  );
  return {
    series,
    declaredCount: Number.isSafeInteger(payload.count)
      ? payload.count
      : payload.volumes.length,
    omittedCount: payload.volumes.length - records.length,
    coverage: {
      observedCount: observedNumbers.length,
      firstNumber,
      lastNumber,
      missingNumbers,
      completeStandardSet: series === "DB" && missingNumbers.length === 0,
      contiguousObservedRange:
        firstNumber !== null && missingNumbers.length === 0,
    },
    records,
  };
}

export function normalizeLoreCoveragePayload(payload) {
  if (
    !Number.isSafeInteger(payload?.index?.chunks) ||
    !Array.isArray(payload?.sources)
  )
    throw new TypeError("Réponse de couverture RAG invalide.");
  const sourceCount = (sourceId, kind) => {
    const entry = payload.sources.find(
      (source) => source?.source_id === sourceId && source?.kind === kind,
    );
    return Number.isSafeInteger(entry?.n) ? entry.n : null;
  };
  return {
    chunks: payload.index.chunks,
    builtAt:
      typeof payload.index.builtAt === "string" ? payload.index.builtAt : null,
    mangaPagePassages: sourceCount("manga", "manga_page"),
    mangaChapterPassages: sourceCount("db_manga_chapters", "manga_chapter"),
    mangaVolumePassages: sourceCount("db_manga_volumes", "manga_volume"),
  };
}
